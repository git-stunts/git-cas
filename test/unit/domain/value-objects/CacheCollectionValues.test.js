import { describe, expect, it } from 'vitest';
import CacheKey from '../../../../src/domain/value-objects/CacheKey.js';
import CachePolicy from '../../../../src/domain/value-objects/CachePolicy.js';
import CacheSetRef from '../../../../src/domain/value-objects/CacheSetRef.js';
import CollectionNamespace from '../../../../src/domain/value-objects/CollectionNamespace.js';

describe('CollectionNamespace', () => {
  it.each([
    'git-warp/materializations',
    'a',
    'one.two/three-four',
  ])('accepts canonical namespace %s', (value) => {
    expect(CollectionNamespace.from(value).toString()).toBe(value);
    expect(CacheSetRef.forNamespace(value).toString()).toBe(`refs/cas/caches/${value}`);
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
    expect(new CachePolicy({ maxEntries: 4, maxBytes: 1024 })).toMatchObject({
      maxEntries: 4,
      maxBytes: 1024,
    });
    expect(() => new CachePolicy({ maxEntries: 100_000 }))
      .toThrow(expect.objectContaining({ code: 'CACHE_POLICY_INVALID' }));
  });
});
