# TR-004 — Design Doc Lifecycle

## Legend

- [TR — Truth](../legends/TR-truth.md)

## Why This Exists

The new legends and cycles workflow is real, but the repo still needs a clear
rule for what happens to completed cycle docs and backlog items after work
lands.

Without that, design history can crowd out current truth.

## Target Outcome

Define and document how completed backlog items and cycle docs are kept,
indexed, summarized, archived, or retired.

## Human Value

Maintainers should be able to distinguish active planning from historical
context without losing useful decision records.

## Agent Value

Agents should be able to tell which planning artifacts are active truth,
historical context, or implementation residue.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- decide whether implemented cycle docs remain in `docs/design/` or move to an
  archive location
- keep indexes lightweight and current
- prefer explicit status and lifecycle rules over ad hoc cleanup
