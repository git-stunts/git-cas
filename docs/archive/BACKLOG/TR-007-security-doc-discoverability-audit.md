# TR-007 — Security Doc Discoverability Audit

## Legend

- [TR — Truth](../../legends/TR-truth.md)

## Why This Exists

Canonical security and threat-model docs now exist, but top-level documents do
not yet consistently point readers to them.

That makes important guidance easy to miss even when the repo technically
contains it.

## Target Outcome

Audit the top-level doc surface and add or repair discoverability links to
[SECURITY.md](../../../SECURITY.md) and [docs/THREAT_MODEL.md](../../THREAT_MODEL.md)
where they are materially relevant.

## Human Value

Readers should be able to find the right security and threat guidance from the
main architecture, API, and workflow surfaces without hunting.

## Agent Value

Agents should be able to navigate directly to canonical security truth instead
of citing secondary or partial summaries.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- focus on top-level and high-traffic docs first
- add links only where they improve navigation materially
- avoid creating duplicate security narratives while improving discoverability
