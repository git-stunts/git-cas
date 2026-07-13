import { describe, expect, it, vi } from 'vitest';
import ContentAddressableStore, {
  AssetHandle,
  BundleHandle,
  PageHandle,
  RetentionWitness,
  StagedAsset,
  StagedBundle,
  StagedPage,
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
    expect(Object.keys(cas.pages)).toEqual(['put', 'get', 'open']);
    expect(Object.keys(cas.bundles)).toEqual(['put', 'putOrdered', 'getMember', 'openMember']);
    expect(Object.keys(cas.retention)).toEqual(['retain']);
    expect(Object.keys(cas.publications)).toEqual(['commit']);
    expect(Object.isFrozen(cas.assets)).toBe(true);
    expect(Object.isFrozen(cas.pages)).toBe(true);
    expect(Object.isFrozen(cas.bundles)).toBe(true);
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
  });
});
