# TR-009 — Pre-PR Doc Cross-Link Audit

## Legend

- [TR — Truth](../../legends/TR-truth.md)

## Why This Exists

Review keeps catching missing cross-links between related canonical docs after a
PR is already open.

That is a cheap class of issue that should be found before review, not during
it.

## Target Outcome

Define and adopt a lightweight pre-PR audit for doc-heavy branches that checks
cross-links between top-level docs, canonical truth docs, and planning indexes.

## Human Value

Maintainers should be able to catch missing navigation links before reviewers
spend time on them.

## Agent Value

Agents should have a clear pre-PR step for doc discoverability checks instead
of relying on reactive review feedback.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- keep the audit lightweight enough to run routinely
- focus on canonical-source discoverability, not exhaustive link checking
- fit this into the existing workflow instead of creating a second planning
  layer
