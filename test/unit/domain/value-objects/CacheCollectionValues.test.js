import { describe, expect, it } from 'vitest';
import CacheAcquisition from '../../../../src/domain/value-objects/CacheAcquisition.js';
import CacheAcquisitionRef from '../../../../src/domain/value-objects/CacheAcquisitionRef.js';
import CacheHit from '../../../../src/domain/value-objects/CacheHit.js';
import CacheKey from '../../../../src/domain/value-objects/CacheKey.js';
import CachePolicy from '../../../../src/domain/value-objects/CachePolicy.js';
import CacheSetRef from '../../../../src/domain/value-objects/CacheSetRef.js';
import CollectionNamespace from '../../../../src/domain/value-objects/CollectionNamespace.js';
import ExpiringSetKey from '../../../../src/domain/value-objects/ExpiringSetKey.js';
import ExpiringSetRef from '../../../../src/domain/value-objects/ExpiringSetRef.js';
import PageHandle from '../../../../src/domain/value-objects/PageHandle.js';
import RetentionWitness from '../../../../src/domain/value-objects/RetentionWitness.js';

const ACQUIRED_AT = '2026-07-16T12:34:56.789Z';

function acquisitionValues() {
  const namespace = 'git-warp/materializations';
  const generation = 'b'.repeat(40);
  const handle = new PageHandle({ oid: 'a'.repeat(40) });
  const ref = CacheAcquisitionRef.create({
    namespace,
    keyDigest: 'c'.repeat(64),
    acquiredAt: ACQUIRED_AT,
    nonce: 'd'.repeat(32),
  });
  const hit = new CacheHit({
    key: 'role:alice',
    handle,
    policy: 'evictable',
    expiresAt: null,
    logicalBytes: 5,
    createdAt: ACQUIRED_AT,
    accessedAt: ACQUIRED_AT,
    generation,
    evidence: new RetentionWitness({
      handle,
      policy: 'evictable',
      reachability: 'anchored',
      root: {
        kind: 'cache-set',
        namespace,
        ref: 'refs/cas/caches/git-warp/materializations',
        generation,
        path: 'entries/0',
      },
      observedAt: ACQUIRED_AT,
    }),
  });
  const evidence = new RetentionWitness({
    handle,
    policy: 'pinned',
    reachability: 'anchored',
    root: {
      kind: 'cache-set',
      namespace,
      ref: ref.toString(),
      generation,
      path: 'entries/0',
    },
    observedAt: ACQUIRED_AT,
  });
  return { evidence, generation, hit, namespace, ref };
}

describe('CollectionNamespace', () => {
  it.each([
    'git-warp/materializations',
    'a',
    'one.two/three-four',
  ])('accepts canonical namespace %s', (value) => {
    expect(CollectionNamespace.from(value).toString()).toBe(value);
    expect(CacheSetRef.forNamespace(value).toString()).toBe(`refs/cas/caches/${value}`);
    expect(ExpiringSetRef.forNamespace(value).toString()).toBe(`refs/cas/expiring/${value}`);
  });

  it.each([
    '',
    '/leading',
    'trailing/',
    'UPPER',
    'two//slashes',
    'two..dots',
    'name.lock',
    'git-cas-private',
    'has space',
  ])('rejects non-canonical namespace %s', (value) => {
    expect(() => new CollectionNamespace(value)).toThrow(expect.objectContaining({
      code: 'COLLECTION_NAMESPACE_INVALID',
    }));
  });
});

describe('Cache key and policy values', () => {
  it('enforces canonical keys and bounded policies', () => {
    expect(CacheKey.from('role:alice').toString()).toBe('role:alice');
    expect(() => new CacheKey('e\u0301')).toThrow(expect.objectContaining({ code: 'CACHE_KEY_INVALID' }));
    expect(() => new CacheKey('\ud800')).toThrow(expect.objectContaining({ code: 'CACHE_KEY_INVALID' }));
    expect(ExpiringSetKey.from('nonce:one').toString()).toBe('nonce:one');
    expect(() => new ExpiringSetKey('e\u0301'))
      .toThrow(expect.objectContaining({ code: 'EXPIRING_SET_KEY_INVALID' }));
    expect(() => new ExpiringSetKey('\ud800'))
      .toThrow(expect.objectContaining({ code: 'EXPIRING_SET_KEY_INVALID' }));
    expect(new CachePolicy({ maxEntries: 4, maxBytes: 1024 })).toMatchObject({
      maxEntries: 4,
      maxBytes: 1024,
    });
    expect(() => new CachePolicy({ maxEntries: 100_000 }))
      .toThrow(expect.objectContaining({ code: 'CACHE_POLICY_INVALID' }));
  });
});

