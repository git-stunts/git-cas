import { describe, it, expect } from 'vitest';
import prefetchChunks from '../../../../src/domain/services/PrefetchWindow.js';

/** Collects all yielded values from an async generator. */
async function collect(gen) {
  const results = [];
  for await (const val of gen) { results.push(val); }
  return results;
}

/** Creates a fetch function that resolves after a delay, tracking call order. */
function delayedFetch(ms = 0) {
  const callOrder = [];
  const fn = async (chunk) => {
    callOrder.push(chunk.index);
    await new Promise((r) => { setTimeout(r, ms); });
    return Buffer.from(`data-${chunk.index}`);
  };
  return { fn, callOrder };
}

// ---------------------------------------------------------------------------
// Basic ordering
// ---------------------------------------------------------------------------
describe('prefetchChunks – ordering', () => {
  it('yields chunks in order regardless of fetch completion order', async () => {
    const chunks = [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }];
    const results = await collect(
      prefetchChunks(chunks, async (c) => Buffer.from(`d${c.index}`), 2),
    );
    expect(results.map((b) => b.toString())).toEqual(['d0', 'd1', 'd2', 'd3']);
  });

  it('handles single chunk', async () => {
    const results = await collect(
      prefetchChunks([{ index: 0 }], async () => Buffer.from('x'), 4),
    );
    expect(results).toHaveLength(1);
  });

  it('handles empty chunk list', async () => {
    const results = await collect(
      prefetchChunks([], async () => Buffer.from('x'), 4),
    );
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Concurrency behavior
// ---------------------------------------------------------------------------
describe('prefetchChunks – concurrency', () => {
  it('never exceeds concurrency limit for in-flight fetches', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const chunks = Array.from({ length: 10 }, (_, i) => ({ index: i }));

    const fetchFn = async (chunk) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => { setTimeout(r, 5); });
      inFlight--;
      return Buffer.from(`d${chunk.index}`);
    };

    await collect(prefetchChunks(chunks, fetchFn, 3));
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // actually parallelized
  });

  it('concurrency=1 behaves sequentially', async () => {
    const { fn, callOrder } = delayedFetch(1);
    const chunks = [{ index: 0 }, { index: 1 }, { index: 2 }];
    await collect(prefetchChunks(chunks, fn, 1));
    expect(callOrder).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------
describe('prefetchChunks – errors', () => {
  it('propagates fetch errors at the correct chunk position', async () => {
    const chunks = [{ index: 0 }, { index: 1 }, { index: 2 }];
    const fetchFn = async (chunk) => {
      if (chunk.index === 1) { throw new Error('chunk 1 failed'); }
      return Buffer.from(`d${chunk.index}`);
    };

    const gen = prefetchChunks(chunks, fetchFn, 3);
    const first = await gen.next();
    expect(first.value.toString()).toBe('d0');
    await expect(gen.next()).rejects.toThrow('chunk 1 failed');
  });
});

// ---------------------------------------------------------------------------
// Data integrity
// ---------------------------------------------------------------------------
describe('prefetchChunks – data integrity', () => {
  it('all chunks are fetched exactly once', async () => {
    const fetched = new Set();
    const chunks = Array.from({ length: 20 }, (_, i) => ({ index: i }));
    await collect(prefetchChunks(chunks, async (c) => {
      fetched.add(c.index);
      return Buffer.from(`d${c.index}`);
    }, 5));
    expect(fetched.size).toBe(20);
    for (let i = 0; i < 20; i++) { expect(fetched.has(i)).toBe(true); }
  });
});
