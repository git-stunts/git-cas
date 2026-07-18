/**
 * Real-Git proof for scoped staging reachability, promotion, expiry, and sweep.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ContentAddressableStore from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node'
  );
}

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const START = Date.parse('2026-07-17T20:00:00.000Z');
const tempDirs = [];
let now = START;
let repoDir;
let cas;

function git(args, input) {
  const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', input });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr || result.stdout || 'git failed'}`.trim());
  }
  return result.stdout.trim();
}

function objectExists(oid) {
  return spawnSync('git', ['cat-file', '-e', oid], { cwd: repoDir }).status === 0;
}

function reachableOids(ref) {
  return new Set(
    git(['rev-list', '--objects', ref])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ')[0])
  );
}

function pruneNow() {
  git(['prune', '--expire=now']);
}

async function* chunks(bytes) {
  yield bytes;
}

async function collect(source) {
  const buffers = [];
  for await (const chunk of source) {
    buffers.push(Buffer.from(chunk));
  }
  return Buffer.concat(buffers);
}

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-staging-workspace-'));
  tempDirs.push(repoDir);
  git(['init', '--bare']);
  cas = new ContentAddressableStore({
    plumbing: await createGitPlumbing({ cwd: repoDir }),
    clock: { now: () => new Date(now) },
  });
});

beforeEach(() => {
  now = START;
});

afterAll(() => {
  for (const directory of tempDirs.reverse()) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('scoped staging workspace direct reachability', () => {
  it('returns a page only after its exact workspace generation reaches it', async () => {
    const workspace = await cas.workspaces.open({
      namespace: 'integration/direct-page',
      ttlMs: 60_000,
    });

    const staged = await workspace.pages.put({ source: Buffer.from('directly retained page') });

    expect(git(['rev-parse', staged.witness.root.ref])).toBe(staged.witness.root.generation);
    expect(reachableOids(staged.witness.root.ref)).toContain(staged.handle.oid);
    pruneNow();
    expect(objectExists(staged.handle.oid)).toBe(true);

    await workspace.release();
    pruneNow();
    expect(objectExists(staged.handle.oid)).toBe(false);
  });
});

describe('scoped staging workspace composition', () => {
  it('survives prune through bundle construction, checkpoint, and cache promotion', async () => {
    const cache = await cas.caches.open({ namespace: 'integration/promoted-materializations' });
    const workspace = await cas.workspaces.open({
      namespace: 'integration/bundle-build',
      ttlMs: 60_000,
    });
    const first = await workspace.pages.put({ source: Buffer.from('first shard') });
    pruneNow();
    const second = await workspace.pages.put({ source: Buffer.from('second shard') });
    pruneNow();

    const bundle = await workspace.bundles.putOrdered({
      members: [
        ['shards/first.cbor', first.handle],
        ['shards/second.cbor', second.handle],
      ],
    });
    pruneNow();
    await workspace.checkpoint({ handles: [bundle.handle] });
    pruneNow();

    await expect(cas.pages.get({ handle: first.handle })).resolves.toEqual(
      new Uint8Array(Buffer.from('first shard')),
    );
    const promoted = await workspace.promoteToCache({
      cache,
      key: 'materialization:v1',
      handle: bundle.handle,
      options: { retention: 'evictable' },
    });
    expect(promoted.release.changed).toBe(true);
    pruneNow();

    const hit = await cache.get('materialization:v1');
    expect(hit?.handle.toString()).toBe(bundle.handle.toString());
    await expect(cas.bundles.getMember({
      handle: bundle.handle,
      path: 'shards/second.cbor',
    })).resolves.toMatchObject({ handle: second.handle });
  });
});

describe('scoped staging workspace mirrored capabilities', () => {
  it('retains asset writes, adopted trees, and inline bundle members', async () => {
    const workspace = await cas.workspaces.open({
      namespace: 'integration/mirrored-capabilities',
      ttlMs: 60_000,
    });
    const firstPayload = Buffer.from('workspace asset payload');
    const first = await workspace.assets.put({
      source: chunks(firstPayload),
      slug: 'workspace-asset',
      filename: 'workspace.txt',
    });
    pruneNow();
    expect(await collect(cas.assets.open({ handle: first.handle }))).toEqual(firstPayload);

    const secondPayload = Buffer.from('adopted asset payload');
    const staged = await cas.assets.put({
      source: chunks(secondPayload),
      slug: 'adopted-asset',
      filename: 'adopted.txt',
    });
    const adopted = await workspace.assets.adopt({ treeOid: staged.handle.oid });
    const bundle = await workspace.bundles.put({
      members: { 'inline/value.txt': Buffer.from('inline member') },
    });
    pruneNow();

    expect(await collect(cas.assets.open({ handle: adopted.handle }))).toEqual(secondPayload);
    await expect(cas.bundles.getMember({
      handle: bundle.handle,
      path: 'inline/value.txt',
    })).resolves.toMatchObject({ path: 'inline/value.txt' });
    expect(bundle.toJSON().witness.root.kind).toBe('root-set');
    const inspection = await cas.workspaces.inspect({
      namespace: 'integration/mirrored-capabilities',
      limit: 10,
    });
    expect(inspection.workspaces[0]).toMatchObject({
      posture: 'active',
      rootCount: 3,
      logicalBytes: expect.any(Number),
      rootObjectBytes: expect.any(Number),
    });
    expect(inspection.workspaces[0].logicalBytes).toBeGreaterThanOrEqual(
      firstPayload.length + secondPayload.length,
    );
    expect(inspection.workspaces[0].rootObjectBytes).toBeGreaterThan(0);
    await workspace.release();
  });
});

describe('scoped staging workspace expiry', () => {
  it('preserves an expired root until bounded sweep removes its exact generation', async () => {
    const workspace = await cas.workspaces.open({
      namespace: 'integration/abandoned-builds',
      ttlMs: 1000,
    });
    const staged = await workspace.pages.put({ source: Buffer.from('abandoned shard') });
    now = START + 1001;

    const inspection = await cas.workspaces.inspect({
      namespace: 'integration/abandoned-builds',
      limit: 10,
    });
    expect(inspection.workspaces[0]).toMatchObject({ posture: 'expired', rootCount: 1 });
    pruneNow();
    expect(objectExists(staged.handle.oid)).toBe(true);

    await expect(cas.workspaces.sweep({
      namespace: 'integration/abandoned-builds',
      limit: 10,
    })).resolves.toMatchObject({ changed: 1, conflicted: 0 });
    pruneNow();
    expect(objectExists(staged.handle.oid)).toBe(false);
  });
});
