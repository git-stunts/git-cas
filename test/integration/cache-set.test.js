/** Real-Git proof for CacheSet reachability, expiry, and replacement. */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ContentAddressableStore from '../../index.js';
import GitRefAdapter from '../../src/infrastructure/adapters/GitRefAdapter.js';
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
let gitRefs;
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

function refExists(ref) {
  return spawnSync('git', ['show-ref', '--verify', '--quiet', ref], {
    cwd: repoDir,
    encoding: 'utf8',
  }).status === 0;
}

function symbolicTarget(ref) {
  const result = spawnSync('git', ['symbolic-ref', '--quiet', ref], {
    cwd: repoDir,
    encoding: 'utf8',
  });
  if (result.status === 1) {
    return null;
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr || result.stdout || 'git symbolic-ref failed'}`.trim());
  }
  return result.stdout.trim();
}

function hookPlumbing(plumbing, hook) {
  return new Proxy(plumbing, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') {
        return value;
      }
      if (property === 'execute') {
        return (options) => {
          hook(options);
          return value.call(target, options);
        };
      }
      return value.bind(target);
    },
  });
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
  gitRefs = new GitRefAdapter({ plumbing });
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
  it('keeps an acquired target reachable through replacement and aggressive prune', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/acquisition-prune-proof' });
    const target = await cas.pages.put({ source: Buffer.from('acquired-target') });
    const replacement = await cas.pages.put({ source: Buffer.from('replacement-target') });
    await scoped.put('current', target.handle);
    const acquisition = await scoped.acquire('current');
    await scoped.replace('current', replacement.handle, { expectedHandle: target.handle });

    git(['reflog', 'expire', '--expire=now', '--all']);
    git(['prune', '--expire=now']);
    expect(objectExists(target.handle.oid)).toBe(true);
    expect(git(['rev-parse', acquisition.evidence.root.ref]))
      .toBe(acquisition.hit.generation);

    await acquisition.release();
    git(['reflog', 'expire', '--expire=now', '--all']);
    git(['prune', '--expire=now']);
    expect(objectExists(target.handle.oid)).toBe(false);
    expect(objectExists(replacement.handle.oid)).toBe(true);
  });
});

describe('CacheSet scoped acquisition cost', () => {
  it('does not scale acquisition Git reads with the target support graph', async () => {
    const smallCache = await cas.caches.open({ namespace: 'git-warp/acquisition-cost-small' });
    const largeCache = await cas.caches.open({ namespace: 'git-warp/acquisition-cost-large' });
    const small = await cas.pages.put({ source: Buffer.from('small') });
    const outerMembers = {};
    for (let branch = 0; branch < 8; branch += 1) {
      const innerMembers = {};
      for (let leaf = 0; leaf < 8; leaf += 1) {
        const member = await cas.pages.put({ source: Buffer.from(`member-${branch}-${leaf}`) });
        innerMembers[`member-${String(leaf).padStart(3, '0')}`] = member.handle;
      }
      const inner = await cas.bundles.put({ members: innerMembers });
      outerMembers[`branch-${String(branch).padStart(3, '0')}`] = inner.handle;
    }
    const large = await cas.bundles.put({ members: outerMembers });
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

// eslint-disable-next-line max-lines-per-function
describe('CacheSet acquisition source ref authority', () => {
  it('does not anchor through a symbolic cache source ref', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/acquisition-source-symref' });
    const target = await cas.pages.put({ source: Buffer.from('source-symref-target') });
    const stored = await scoped.put('current', target.handle);
    const sentinelRef = 'refs/heads/acquisition-source-sentinel';
    const acquisitionRef = 'refs/cas/cache-acquisitions/authority/source-known-id';
    git(['update-ref', sentinelRef, stored.generation]);
    git(['symbolic-ref', scoped.ref, sentinelRef]);

    await expect(gitRefs.anchorRef({
      sourceRef: scoped.ref,
      expectedSourceOid: stored.generation,
      targetRef: acquisitionRef,
    })).resolves.toBe(false);
    expect(refExists(acquisitionRef)).toBe(false);
    expect(git(['symbolic-ref', scoped.ref])).toBe(sentinelRef);
    expect(git(['rev-parse', sentinelRef])).toBe(stored.generation);
  });

  it('contains a post-probe source symref race without mutating its referent', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/acquisition-source-race' });
    const target = await cas.pages.put({ source: Buffer.from('source-race-target') });
    const stored = await scoped.put('current', target.handle);
    const sentinelRef = 'refs/heads/acquisition-source-race-sentinel';
    const acquisitionRef = 'refs/cas/cache-acquisitions/authority/source-race-id';
    git(['update-ref', sentinelRef, stored.generation]);
    const plumbing = await createGitPlumbing({ cwd: repoDir });
    let raced = false;
    const racingRefs = new GitRefAdapter({
      plumbing: hookPlumbing(plumbing, ({ args }) => {
        if (!raced && args[0] === 'update-ref' && args.includes('--stdin')) {
          raced = true;
          git(['symbolic-ref', scoped.ref, sentinelRef]);
        }
      }),
    });

    await expect(racingRefs.anchorRef({
      sourceRef: scoped.ref,
      expectedSourceOid: stored.generation,
      targetRef: acquisitionRef,
    })).resolves.toBe(true);

    expect(raced).toBe(true);
    expect(symbolicTarget(scoped.ref)).toBe(sentinelRef);
    expect(symbolicTarget(acquisitionRef)).toBeNull();
    expect(git(['rev-parse', acquisitionRef])).toBe(stored.generation);
    expect(git(['rev-parse', sentinelRef])).toBe(stored.generation);
  });
});

// eslint-disable-next-line max-lines-per-function
describe('managed ref update authority', () => {
  it('does not follow an observed managed symbolic ref', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/update-ref-symref' });
    const firstTarget = await cas.pages.put({ source: Buffer.from('update-first') });
    const first = await scoped.put('first', firstTarget.handle);
    const secondTarget = await cas.pages.put({ source: Buffer.from('update-second') });
    const second = await scoped.put('second', secondTarget.handle);
    const sentinelRef = 'refs/heads/update-ref-sentinel';
    git(['update-ref', sentinelRef, second.generation]);
    git(['symbolic-ref', scoped.ref, sentinelRef]);

    await expect(gitRefs.updateRef({
      ref: scoped.ref,
      newOid: first.generation,
      expectedOldOid: second.generation,
    })).rejects.toMatchObject({ code: 'GIT_REF_CONFLICT' });

    expect(symbolicTarget(scoped.ref)).toBe(sentinelRef);
    expect(git(['rev-parse', sentinelRef])).toBe(second.generation);
  });

  it('contains a post-probe managed symref race to the managed name', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/update-ref-race' });
    const firstTarget = await cas.pages.put({ source: Buffer.from('update-race-first') });
    const first = await scoped.put('first', firstTarget.handle);
    const secondTarget = await cas.pages.put({ source: Buffer.from('update-race-second') });
    const second = await scoped.put('second', secondTarget.handle);
    const sentinelRef = 'refs/heads/update-ref-race-sentinel';
    git(['update-ref', sentinelRef, second.generation]);
    const plumbing = await createGitPlumbing({ cwd: repoDir });
    let raced = false;
    const racingRefs = new GitRefAdapter({
      plumbing: hookPlumbing(plumbing, ({ args }) => {
        if (!raced && args[0] === 'update-ref' && args.includes('--no-deref')) {
          raced = true;
          git(['symbolic-ref', scoped.ref, sentinelRef]);
        }
      }),
    });

    await expect(racingRefs.updateRef({
      ref: scoped.ref,
      newOid: first.generation,
      expectedOldOid: second.generation,
    })).resolves.toBeUndefined();

    expect(raced).toBe(true);
    expect(symbolicTarget(scoped.ref)).toBeNull();
    expect(git(['rev-parse', scoped.ref])).toBe(first.generation);
    expect(git(['rev-parse', sentinelRef])).toBe(second.generation);
  });
});

// eslint-disable-next-line max-lines-per-function
describe('CacheSet acquisition target ref authority', () => {
  it('does not follow a pre-existing target symbolic ref during atomic anchoring', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/acquisition-anchor-symref' });
    const target = await cas.pages.put({ source: Buffer.from('anchor-symref-target') });
    const stored = await scoped.put('current', target.handle);
    const sentinelRef = 'refs/heads/acquisition-anchor-sentinel';
    const acquisitionRef = 'refs/cas/cache-acquisitions/authority/known-id';
    git(['symbolic-ref', acquisitionRef, sentinelRef]);

    await expect(gitRefs.anchorRef({
      sourceRef: scoped.ref,
      expectedSourceOid: stored.generation,
      targetRef: acquisitionRef,
    })).resolves.toBe(false);
    expect(refExists(sentinelRef)).toBe(false);
    expect(git(['symbolic-ref', acquisitionRef])).toBe(sentinelRef);
  });

  it('refuses to release through a symbolic acquisition ref', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/acquisition-release-symref' });
    const target = await cas.pages.put({ source: Buffer.from('release-symref-target') });
    await scoped.put('current', target.handle);
    const acquisition = await scoped.acquire('current');
    const sentinelRef = 'refs/heads/acquisition-release-sentinel';
    git(['update-ref', '-d', acquisition.evidence.root.ref]);
    git(['update-ref', sentinelRef, acquisition.hit.generation]);
    git(['symbolic-ref', acquisition.evidence.root.ref, sentinelRef]);

    await expect(acquisition.release()).rejects.toMatchObject({
      code: 'CACHE_ACQUISITION_RELEASE_CONFLICT',
    });
    expect(git(['rev-parse', sentinelRef])).toBe(acquisition.hit.generation);
    expect(git(['symbolic-ref', acquisition.evidence.root.ref])).toBe(sentinelRef);
  });

  it('contains a post-probe release symref race to the managed ref name', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/acquisition-release-race' });
    const target = await cas.pages.put({ source: Buffer.from('release-race-target') });
    const stored = await scoped.put('current', target.handle);
    const acquisitionRef = 'refs/cas/cache-acquisitions/authority/release-race-id';
    git(['update-ref', acquisitionRef, stored.generation]);
    const sentinelRef = 'refs/heads/acquisition-release-race-sentinel';
    git(['update-ref', sentinelRef, stored.generation]);
    const plumbing = await createGitPlumbing({ cwd: repoDir });
    let raced = false;
    const racingRefs = new GitRefAdapter({
      plumbing: hookPlumbing(plumbing, ({ args }) => {
        if (!raced && args[0] === 'update-ref' && args.includes('-d')) {
          raced = true;
          git(['update-ref', '-d', acquisitionRef]);
          git(['symbolic-ref', acquisitionRef, sentinelRef]);
        }
      }),
    });

    await expect(racingRefs.deleteRef({
      ref: acquisitionRef,
      expectedOldOid: stored.generation,
    })).resolves.toBe(true);

    expect(raced).toBe(true);
    expect(symbolicTarget(acquisitionRef)).toBeNull();
    expect(git(['rev-parse', sentinelRef])).toBe(stored.generation);
  });

  it('fails closed when a release race leaves a dangling symbolic ref', async () => {
    const scoped = await cas.caches.open({ namespace: 'git-warp/acquisition-release-dangling' });
    const target = await cas.pages.put({ source: Buffer.from('release-dangling-target') });
    const stored = await scoped.put('current', target.handle);
    const acquisitionRef = 'refs/cas/cache-acquisitions/authority/release-dangling-id';
    const danglingTarget = 'refs/heads/acquisition-release-not-created';
    git(['update-ref', acquisitionRef, stored.generation]);
    const plumbing = await createGitPlumbing({ cwd: repoDir });
    let raced = false;
    const racingRefs = new GitRefAdapter({
      plumbing: hookPlumbing(plumbing, ({ args }) => {
        if (!raced && args[0] === 'update-ref' && args.includes('-d')) {
          raced = true;
          git(['update-ref', '-d', acquisitionRef]);
          git(['symbolic-ref', acquisitionRef, danglingTarget]);
        }
      }),
    });

    await expect(racingRefs.deleteRef({
      ref: acquisitionRef,
      expectedOldOid: stored.generation,
    })).rejects.toMatchObject({
      code: 'GIT_REF_CONFLICT',
      meta: { actualSymref: danglingTarget },
    });

    expect(raced).toBe(true);
    expect(symbolicTarget(acquisitionRef)).toBe(danglingTarget);
    expect(refExists(danglingTarget)).toBe(false);
  });
});
