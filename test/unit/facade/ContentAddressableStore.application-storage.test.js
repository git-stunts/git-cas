import { describe, expect, it, vi } from 'vitest';
import ContentAddressableStore, {
  AssetHandle,
  BundleHandle,
  CacheHit,
  CachePolicy,
  CacheSet,
  ExpiringMarker,
  ExpiringSet,
  PageHandle,
  RetentionWitness,
  StagedAsset,
  StagedBundle,
  StagedPage,
  StagingWorkspace,
} from '../../../index.js';

function mockPlumbing() {
  return {
    execute: vi.fn(),
    executeStream: vi.fn(),
  };
}

describe('ContentAddressableStore application storage capabilities', () => {
  it('exposes frozen high-level capability groups', () => {
    const cas = new ContentAddressableStore({
      plumbing: mockPlumbing(),
      applicationRefPrefixes: ['refs/warp/'],
    });

    expect(Object.keys(cas.assets)).toEqual(['put', 'adopt', 'open']);
    expect(Object.keys(cas.pages)).toEqual(['put', 'putBatch', 'get', 'open']);
    expect(Object.keys(cas.bundles)).toEqual([
      'put',
      'putOrdered',
      'getMember',
      'getMemberReference',
      'iterateMembers',
      'iterateMemberReferences',
      'openMember',
    ]);
    expect(Object.keys(cas.caches)).toEqual(['open']);
    expect(Object.keys(cas.expiringSets)).toEqual(['open']);
    expect(Object.keys(cas.workspaces)).toEqual(['open', 'inspect', 'sweep']);
    expect(Object.keys(cas.retention)).toEqual(['retain']);
    expect(Object.keys(cas.publications)).toEqual(['commit']);
    expect(Object.isFrozen(cas.assets)).toBe(true);
    expect(Object.isFrozen(cas.pages)).toBe(true);
    expect(Object.isFrozen(cas.bundles)).toBe(true);
    expect(Object.isFrozen(cas.caches)).toBe(true);
    expect(Object.isFrozen(cas.expiringSets)).toBe(true);
    expect(Object.isFrozen(cas.workspaces)).toBe(true);
    expect(Object.isFrozen(cas.retention)).toBe(true);
    expect(Object.isFrozen(cas.publications)).toBe(true);
  });

  it('exports immutable result constructors from the package root', () => {
    expect(AssetHandle).toBeTypeOf('function');
    expect(BundleHandle).toBeTypeOf('function');
    expect(PageHandle).toBeTypeOf('function');
    expect(StagedAsset).toBeTypeOf('function');
    expect(StagedBundle).toBeTypeOf('function');
    expect(StagedPage).toBeTypeOf('function');
    expect(RetentionWitness).toBeTypeOf('function');
    expect(CacheHit).toBeTypeOf('function');
    expect(CachePolicy).toBeTypeOf('function');
    expect(CacheSet).toBeTypeOf('function');
    expect(ExpiringMarker).toBeTypeOf('function');
    expect(ExpiringSet).toBeTypeOf('function');
    expect(StagingWorkspace).toBeTypeOf('function');
  });
});

describe('ContentAddressableStore page cache configuration', () => {
  it.each([
    ['pageCacheEntries', { pageCacheEntries: 0 }],
    ['pageCacheBytes', { pageCacheBytes: -1 }],
  ])('threads invalid %s bounds to the page service', async (_name, cache) => {
    const cas = new ContentAddressableStore({ plumbing: mockPlumbing(), ...cache });

    await expect(cas.pages.put({ source: Buffer.from('unused') })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });
});

describe('ContentAddressableStore caches', () => {
  it('opens a cache set through the facade namespace', async () => {
    const cas = new ContentAddressableStore({ plumbing: mockPlumbing() });
    const cache = await cas.caches.open({ namespace: 'git-warp/materializations' });

    expect(cache).toBeInstanceOf(CacheSet);
    expect(cache.ref).toBe('refs/cas/caches/git-warp/materializations');
  });
});

describe('ContentAddressableStore expiring sets', () => {
  it('opens an expiry-only set through the facade namespace', async () => {
    const cas = new ContentAddressableStore({ plumbing: mockPlumbing() });
    const set = await cas.expiringSets.open({ namespace: 'git-warp/replay' });

    expect(set).toBeInstanceOf(ExpiringSet);
    expect(set.ref).toBe('refs/cas/expiring/git-warp/replay');
  });
});

describe('ContentAddressableStore workspaces', () => {
  it('opens an uninstalled scoped staging workspace through the facade', async () => {
    const cas = new ContentAddressableStore({ plumbing: mockPlumbing() });
    const workspace = await cas.workspaces.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    expect(workspace).toBeInstanceOf(StagingWorkspace);
    expect(workspace.namespace).toBe('git-warp/materializations');
    expect(workspace.expiresAt).toBeNull();
    await expect(workspace.release()).resolves.toMatchObject({ changed: false });
  });
});
