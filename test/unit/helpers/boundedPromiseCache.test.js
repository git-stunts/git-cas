import { describe, expect, it, vi } from 'vitest';
import BoundedPromiseCache from '../../../src/helpers/boundedPromiseCache.js';

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

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

  it('keeps unique in-flight work coalesced beyond the completed-entry bound', async () => {
    const cache = new BoundedPromiseCache(1);
    const firstGate = deferred();
    const secondGate = deferred();
    const firstFactory = vi.fn().mockReturnValue(firstGate.promise);
    const secondFactory = vi.fn().mockReturnValue(secondGate.promise);

    const first = cache.getOrCreate('first', firstFactory);
    const second = cache.getOrCreate('second', secondFactory);
    const repeated = cache.getOrCreate('first', firstFactory);
    firstGate.resolve('first-value');
    secondGate.resolve('second-value');

    await expect(Promise.all([first, second, repeated])).resolves.toEqual([
      'first-value',
      'second-value',
      'first-value',
    ]);
    expect(firstFactory).toHaveBeenCalledTimes(1);
    expect(secondFactory).toHaveBeenCalledTimes(1);
  });
});

describe('BoundedPromiseCache rejected work', () => {
  it('evicts a rejection before the returned promise settles', async () => {
    const cache = new BoundedPromiseCache(1);
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');

    let firstError;
    try {
      await cache.getOrCreate('key', factory);
    } catch (error) {
      firstError = error;
    }

    expect(firstError).toMatchObject({ message: 'transient' });
    await expect(cache.getOrCreate('key', factory)).resolves.toBe('recovered');
    expect(factory).toHaveBeenCalledTimes(2);
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
});

describe('BoundedPromiseCache oversized residency', () => {
  it('does not retain a value larger than the weight bound', async () => {
    const cache = new BoundedPromiseCache(3, {
      maxWeight: 2,
      weightOf: (value) => value.length,
    });
    const oversized = vi.fn().mockResolvedValue('oversized');
    const resident = vi.fn().mockResolvedValue('ok');

    await cache.getOrCreate('resident', resident);
    await cache.getOrCreate('value', oversized);
    await cache.getOrCreate('value', oversized);
    await cache.getOrCreate('resident', resident);

    expect(oversized).toHaveBeenCalledTimes(2);
    expect(resident).toHaveBeenCalledTimes(1);
  });

  it('does not let an oversized in-flight value displace a resident', async () => {
    const cache = new BoundedPromiseCache(1, {
      maxWeight: 2,
      weightOf: (value) => value.length,
    });
    const resident = vi.fn().mockResolvedValue('ok');
    const oversizedGate = deferred();
    const oversized = vi.fn().mockReturnValue(oversizedGate.promise);

    await cache.getOrCreate('resident', resident);
    const pending = cache.getOrCreate('oversized', oversized);
    await cache.getOrCreate('resident', resident);
    oversizedGate.resolve('oversized');
    await pending;
    await cache.getOrCreate('resident', resident);

    expect(oversized).toHaveBeenCalledTimes(1);
    expect(resident).toHaveBeenCalledTimes(1);
  });
});

describe('BoundedPromiseCache resolved weights', () => {
  it.each([Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects and evicts invalid resolved weight %s',
    async (weight) => {
      const cache = new BoundedPromiseCache(1, { weightOf: () => weight });
      const factory = vi.fn().mockResolvedValue('value');

      await expect(cache.getOrCreate('key', factory)).rejects.toThrow(
        'weightOf must return a non-negative safe integer'
      );
      await expect(cache.getOrCreate('key', factory)).rejects.toThrow(
        'weightOf must return a non-negative safe integer'
      );
      expect(factory).toHaveBeenCalledTimes(2);
    }
  );
});
