/**
 * @fileoverview Sliding prefetch window for ordered parallel chunk reads.
 *
 * Reads up to `concurrency` chunks ahead of the yield cursor, maintaining
 * strict output ordering while maximizing I/O throughput.
 *
 * No classes, no state, no dependencies — just an async generator.
 */

/**
 * Fetches chunks in parallel with a sliding window, yielding in order.
 *
 * @param {Array<{ index: number }>} chunks - Chunk metadata array (ordered).
 * @param {(chunk: { index: number }) => Promise<Buffer>} fetchFn - Async function to fetch a single chunk.
 * @param {number} concurrency - Maximum number of concurrent in-flight fetches.
 * @yields {Buffer} Chunk data in manifest order.
 */
export default async function* prefetchChunks(chunks, fetchFn, concurrency) {
  if (chunks.length === 0) { return; }

  const window = new Array(concurrency);
  let yieldCursor = 0;
  let fetchCursor = 0;

  // Fill the initial window
  while (fetchCursor < chunks.length && fetchCursor < concurrency) {
    window[fetchCursor % concurrency] = fetchFn(chunks[fetchCursor]);
    fetchCursor++;
  }

  // Yield in order, sliding the window forward
  try {
    while (yieldCursor < chunks.length) {
      const slot = yieldCursor % concurrency;
      yield await window[slot];

      yieldCursor++;

      // Start the next fetch if there are more chunks
      if (fetchCursor < chunks.length) {
        window[slot] = fetchFn(chunks[fetchCursor]);
        fetchCursor++;
      }
    }
  } finally {
    await Promise.allSettled(window.filter(Boolean));
  }
}
