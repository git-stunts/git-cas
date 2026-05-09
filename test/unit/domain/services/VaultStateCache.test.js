import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../../src/domain/errors/index.js';
import VaultStateCache from '../../../../src/domain/services/VaultStateCache.js';

describe('VaultStateCache plain state', () => {
  it('caches parsed plain entries by immutable tree OID while preserving current parent', () => {
    const cache = new VaultStateCache();
    const snapshot = cache.rememberTree('tree-1', {
      rawEntries: [{ mode: '040000', type: 'tree', oid: 'tree-a', name: 'demo%2Fhello' }],
      metadata: { version: 1 },
    });
    const parseEntries = vi.fn(() => new Map([['demo/hello', 'tree-a']]));

    const first = cache.toState({
      entries: cache.plainEntries(snapshot, parseEntries),
      metadata: snapshot.metadata,
      parentCommitOid: 'commit-1',
    });
    const second = cache.toState({
      entries: cache.plainEntries(snapshot, parseEntries),
      metadata: snapshot.metadata,
      parentCommitOid: 'commit-2',
    });

    expect(parseEntries).toHaveBeenCalledOnce();
    expect(first.parentCommitOid).toBe('commit-1');
    expect(second.parentCommitOid).toBe('commit-2');
    expect(second.entries.get('demo/hello')).toBe('tree-a');
  });

  it('returns defensive state copies from cached snapshots', () => {
    const cache = new VaultStateCache();
    const snapshot = cache.rememberTree('tree-1', {
      rawEntries: [],
      metadata: { version: 1 },
    });
    const entries = new Map([['demo/hello', 'tree-a']]);

    const first = cache.toState({ entries, metadata: snapshot.metadata, parentCommitOid: 'commit-1' });
    first.entries.set('mutated', 'tree-b');
    first.metadata.version = 99;
    const second = cache.toState({ entries, metadata: snapshot.metadata, parentCommitOid: 'commit-1' });

    expect(second.entries.has('mutated')).toBe(false);
    expect(second.metadata).toEqual({ version: 1 });
  });
});

describe('VaultStateCache entry map copies', () => {
  it('returns defensive copies from the cached plain entry map', () => {
    const cache = new VaultStateCache();
    const snapshot = cache.rememberTree('tree-1', {
      rawEntries: [{ mode: '040000', type: 'tree', oid: 'tree-a', name: 'demo%2Fhello' }],
      metadata: { version: 1 },
    });
    const parseEntries = vi.fn(() => new Map([['demo/hello', 'tree-a']]));

    const first = cache.plainEntries(snapshot, parseEntries);
    first.set('mutated', 'tree-b');
    const second = cache.plainEntries(snapshot, parseEntries);

    expect(parseEntries).toHaveBeenCalledOnce();
    expect(second).toEqual(new Map([['demo/hello', 'tree-a']]));
  });

  it('returns defensive copies from the cached privacy entry map', async () => {
    const cache = new VaultStateCache();
    const snapshot = cache.rememberTree('tree-1', { rawEntries: [], metadata: { version: 1 } });
    const key = Uint8Array.from([1]);
    const resolveEntries = vi.fn(async () => new Map([['secret', 'tree-a']]));

    const first = await cache.privacyEntries(snapshot, key, resolveEntries);
    first.delete('secret');
    const second = await cache.privacyEntries(snapshot, key, resolveEntries);

    expect(resolveEntries).toHaveBeenCalledOnce();
    expect(second).toEqual(new Map([['secret', 'tree-a']]));
  });
});

