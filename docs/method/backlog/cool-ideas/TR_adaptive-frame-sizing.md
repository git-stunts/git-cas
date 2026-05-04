# TR: Adaptive framed-encryption sizing

## The Idea

Let `framed` encryption choose frame sizes from workload and runtime constraints
instead of relying only on a static `frameBytes` value.

For example, small assets could use fewer larger frames to reduce metadata
overhead, while browser/Web Crypto paths could favor smaller bounded records for
lower latency and memory pressure.

## Why It's Interesting

- Builds on the current `framed` scheme without changing the active scheme name.
- Gives operators a performance tuning path for very small and very large
  encrypted assets.
- Could pair with benchmark refreshes in `ADVANCED_GUIDE.md`.

## Tradeoffs

- Must preserve deterministic manifest semantics and clear restore behavior.
- Needs careful docs so "adaptive" does not hide security-relevant frame bounds.

## Status

- Captured during the 2026-05-04 code quality audit.
