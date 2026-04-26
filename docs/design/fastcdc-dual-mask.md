# Design: FastCDC Dual-Mask Normalization

## Problem

The CdcChunker uses a single Buzhash mask for boundary detection. Boundary
probability is uniform across `[minSize, maxSize)`, producing a geometric
distribution where most chunks land near `minSize` and the tail stretches to
`maxSize`. This widens the chunk size variance and reduces dedup efficiency.

## Solution

Add a `normalized` option to CdcChunker that enables dual-mask boundary detection
(the core innovation from the FastCDC paper).

### Algorithm

Instead of one mask throughout `[minSize, maxSize)`, use two:

- **`hardMask`** — `(1 << (bits + 1)) - 1` — used when `chunkLen < targetSize`.
  More bits → less likely to match → pushes chunks past the target.
- **`easyMask`** — `(1 << (bits - 1)) - 1` — used when `chunkLen >= targetSize`.
  Fewer bits → more likely to match → pulls chunks back toward the target.

Where `bits = floor(log2(targetChunkSize))` (same as the current single mask).

This concentrates the chunk size distribution around the target, narrowing the
bell curve.

### Changes

| Component | Change |
|-----------|--------|
| **ChunkState** | Add `hardMask`, `easyMask`, `targetSize`, `normalized` fields |
| **scanBoundary()** | Check `st.normalized`; if true, select mask based on `chunkLen < targetSize` |
| **CdcChunker constructor** | Accept `normalized` option (default `true`); compute both masks |
| **CdcChunker.params** | Include `normalized` in returned params |
| **ChunkingSchema** | Add optional `normalized` field to CDC params |
| **resolveChunker** | Thread `normalized` through |

### Backward Compatibility

- Default `normalized: true` — new stores get the better distribution
- Old manifests with `chunking.params` that lack `normalized` → treated as
  `normalized: false` (exact same behavior as before)
- Strategy name stays `'cdc'` — this is an enhancement, not a new strategy

### No breaking changes

Normalization only affects where boundaries fall in NEW chunking operations. It
does not affect stored data or restore paths (chunks are just blobs with digests).
