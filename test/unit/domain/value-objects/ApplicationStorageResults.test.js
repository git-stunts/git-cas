import { describe, expect, it } from 'vitest';
import AssetHandle from '../../../../src/domain/value-objects/AssetHandle.js';
import RetentionWitness from '../../../../src/domain/value-objects/RetentionWitness.js';
import StagedAsset from '../../../../src/domain/value-objects/StagedAsset.js';

const handle = new AssetHandle({
  codec: 'json',
  oid: '0123456789abcdef0123456789abcdef01234567',
});
const observedAt = '2026-07-13T10:00:00.000Z';

describe('StagedAsset', () => {
  it('states that staging created no reachability root', () => {
    const staged = new StagedAsset({
      handle,
      slug: 'alice-avatar',
      filename: 'alice.png',
      size: 42,
      observedAt,
    });

    expect(staged).toMatchObject({
      version: 1,
      state: 'staged',
      handle,
      asset: {
        slug: 'alice-avatar',
        filename: 'alice.png',
        size: 42,
      },
      retention: {
        policy: null,
        reachability: 'unanchored',
        protection: 'not-established',
      },
      observedAt,
    });
    expect(Object.isFrozen(staged)).toBe(true);
    expect(Object.isFrozen(staged.asset)).toBe(true);
    expect(Object.isFrozen(staged.retention)).toBe(true);
    expect(staged.toJSON().handle).toBe(handle.toString());
  });
});

describe('RetentionWitness', () => {
  it('captures immutable generation-scoped root evidence', () => {
    const witness = new RetentionWitness({
      handle,
      policy: 'pinned',
      reachability: 'anchored',
      root: {
        kind: 'root-set',
        namespace: 'warp-assets',
        ref: 'refs/cas/rootsets/warp-assets',
        generation: 'a'.repeat(40),
        path: 'root-00000000',
      },
      observedAt,
    });

    expect(witness.version).toBe(1);
    expect(witness.root.generation).toBe('a'.repeat(40));
    expect(witness.toJSON()).toEqual({
      version: 1,
      handle: handle.toString(),
      policy: 'pinned',
      reachability: 'anchored',
      root: {
        kind: 'root-set',
        namespace: 'warp-assets',
        ref: 'refs/cas/rootsets/warp-assets',
        generation: 'a'.repeat(40),
        path: 'root-00000000',
      },
      observedAt,
    });
    expect(Object.isFrozen(witness)).toBe(true);
    expect(Object.isFrozen(witness.root)).toBe(true);
  });
});

describe('RetentionWitness validation', () => {
  it.each([
    [{ policy: 'forever' }, 'RETENTION_WITNESS_INVALID'],
    [{ reachability: 'unknown' }, 'RETENTION_WITNESS_INVALID'],
    [{ root: { generation: 'bad' } }, 'RETENTION_WITNESS_INVALID'],
    [{ observedAt: 'tomorrow' }, 'RETENTION_WITNESS_INVALID'],
  ])('rejects invalid evidence %#', (override, code) => {
    const root = {
      kind: 'root-set',
      namespace: 'warp-assets',
      ref: 'refs/cas/rootsets/warp-assets',
      generation: 'a'.repeat(40),
      path: 'root-00000000',
      ...override.root,
    };

    const options = {
      handle,
      policy: 'pinned',
      reachability: 'anchored',
      root,
      observedAt,
      ...override,
    };
    options.root = root;

    expect(() => new RetentionWitness(options)).toThrow(expect.objectContaining({ code }));
  });
});
