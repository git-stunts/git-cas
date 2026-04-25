# Design: Prefetch Window for Parallel Chunk Restore

## Problem

Restore fetches chunks sequentially — one `readBlob` at a time. For large
assets with many chunks, this leaves I/O bandwidth on the table.

## Why Not a Semaphore

The store path uses a Semaphore because writes are unordered — you just cap
concurrency. Restore has a different constraint: chunks must be yielded in
sequence. A Semaphore doesn't know about ordering.

## Solution: Sliding Prefetch Window

A `PrefetchWindow` that reads chunks ahead of the yield cursor:

```
concurrency = 3, yielding index 2:

  slots: [2: ready ✓] [3: in-flight] [4: in-flight]
          ↑ yield     ↑ prefetched   ↑ prefetched

After yielding 2:
  slots: [3: ready ✓] [4: in-flight] [5: starting]
          ↑ yield     ↑ prefetched   ↑ new fetch
```

### Algorithm

1. Start `concurrency` fetches for chunks 0..N-1
2. `await` chunk 0 (the next to yield)
3. Yield chunk 0
4. Start fetch for chunk N (slide window forward)
5. `await` chunk 1 (now at head of window)
6. Repeat until all chunks yielded

### API

```js
async function* prefetchChunks(chunks, fetchFn, concurrency) {
  // chunks: array of chunk metadata
  // fetchFn: async (chunk) => Buffer
  // concurrency: max in-flight fetches
  // yields: Buffer in chunk order
}
```

Pure async generator. No class, no state beyond the window. The fetch function
is injected — CasService passes `_readAndVerifyChunk` (or the convergent
variant with the key).

### Where It Lives

`src/domain/services/PrefetchWindow.js` — standalone module, no deps.

CasService's streaming restore methods use it when `concurrency > 1`.
When `concurrency === 1`, the existing sequential loop is used unchanged.

### Integration Points

- `_restoreStreaming` — plaintext chunks
- `_restoreConvergentStreaming` — convergent-encrypted chunks
- `_restoreFramedStreaming` — reads verified chunk blobs (before frame parsing)
- `_iterVerifiedChunkBlobs` — the common chunk iteration helper

The cleanest insertion point is `_iterVerifiedChunkBlobs` — it's already the
shared chunk-reading generator used by all restore paths.

### No New Constructor Params

`concurrency` already exists on CasService (capped at 64). Currently only
used for store. Now also used for restore. Same param, both directions.
