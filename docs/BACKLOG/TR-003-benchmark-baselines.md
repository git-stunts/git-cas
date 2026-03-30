# TR-003 — Benchmark Baselines

## Legend

- [TR — Truth](../legends/TR-truth.md)

## Why This Exists

`git-cas` exposes multiple storage and chunking choices, but the repo does not
yet publish stable benchmark guidance that helps users choose among them.

## Target Outcome

Add [docs/BENCHMARKS.md](../BENCHMARKS.md) with baseline results and enough
methodology detail that maintainers can refresh it intentionally.

## Human Value

Operators and maintainers should be able to compare fixed-size chunking and CDC
with real numbers instead of guesswork.

## Agent Value

Agents should be able to reference benchmark tradeoffs when suggesting defaults,
tuning guidance, or follow-on optimization work.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- include dataset shape, runtime, and machine assumptions
- compare at least fixed-size versus CDC
- capture both cost and benefit signals where practical:
  bytes stored, chunk count, elapsed time, and restore behavior
- keep the doc honest about benchmark scope and recency
