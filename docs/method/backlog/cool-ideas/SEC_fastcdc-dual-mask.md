# SEC — FastCDC Dual-Mask Normalization

## The Idea

The current CdcChunker uses a single Buzhash mask for boundary detection. FastCDC's
dual-mask technique uses a stricter mask below the target size and a looser mask
above it, which normalizes the chunk size distribution around the target. This
tightens the bell curve, improving dedup ratios on workloads with lots of
near-target-size regions.

## Why It's Interesting

- The ChunkingPort abstraction already supports swappable strategies
- Could be a third strategy (`'fastcdc'`) alongside `'fixed'` and `'cdc'`
- Or just an evolution of the existing `CdcChunker` with a `normalized: true` option
- Quantifiable improvement: run the existing CDC test corpus with both modes and
  measure chunk count / average size / dedup ratio
- The Buzhash table and rolling hash are already there — it's mainly a mask
  selection change in `scanBoundary()`
