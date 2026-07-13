/** Real-Git proof for CacheSet reachability, expiry, and replacement. */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ContentAddressableStore from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node',
  );
}

vi.setConfig({ testTimeout: 20_000, hookTimeout: 30_000 });

let cache;
let cas;
let repoDir;
let time = Date.parse('2026-07-13T12:00:00.000Z');

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

function prunableOids() {
  return new Set(
    git(['prune', '-n', '--expire=now'])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ')[0]),
  );
}

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cache-set-integ-'));
  git(['init', '--bare']);
  cas = new ContentAddressableStore({
    plumbing: await createGitPlumbing({ cwd: repoDir }),
    clock: { now: () => new Date(time) },
  });
  cache = await cas.caches.open({ namespace: 'git-warp/materializations' });
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('CacheSet Git reachability', () => {
  it('anchors a staged target through one parentless current generation', async () => {
    const target = await cas.pages.put({ source: Buffer.from('retained') });
    expect(prunableOids()).toContain(target.handle.oid);

    const result = await cache.put('current', target.handle);
    const rootLine = git(['ls-tree', result.generation, result.witness.root.path]);

    expect(prunableOids()).not.toContain(target.handle.oid);
    expect(rootLine).toContain('tree');
    expect(git(['cat-file', '-p', cache.ref])).not.toMatch(/^parent /m);
    expect(result.witness.root.generation).toBe(git(['rev-parse', cache.ref]));
  });

  it('makes a removed target collectible while retaining the winning index', async () => {
    const old = await cache.get('current');
    const removed = await cache.remove('current');

    expect(removed.removed.handle).toEqual(old.handle);
    expect(prunableOids()).toContain(old.handle.oid);
    expect(prunableOids()).not.toContain(removed.witness.handle.oid);
    await expect(cache.doctor()).resolves.toMatchObject({ healthy: true });
  });
});

describe('CacheSet replacement policy', () => {
  it('replaces one target without losing a concurrent cache key', async () => {
    const left = await cas.caches.open({ namespace: 'git-warp/materializations' });
    const right = await cas.caches.open({ namespace: 'git-warp/materializations' });
    const [leftPage, rightPage] = await Promise.all([
      cas.pages.put({ source: Buffer.from('left') }),
      cas.pages.put({ source: Buffer.from('right') }),
    ]);

    await Promise.all([
      left.put('left', leftPage.handle),
      right.put('right', rightPage.handle),
    ]);

    expect((await cache.get('left')).handle).toEqual(leftPage.handle);
    expect((await cache.get('right')).handle).toEqual(rightPage.handle);
  });

  it('retains only the winner of concurrent guarded replacement', async () => {
    const left = await cas.caches.open({ namespace: 'git-warp/replacement-proof' });
    const right = await cas.caches.open({ namespace: 'git-warp/replacement-proof' });
    const original = await cas.pages.put({ source: Buffer.from('replacement-original') });
    const leftPage = await cas.pages.put({ source: Buffer.from('replacement-left') });
    const rightPage = await cas.pages.put({ source: Buffer.from('replacement-right') });
    await left.put('shared', original.handle);

    const results = await Promise.all([
      left.replace('shared', leftPage.handle, { expectedHandle: original.handle }),
      right.replace('shared', rightPage.handle, { expectedHandle: original.handle }),
    ]);

    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    const winner = (await left.get('shared')).handle;
    const loser = winner.toString() === leftPage.handle.toString() ? rightPage.handle : leftPage.handle;
    expect(prunableOids()).not.toContain(winner.oid);
    expect(prunableOids()).toContain(loser.oid);
  });

});

describe('CacheSet expiry and capacity policy', () => {
  it('releases expired and evicted targets while preserving pins', async () => {
    const expiry = await cas.caches.open({ namespace: 'git-warp/expiry-proof' });
    const expiring = await cas.pages.put({ source: Buffer.from('expiring-target') });
    await expiry.put('expiring', expiring.handle, {
      expiresAt: new Date(time + 1000),
    });
    time += 1001;
    await expiry.sweep();

    const capacity = await cas.caches.open({
      namespace: 'git-warp/capacity-proof',
      policy: { maxEntries: 1 },
    });
    const pinned = await cas.pages.put({ source: Buffer.from('pinned-target') });
    const evictable = await cas.pages.put({ source: Buffer.from('evictable-target') });
    await capacity.put('pinned', pinned.handle, { retention: 'pinned' });
    time += 1;
    await capacity.put('evictable', evictable.handle);
    await capacity.sweep();

    expect(prunableOids()).toContain(expiring.handle.oid);
    expect(prunableOids()).not.toContain(pinned.handle.oid);
    expect(prunableOids()).toContain(evictable.handle.oid);
  });
});
