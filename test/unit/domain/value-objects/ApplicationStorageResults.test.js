import { describe, expect, it } from 'vitest';
import AssetHandle from '../../../../src/domain/value-objects/AssetHandle.js';
import BundleHandle from '../../../../src/domain/value-objects/BundleHandle.js';
import BundleLimits from '../../../../src/domain/value-objects/BundleLimits.js';
import PageHandle from '../../../../src/domain/value-objects/PageHandle.js';
import RetentionWitness from '../../../../src/domain/value-objects/RetentionWitness.js';
import StagedAsset from '../../../../src/domain/value-objects/StagedAsset.js';
import StagedBundle from '../../../../src/domain/value-objects/StagedBundle.js';

const handle = new AssetHandle({
  codec: 'json',
  oid: '0123456789abcdef0123456789abcdef01234567',
});
const observedAt = '2026-07-13T10:00:00.000Z';

function makeStaged(overrides = {}) {
  return new StagedAsset({
    handle,
    slug: 'alice-avatar',
    filename: 'alice.png',
    size: 42,
    observedAt,
    ...overrides,
  });
}

describe('StagedAsset', () => {
  it('states that staging created no reachability root', () => {
    const staged = makeStaged();

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

  it.each([
    ['slug', { slug: '' }],
    ['filename', { filename: '' }],
    ['size', { size: -1 }],
    ['observedAt', { observedAt: '2026-07-13T10:00:00Z' }],
  ])('rejects an invalid %s', (_field, override) => {
    expect(() => makeStaged(override)).toThrow(
      expect.objectContaining({ code: 'HANDLE_INVALID' })
    );
  });
});

describe('StagedBundle', () => {
  const bundleHandle = new BundleHandle({ codec: 'json', oid: 'b'.repeat(40) });
  const options = {
    handle: bundleHandle,
    memberCount: 0,
    indexDepth: 1,
    descriptorBytes: 42,
    limits: new BundleLimits(),
    observedAt,
  };

  it('normalizes valid limits into immutable staged evidence', () => {
    const staged = new StagedBundle(options);

    expect(staged.limits).toEqual(new BundleLimits().toJSON());
    expect(Object.isFrozen(staged.limits)).toBe(true);
  });

  it.each([
    [{ indexDepth: 0 }, 'HANDLE_INVALID'],
    [{ limits: { maxMembers: -1 } }, 'BUNDLE_LIMIT_INVALID'],
  ])('rejects impossible staged metadata %#', (override, code) => {
    expect(() => new StagedBundle({ ...options, ...override }))
      .toThrow(expect.objectContaining({ code }));
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

describe('RetentionWitness application handles', () => {
  it.each([
    ['asset', new AssetHandle({ codec: 'json', oid: 'a'.repeat(40) }), AssetHandle],
    ['bundle', new BundleHandle({ codec: 'json', oid: 'b'.repeat(40) }), BundleHandle],
    ['page', new PageHandle({ oid: 'c'.repeat(40) }), PageHandle],
  ])('accepts a %s application handle', (_kind, applicationHandle, HandleType) => {
    const witness = new RetentionWitness({
      handle: applicationHandle,
      policy: 'evictable',
      reachability: 'anchored',
      root: {
        kind: 'publication',
        namespace: 'refs/warp/',
        ref: 'refs/warp/pages',
        generation: 'c'.repeat(40),
        path: '/',
      },
      observedAt,
    });

    expect(witness.handle).toBeInstanceOf(HandleType);
    expect(witness.toJSON().handle).toBe(applicationHandle.toString());
  });
});

describe('RetentionWitness validation', () => {
  it.each([
    [{ policy: 'forever' }, 'RETENTION_WITNESS_INVALID'],
    [{ reachability: 'unknown' }, 'RETENTION_WITNESS_INVALID'],
    [{ root: { generation: 'bad' } }, 'RETENTION_WITNESS_INVALID'],
    [{ observedAt: 'tomorrow' }, 'RETENTION_WITNESS_INVALID'],
  ])('rejects invalid evidence %#', (override, code) => {
    const { root: rootOverride, ...topLevelOverride } = override;
    const root = {
      kind: 'root-set',
      namespace: 'warp-assets',
      ref: 'refs/cas/rootsets/warp-assets',
      generation: 'a'.repeat(40),
      path: 'root-00000000',
      ...rootOverride,
    };

    const options = {
      handle,
      policy: 'pinned',
      reachability: 'anchored',
      root,
      observedAt,
      ...topLevelOverride,
    };

    expect(() => new RetentionWitness(options)).toThrow(expect.objectContaining({ code }));
  });
});
