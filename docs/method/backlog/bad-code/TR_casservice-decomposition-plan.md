# TR — CasService Decomposition Plan

_Legacy source: `TR-005`._

## Legend

- [TR — Truth](../../legends/TR_truth.md)

## Why This Exists

[src/domain/services/CasService.js](../../../src/domain/services/CasService.js)
appears to hold multiple responsibilities under one roof: chunking
orchestration, manifest generation, encryption flow, and vault-facing behavior.

That may now be a real boundary problem, but it should be proven before the
repo pays for a large refactor.

## Target Outcome

Produce a design-backed decomposition plan that identifies stable seams,
candidate extractions, and the tests that would need to hold behavior in place.

## Human Value

Maintainers should be able to evolve the core service with less fear, clearer
ownership boundaries, and less architectural guesswork.

## Agent Value

Agents should be able to make bounded changes in the core service without
unintentionally coupling chunking, encryption, and vault behavior more tightly.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- investigate before extracting
- identify which responsibilities are already implicit subdomains
- prefer seams that reduce coupling and improve testability
- do not treat class count or architectural symmetry as success on their own
