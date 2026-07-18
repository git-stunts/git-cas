import { describe, expect, it, vi } from 'vitest';
import BoundedPromiseCache from '../../../src/helpers/boundedPromiseCache.js';

describe('BoundedPromiseCache construction', () => {
  it('rejects invalid residency options', () => {
    expect(() => new BoundedPromiseCache(0)).toThrow('positive safe integer');
    expect(() => new BoundedPromiseCache(1, { maxWeight: -1 })).toThrow(
      'non-negative safe integer'
    );
    expect(() => new BoundedPromiseCache(1, { weightOf: null })).toThrow(
      'weightOf must be a function'
    );
  });
});

describe('BoundedPromiseCache coalescing', () => {
  it('coalesces in-flight work and retries rejected work', async () => {
    let resolveValue;
    const pending = new Promise((resolve) => {
      resolveValue = resolve;
    });
    const cache = new BoundedPromiseCache(2);
    const sharedFactory = vi.fn().mockReturnValue(pending);

    const first = cache.getOrCreate('shared', sharedFactory);
    const second = cache.getOrCreate('shared', sharedFactory);
    resolveValue('value');

    await expect(Promise.all([first, second])).resolves.toEqual(['value', 'value']);
    expect(sharedFactory).toHaveBeenCalledTimes(1);

    const retryFactory = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');
    await expect(cache.getOrCreate('retry', retryFactory)).rejects.toThrow('transient');
    await expect(cache.getOrCreate('retry', retryFactory)).resolves.toBe('recovered');
    expect(retryFactory).toHaveBeenCalledTimes(2);
  });
});

describe('BoundedPromiseCache residency', () => {
  it('evicts the least-recently-used entry at its count bound', async () => {
    const cache = new BoundedPromiseCache(2);
    const factory = vi.fn((value) => Promise.resolve(value));

    await cache.getOrCreate('first', () => factory('first'));
    await cache.getOrCreate('second', () => factory('second'));
    await cache.getOrCreate('first', () => factory('first'));
    await cache.getOrCreate('third', () => factory('third'));
    await cache.getOrCreate('second', () => factory('second'));

    expect(factory).toHaveBeenCalledTimes(4);
  });

  it('evicts completed values by total weight', async () => {
    const cache = new BoundedPromiseCache(3, {
      maxWeight: 5,
      weightOf: (value) => value.length,
    });
    const first = vi.fn().mockResolvedValue('aaa');
    const second = vi.fn().mockResolvedValue('bbb');

    await cache.getOrCreate('first', first);
    await cache.getOrCreate('second', second);
    await cache.getOrCreate('second', second);
    await cache.getOrCreate('first', first);

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not retain a value larger than the weight bound', async () => {
    const cache = new BoundedPromiseCache(3, {
      maxWeight: 2,
      weightOf: (value) => value.length,
    });
    const factory = vi.fn().mockResolvedValue('oversized');

    await cache.getOrCreate('value', factory);
    await cache.getOrCreate('value', factory);

    expect(factory).toHaveBeenCalledTimes(2);
  });
});
