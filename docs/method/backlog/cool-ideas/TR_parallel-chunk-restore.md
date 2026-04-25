# TR — Parallel Chunk Restore

## The Idea

The store path uses a `Semaphore` for concurrent chunk writes (`concurrency`
parameter). The restore path fetches chunks sequentially — one `readBlob` at
a time. For large assets with many chunks, this leaves I/O bandwidth on the
table.

Fetch chunks concurrently during restore using the same Semaphore pattern.

## Why It's Interesting

- **Latency reduction**: N concurrent fetches vs sequential. Matters most for
  remote Git backends or network-attached storage.
- **The pattern already exists**: `_chunkAndStore` uses `Semaphore` for parallel
  writes. The same approach applies to reads.
- **Ordering preserved**: Chunks must be reassembled in order, but they can be
  *fetched* out of order and buffered. A bounded priority queue or pre-allocated
  slot array would work.

## Design Considerations

- Memory pressure: N concurrent chunks in flight means N * chunkSize memory.
  The existing `concurrency` cap (max 64) bounds this.
- Streaming restore: `restoreStream()` yields chunks in order. Parallel fetch
  would need a reordering buffer that yields chunks as their predecessors
  complete.
- Encrypted restore: framed-v1/v2 decryption is sequential (frame N depends
  on frame N-1 for nonce continuity). Parallel fetch still helps — you can
  prefetch frames ahead of decryption.
