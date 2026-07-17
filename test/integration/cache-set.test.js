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
let commandTrace;
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

function objectExists(oid) {
  return spawnSync('git', ['cat-file', '-e', oid], {
    cwd: repoDir,
    encoding: 'utf8',
  }).status === 0;
}

function tracedPlumbing(plumbing) {
  return new Proxy(plumbing, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') {
        return value;
      }
      if (property === 'execute' || property === 'executeStream') {
        return (options) => {
          commandTrace.push({ operation: property, options });
          return value.call(target, options);
        };
      }
      return value.bind(target);
    },
  });
}

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cache-set-integ-'));
  git(['init', '--bare']);
  commandTrace = [];
  const plumbing = await createGitPlumbing({ cwd: repoDir });
  cas = new ContentAddressableStore({
    plumbing: tracedPlumbing(plumbing),
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
    const removalCache = await cas.caches.open({ namespace: 'git-warp/removal-proof' });
    const target = await cas.pages.put({ source: Buffer.from('removed-target') });
    await removalCache.put('current', target.handle);
    const old = await removalCache.get('current');
    const removed = await removalCache.remove('current');

    expect(removed.removed.handle).toEqual(old.handle);
    expect(prunableOids()).toContain(old.handle.oid);
    expect(prunableOids()).not.toContain(removed.witness.handle.oid);
    await expect(removalCache.doctor()).resolves.toMatchObject({ healthy: true });
  });
});

describe('CacheSet scoped acquisition prune safety', () => {
  it('keeps an acquired target reachable through removal and aggressive prune', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/acquisition-prune-proof' });
    const target = await cas.pages.put({ source: Buffer.from('acquired-target') });
    await scoped.put('current', target.handle);
    const acquisition = await scoped.acquire('current');
    await scoped.remove('current');

    git(['reflog', 'expire', '--expire=now', '--all']);
    git(['prune', '--expire=now']);
    expect(objectExists(target.handle.oid)).toBe(true);
    expect(git(['rev-parse', acquisition.evidence.root.ref]))
      .toBe(acquisition.hit.generation);

    await acquisition.release();
    git(['reflog', 'expire', '--expire=now', '--all']);
    git(['prune', '--expire=now']);
    expect(objectExists(target.handle.oid)).toBe(false);
  });
});

describe('CacheSet scoped acquisition cost', () => {
  it('does not scale acquisition Git reads with the target support graph', async () => {
    const smallCache = await cas.caches.open({ namespace: 'git-warp/acquisition-cost-small' });
    const largeCache = await cas.caches.open({ namespace: 'git-warp/acquisition-cost-large' });
    const small = await cas.pages.put({ source: Buffer.from('small') });
    const members = {};
    for (let index = 0; index < 64; index += 1) {
      const member = await cas.pages.put({ source: Buffer.from(`member-${index}`) });
      members[`member-${String(index).padStart(3, '0')}`] = member.handle;
    }
    const large = await cas.bundles.put({ members });
    await smallCache.put('current', small.handle);
    await largeCache.put('current', large.handle);

    commandTrace.length = 0;
    const smallAcquisition = await smallCache.acquire('current');
    const smallReads = commandTrace.length;
    commandTrace.length = 0;
    const largeAcquisition = await largeCache.acquire('current');
    const largeReads = commandTrace.length;

    expect(largeReads).toBe(smallReads);
    expect(largeReads).toBeGreaterThan(0);
    await smallAcquisition.release();
    await largeAcquisition.release();
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