describe('VaultStateCache privacy-key memoization', () => {
  it('caches privacy entries per encryption key object identity', async () => {
    const cache = new VaultStateCache();
    const snapshot = cache.rememberTree('tree-1', { rawEntries: [], metadata: { version: 1 } });
    const keyA = Uint8Array.from([1]);
    const keyACopy = Uint8Array.from([1]);
    const resolveEntries = vi.fn(async () => new Map([['secret', 'tree-a']]));

    await cache.privacyEntries(snapshot, keyA, resolveEntries);
    await cache.privacyEntries(snapshot, keyA, resolveEntries);
    await cache.privacyEntries(snapshot, keyACopy, resolveEntries);

    expect(resolveEntries).toHaveBeenCalledTimes(2);
  });

  it('does not reuse privacy entries after the same key object mutates', async () => {
    const cache = new VaultStateCache();
    const snapshot = cache.rememberTree('tree-1', { rawEntries: [], metadata: { version: 1 } });
    const key = Uint8Array.from([1]);
    const resolveEntries = vi.fn(async (_rawEntries, _metadata, currentKey) =>
      new Map([[`secret-${currentKey[0]}`, 'tree-a']]),
    );

    const first = await cache.privacyEntries(snapshot, key, resolveEntries);
    key[0] = 2;
    const second = await cache.privacyEntries(snapshot, key, resolveEntries);

    expect(resolveEntries).toHaveBeenCalledTimes(2);
    expect(first.has('secret-1')).toBe(true);
    expect(second.has('secret-2')).toBe(true);
  });
});

describe('VaultStateCache privacy resolution concurrency', () => {
  it('deduplicates concurrent privacy entry resolution for the same key object', async () => {
    const cache = new VaultStateCache();
    const snapshot = cache.rememberTree('tree-1', { rawEntries: [], metadata: { version: 1 } });
    const key = Uint8Array.from([1]);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const resolveEntries = vi.fn(async () => {
      await gate;
      return new Map([['secret', 'tree-a']]);
    });

    const first = cache.privacyEntries(snapshot, key, resolveEntries);
    const second = cache.privacyEntries(snapshot, key, resolveEntries);

    expect(resolveEntries).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      new Map([['secret', 'tree-a']]),
      new Map([['secret', 'tree-a']]),
    ]);
  });
});

describe('VaultStateCache verifier-key memoization', () => {
  it('scopes verified encryption keys to one cached tree snapshot', () => {
    const cache = new VaultStateCache();
    const key = Uint8Array.from([1]);
    const first = cache.rememberTree('tree-1', { rawEntries: [], metadata: { version: 1 } });
    const second = cache.rememberTree('tree-2', { rawEntries: [], metadata: { version: 1 } });

    cache.rememberVerifiedEncryptionKey(first, key);

    expect(cache.hasVerifiedEncryptionKey(first, key)).toBe(true);
    expect(cache.hasVerifiedEncryptionKey(second, key)).toBe(false);
  });

  it('does not treat a mutated key object as already verified', () => {
    const cache = new VaultStateCache();
    const key = Uint8Array.from([1]);
    const snapshot = cache.rememberTree('tree-1', { rawEntries: [], metadata: { version: 1 } });

    cache.rememberVerifiedEncryptionKey(snapshot, key);
    key[0] = 2;

    expect(cache.hasVerifiedEncryptionKey(snapshot, key)).toBe(false);
  });
});

describe('VaultStateCache tree eviction', () => {
  it('evicts the least recently used tree snapshot when capacity is exceeded', () => {
    const cache = new VaultStateCache({ maxEntries: 2 });
    const first = cache.rememberTree('tree-1', { rawEntries: [], metadata: { version: 1 } });
    cache.rememberTree('tree-2', { rawEntries: [], metadata: { version: 1 } });

    expect(cache.get('tree-1')).toBe(first);
    cache.rememberTree('tree-3', { rawEntries: [], metadata: { version: 1 } });

    expect(cache.get('tree-1')).toBe(first);
    expect(cache.get('tree-2')).toBeUndefined();
    expect(cache.get('tree-3')).toBeDefined();
  });

  it('rejects invalid maxEntries values', () => {
    expect(() => new VaultStateCache({ maxEntries: 0 })).toThrow(expect.objectContaining({
      code: ErrorCodes.INVALID_OPTIONS,
    }));
  });
});
