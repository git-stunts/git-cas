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

async function expectBundleMember(handle, memberPath, expected) {
  await expect(cas.bundles.getMember({
    handle,
    path: memberPath,
  })).resolves.toMatchObject(expected);
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

describe('scoped staging workspace page batches', () => {
  it('retains a bounded page batch under one exact workspace generation', async () => {
    const workspace = await cas.workspaces.open({
      namespace: 'integration/direct-page-batch',
      ttlMs: 60_000,
    });

    const staged = await workspace.pages.putBatch({
      pages: Array.from({ length: 32 }, (_, index) => ({
        source: Buffer.from(`retained batch page ${index}`),
      })),
      maxBatchBytes: 64 * 1024,
      maxBatchPages: 32,
    });

    expect(staged).toHaveLength(32);
    expect(new Set(staged.map((page) => page.witness.root.generation))).toEqual(
      new Set([staged[0].witness.root.generation]),
    );
    expect(git(['rev-parse', staged[0].witness.root.ref])).toBe(
      staged[0].witness.root.generation,
    );
    const reachable = reachableOids(staged[0].witness.root.ref);
    for (const page of staged) {
      expect(reachable).toContain(page.handle.oid);
    }
    pruneNow();
    for (const page of staged) {
      expect(objectExists(page.handle.oid)).toBe(true);
    }

    await workspace.release();
    pruneNow();
    for (const page of staged) {
      expect(objectExists(page.handle.oid)).toBe(false);
    }
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
    await expectBundleMember(bundle.handle, 'inline/value.txt', {
      path: 'inline/value.txt',
    });
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

describe('scoped staging workspace pagination', () => {
  it('pages past an active workspace to sweep a later expired workspace', async () => {
    const active = await cas.workspaces.open({
      namespace: 'integration/paginated-builds',
      ttlMs: 60_000,
    });
    await active.pages.put({ source: Buffer.from('active first page') });
    now = START + 1;
    const expired = await cas.workspaces.open({
      namespace: 'integration/paginated-builds',
      ttlMs: 1,
    });
    const expiredStage = await expired.pages.put({ source: Buffer.from('expired second page') });
    now = START + 3;

    const first = await cas.workspaces.sweep({
      namespace: 'integration/paginated-builds',
      limit: 1,
    });
    expect(first).toMatchObject({ changed: 0, truncated: true, nextCursor: expect.any(String) });
    const second = await cas.workspaces.sweep({
      namespace: 'integration/paginated-builds',
      limit: 1,
      cursor: first.nextCursor,
    });

    expect(second).toMatchObject({ changed: 1, truncated: false, nextCursor: null });
    pruneNow();
    expect(objectExists(expiredStage.handle.oid)).toBe(false);
    await active.release();
  });
});

describe('scoped staging workspace symbolic ref containment', () => {
  it('never follows or deletes a symbolic workspace ref during release or sweep', async () => {
    const releaseWorkspace = await cas.workspaces.open({
      namespace: 'integration/release-symref',
      ttlMs: 1,
    });
    const releaseStage = await releaseWorkspace.pages.put({ source: Buffer.from('release symref') });
    const releaseSentinel = 'refs/heads/workspace-release-sentinel';
    git(['update-ref', releaseSentinel, releaseStage.witness.root.generation]);
    git(['symbolic-ref', releaseStage.witness.root.ref, releaseSentinel]);

    await expect(releaseWorkspace.release()).rejects.toMatchObject({ code: 'GIT_REF_CONFLICT' });
    expect(git(['symbolic-ref', releaseStage.witness.root.ref])).toBe(releaseSentinel);
    expect(git(['rev-parse', releaseSentinel])).toBe(releaseStage.witness.root.generation);

    const sweepWorkspace = await cas.workspaces.open({
      namespace: 'integration/sweep-symref',
      ttlMs: 1,
    });
    const sweepStage = await sweepWorkspace.pages.put({ source: Buffer.from('sweep symref') });
    const sweepSentinel = 'refs/heads/workspace-sweep-sentinel';
    git(['update-ref', sweepSentinel, sweepStage.witness.root.generation]);
    git(['symbolic-ref', sweepStage.witness.root.ref, sweepSentinel]);
    now = START + 2;

    await expect(cas.workspaces.sweep({
      namespace: 'integration/sweep-symref',
      limit: 10,
    })).resolves.toMatchObject({ changed: 0, conflicted: 0 });
    expect(git(['symbolic-ref', sweepStage.witness.root.ref])).toBe(sweepSentinel);
    expect(git(['rev-parse', sweepSentinel])).toBe(sweepStage.witness.root.generation);

    git(['symbolic-ref', '--delete', releaseStage.witness.root.ref]);
    git(['symbolic-ref', '--delete', sweepStage.witness.root.ref]);
    git(['update-ref', '-d', releaseSentinel]);
    git(['update-ref', '-d', sweepSentinel]);
  });
});