describe('CacheAcquisitionRef', () => {
  it('round-trips canonical namespace, time, key digest, and nonce fields', () => {
    const acquiredAt = '2026-07-16T12:34:56.789Z';
    const keyDigest = 'a'.repeat(64);
    const ref = CacheAcquisitionRef.create({
      namespace: 'git-warp/materializations',
      keyDigest,
      acquiredAt,
      nonce: 'b'.repeat(32),
    });

    expect(CacheAcquisitionRef.from(ref.toString())).toMatchObject({
      namespace: 'git-warp/materializations',
      acquiredAt,
      keyDigest,
      id: ref.id,
    });
    expect(ref.toString()).toMatch(
      /^refs\/cas\/cache-acquisitions\/git-warp%2Fmaterializations\/v1-/u,
    );
    expect(CacheAcquisitionRef.prefixForNamespace('git-warp/materializations'))
      .toBe('refs/cas/cache-acquisitions/git-warp%2Fmaterializations/');
  });

  it.each([
    'refs/heads/main',
    'refs/cas/cache-acquisitions/git-warp/materializations',
    `refs/cas/cache-acquisitions/git-warp/materializations/v1-0000000000000-${'a'.repeat(64)}-${'b'.repeat(32)}`,
    `refs/cas/cache-acquisitions/git-warp/materializations/v1-0000000000000-${'a'.repeat(63)}-${'b'.repeat(32)}`,
    `refs/cas/cache-acquisitions/git-warp/materializations/v1-0000000000000-${'a'.repeat(64)}-${'b'.repeat(31)}`,
    `refs/cas/cache-acquisitions/UPPER/v1-0000000000000-${'a'.repeat(64)}-${'b'.repeat(32)}`,
    `refs/cas/cache-acquisitions/git-warp%252Fmaterializations/v1-0000000000000-${'a'.repeat(64)}-${'b'.repeat(32)}`,
  ])('rejects malformed acquisition ref %s', (value) => {
    expect(() => CacheAcquisitionRef.from(value)).toThrow(expect.objectContaining({
      code: 'CACHE_ACQUISITION_INVALID',
    }));
  });

  it('does not allow an acquisition ID to extend the caller namespace', () => {
    const id = `v1-0000000000000-${'a'.repeat(64)}-${'b'.repeat(32)}`;

    expect(() => CacheAcquisitionRef.forId({
      namespace: 'git-warp/materializations',
      id: `nested/${id}`,
    })).toThrow(expect.objectContaining({ code: 'CACHE_ACQUISITION_INVALID' }));
  });
});

describe('CacheAcquisition', () => {
  it('binds its opaque ID, hit, generation, handle, and pinned witness', () => {
    const { evidence, hit, ref } = acquisitionValues();
    const acquisition = new CacheAcquisition({
      id: ref.id,
      hit,
      evidence,
      acquiredAt: ACQUIRED_AT,
      release: async () => ({ changed: true }),
    });

    expect(acquisition).toMatchObject({ id: ref.id, hit, evidence, acquiredAt: ACQUIRED_AT });
  });
});

describe('CacheAcquisition invariant failures', () => {
  it.each([
    ['non-canonical ID', ({ ref }) => ({ id: 'x', evidenceRef: ref.toString() })],
    ['unrelated ref', ({ ref }) => ({ id: ref.id, evidenceRef: `${ref.toString()}-other` })],
    ['wrong policy', ({ ref }) => ({ id: ref.id, evidenceRef: ref.toString(), policy: 'evictable' })],
    ['wrong generation', ({ ref }) => ({ id: ref.id, evidenceRef: ref.toString(), generation: 'e'.repeat(40) })],
    ['wrong namespace', ({ ref }) => ({
      id: ref.id,
      namespace: 'git-warp/other',
      evidenceRef: CacheAcquisitionRef.forId({
        namespace: 'git-warp/other',
        id: ref.id,
      }).toString(),
    })],
    ['wrong acquired time', ({ ref }) => ({
      id: ref.id,
      evidenceRef: ref.toString(),
      acquiredAt: '2026-07-16T12:34:56.790Z',
    })],
  ])('rejects %s retention evidence', (_name, mutate) => {
    const values = acquisitionValues();
    const mutation = mutate(values);
    const acquiredAt = mutation.acquiredAt ?? ACQUIRED_AT;
    const evidence = new RetentionWitness({
      handle: values.hit.handle,
      policy: mutation.policy ?? 'pinned',
      reachability: 'anchored',
      root: {
        kind: 'cache-set',
        namespace: mutation.namespace ?? values.namespace,
        ref: mutation.evidenceRef,
        generation: mutation.generation ?? values.generation,
        path: 'entries/0',
      },
      observedAt: acquiredAt,
    });

    expect(() => new CacheAcquisition({
      id: mutation.id,
      hit: values.hit,
      evidence,
      acquiredAt,
      release: async () => ({ changed: true }),
    })).toThrow(expect.objectContaining({ code: 'CACHE_ACQUISITION_INVALID' }));
  });
});
