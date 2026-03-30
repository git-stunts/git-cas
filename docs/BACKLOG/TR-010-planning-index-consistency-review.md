# TR-010 — Planning Index Consistency Review

## Legend

- [TR — Truth](../legends/TR-truth.md)

## Why This Exists

The planning model now spans live backlog, design history, archive indexes, and
legend summaries.

Those surfaces can drift out of sync even when the underlying work is correct,
especially during active review and merge-closeout edits.

## Target Outcome

Establish a periodic consistency review for planning indexes so backlog, design,
archive, and legend surfaces stay aligned with one another.

## Human Value

Maintainers should be able to trust that the planning indexes reflect the same
state without manually reconciling them.

## Agent Value

Agents should be able to read the planning surface as one coherent system
instead of inferring around index drift.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- define what must stay in sync across backlog, design, archive, and legends
- keep the review cadence pragmatic rather than ceremonial
- use it to catch drift early, especially around cycle closure and archive moves
