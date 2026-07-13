/**
 * Real-Git proof for opaque assets, retention witnesses, and publication.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ContentAddressableStore, { AssetHandle } from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node'
  );
}

vi.setConfig({ testTimeout: 20_000, hookTimeout: 30_000 });

const ROOT_SET_REF = 'refs/cas/rootsets/integration/application-assets';
const OBSERVED_AT = '2026-07-13T10:00:00.000Z';
const tempDirs = [];
let repoDir;
let cas;

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function gitAt(cwd, args, input) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', input });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr || result.stdout || 'git failed'}`.trim());
  }
  return result.stdout.trim();
}

function git(args, input) {
  return gitAt(repoDir, args, input);
}

function prunableOids() {
  return new Set(
    git(['prune', '-n', '--expire=now'])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ')[0])
  );
}

async function* source(bytes) {
  const window = 333;
  for (let offset = 0; offset < bytes.length; offset += window) {
    yield bytes.subarray(offset, offset + window);
  }
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function stage(value, slug) {
  const payload = Buffer.from(value.repeat(1024));
  const staged = await cas.assets.put({
    source: source(payload),
    slug,
    filename: `${slug}.txt`,
  });
  return { payload, staged };
}

beforeAll(async () => {
  repoDir = tempDir('cas-application-storage-');
  git(['init', '--bare']);
  cas = new ContentAddressableStore({
    plumbing: await createGitPlumbing({ cwd: repoDir }),
    chunkSize: 1024,
    applicationRefPrefixes: ['refs/warp/'],
    clock: { now: () => new Date(OBSERVED_AT) },
  });
});

afterAll(() => {
  for (const dir of tempDirs.reverse()) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('application asset retention', () => {
  it('moves staged and replaced assets through real reachability states', async () => {
    const first = await stage('first', 'retained-first');
    expect(await collect(cas.assets.open({ handle: first.staged.handle }))).toEqual(first.payload);
    expect(prunableOids()).toContain(first.staged.handle.oid);

    const retained = await cas.retention.retain({
      handle: first.staged.handle,
      root: { ref: ROOT_SET_REF, name: 'current' },
      policy: 'evictable',
    });
    expect(prunableOids()).not.toContain(first.staged.handle.oid);
    expect(git(['rev-parse', ROOT_SET_REF])).toBe(retained.witness.root.generation);
    expect(
      git(['ls-tree', retained.witness.root.generation, retained.witness.root.path])
    ).toContain(first.staged.handle.oid);

    const second = await stage('second', 'retained-second');
    await cas.retention.retain({
      handle: second.staged.handle,
      root: { ref: ROOT_SET_REF, name: 'current' },
      policy: 'evictable',
    });
    expect(prunableOids()).toContain(first.staged.handle.oid);
    expect(prunableOids()).not.toContain(second.staged.handle.oid);
  });
});

describe('application publication', () => {
  it('atomically publishes ordered causal history and reports conflicts', async () => {
    const first = await stage('publication-one', 'publication-one');
    const initial = await cas.publications.commit({
      root: first.staged.handle,
      commit: { message: 'initial', parents: [] },
      ref: { name: 'refs/warp/events', expected: null },
    });
    expect(git(['rev-parse', 'refs/warp/events'])).toBe(initial.commitId);
    expect(git(['rev-parse', `${initial.commitId}^{tree}`])).toBe(first.staged.handle.oid);

    await expect(
      cas.publications.commit({
        root: first.staged.handle,
        commit: { message: 'invalid tree parent', parents: [first.staged.handle.oid] },
        ref: { name: 'refs/warp/invalid-parent', expected: null },
      })
    ).rejects.toMatchObject({ code: 'PUBLICATION_INVALID' });

    const second = await stage('publication-two', 'publication-two');
    const next = await cas.publications.commit({
      root: second.staged.handle,
      commit: { message: 'next', parents: [initial.commitId] },
      ref: { name: 'refs/warp/events', expected: initial.commitId },
    });
    expect(git(['rev-list', '--parents', '-n', '1', next.commitId]).split(/\s+/u)).toEqual([
      next.commitId,
      initial.commitId,
    ]);

    await expect(
      cas.publications.commit({
        root: first.staged.handle,
        commit: { message: 'stale', parents: [initial.commitId] },
        ref: { name: 'refs/warp/events', expected: initial.commitId },
      })
    ).rejects.toMatchObject({
      code: 'PUBLICATION_CONFLICT',
      meta: { expected: initial.commitId, observed: next.commitId },
    });
    expect(git(['rev-parse', 'refs/warp/events'])).toBe(next.commitId);
  });
});

describe('asset handle transfer', () => {
  it('opens the same token after a mirror and fails explicitly without its graph', async () => {
    const { payload, staged } = await stage('portable', 'portable');
    await cas.publications.commit({
      root: staged.handle,
      commit: { message: 'portable root', parents: [] },
      ref: { name: 'refs/warp/portable', expected: null },
    });

    const mirrorDir = tempDir('cas-application-mirror-');
    gitAt(path.dirname(mirrorDir), ['clone', '--mirror', repoDir, mirrorDir]);
    const mirror = new ContentAddressableStore({
      plumbing: await createGitPlumbing({ cwd: mirrorDir }),
    });
    const transferred = AssetHandle.from(staged.handle.toString());
    expect(await collect(mirror.assets.open({ handle: transferred }))).toEqual(payload);

    const emptyDir = tempDir('cas-application-empty-');
    gitAt(emptyDir, ['init', '--bare']);
    const empty = new ContentAddressableStore({
      plumbing: await createGitPlumbing({ cwd: emptyDir }),
    });
    await expect(collect(empty.assets.open({ handle: transferred }))).rejects.toMatchObject({
      code: 'HANDLE_TARGET_MISSING',
    });
  });
});
