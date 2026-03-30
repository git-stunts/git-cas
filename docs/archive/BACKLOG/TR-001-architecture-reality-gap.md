# TR-001 — Architecture Reality Gap

## Legend

- [TR — Truth](../../legends/TR-truth.md)

## Why This Exists

[ARCHITECTURE.md](../../../ARCHITECTURE.md) appears to lag the shipped system.
If it still describes flat manifests and treats Merkle structure as future work,
it is no longer guidance. It is misinformation.

## Target Outcome

Either rewrite [ARCHITECTURE.md](../../../ARCHITECTURE.md) so it matches the
current code and shipped behavior, or retire it and fold the durable truth into
the docs that are actually maintained.

## Human Value

Contributors and operators should be able to trust the architecture docs
without cross-checking every claim against the code and release history.

## Agent Value

Agents should be able to use the architecture docs as current planning input
instead of carrying stale assumptions into review, refactor, or documentation
work.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- verify every claim against the shipped facade and current internals
- decide whether one repaired architecture document is better than several
  overlapping partial maps
- remove future-tense language for already-landed behavior
