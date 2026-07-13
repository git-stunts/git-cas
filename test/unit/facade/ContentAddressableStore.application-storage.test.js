import { describe, expect, it, vi } from 'vitest';
import ContentAddressableStore, {
  AssetHandle,
  RetentionWitness,
  StagedAsset,
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
    expect(Object.keys(cas.retention)).toEqual(['retain']);
    expect(Object.keys(cas.publications)).toEqual(['commit']);
    expect(Object.isFrozen(cas.assets)).toBe(true);
    expect(Object.isFrozen(cas.retention)).toBe(true);
    expect(Object.isFrozen(cas.publications)).toBe(true);
  });

  it('exports immutable result constructors from the package root', () => {
    expect(AssetHandle).toBeTypeOf('function');
    expect(StagedAsset).toBeTypeOf('function');
    expect(RetentionWitness).toBeTypeOf('function');
  });
});
