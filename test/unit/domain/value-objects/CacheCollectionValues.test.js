import { describe, expect, it } from 'vitest';
import CacheAcquisitionRef from '../../../../src/domain/value-objects/CacheAcquisitionRef.js';
import CacheKey from '../../../../src/domain/value-objects/CacheKey.js';
import CachePolicy from '../../../../src/domain/value-objects/CachePolicy.js';
import CacheSetRef from '../../../../src/domain/value-objects/CacheSetRef.js';
import CollectionNamespace from '../../../../src/domain/value-objects/CollectionNamespace.js';
import ExpiringSetKey from '../../../../src/domain/value-objects/ExpiringSetKey.js';
import ExpiringSetRef from '../../../../src/domain/value-objects/ExpiringSetRef.js';

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
  });

  it.each([
    'refs/heads/main',
    'refs/cas/cache-acquisitions/git-warp/materializations',
    `refs/cas/cache-acquisitions/git-warp/materializations/v1-0000000000000-${'a'.repeat(63)}-${'b'.repeat(32)}`,
    `refs/cas/cache-acquisitions/git-warp/materializations/v1-0000000000000-${'a'.repeat(64)}-${'b'.repeat(31)}`,
    `refs/cas/cache-acquisitions/UPPER/v1-0000000000000-${'a'.repeat(64)}-${'b'.repeat(32)}`,
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
