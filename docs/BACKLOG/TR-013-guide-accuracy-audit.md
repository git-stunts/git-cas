# TR-013 — Guide Accuracy Audit

## Legend

- [TR — Truth](../legends/TR-truth.md)

## Why This Exists

[GUIDE.md](../../GUIDE.md) is a long, high-traffic root document that presents
itself as a complete guide. That makes accuracy drift especially costly: if the
guide overstates, lags, or duplicates other canonical docs, it can mislead both
humans and agents at scale.

## Target Outcome

Do an accuracy and relevance pass on `GUIDE.md`, including whether it should be:

- kept at the repo root
- cut down
- merged into other docs
- moved under `docs/`

## Human Value

Maintainers and adopters should be able to trust the guide as a current
teaching surface instead of a large historical artifact.

## Agent Value

Agents should be able to reason about the guide as either a maintained surface
or a migration candidate, instead of assuming its current placement and scope
are justified.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- audit technical accuracy, not just readability
- compare it against `README.md`, `docs/API.md`, `ARCHITECTURE.md`, and
  `SECURITY.md`
- make an explicit recommendation on root placement
