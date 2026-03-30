# TR-006 — Docs Maintainer Checklist

## Legend

- [TR — Truth](../../legends/TR-truth.md)

## Why This Exists

Small documentation truth gaps keep surfacing late in review:
public-versus-internal boundary ambiguity, missing cross-links to canonical
docs, and inconsistent empty-state wording.

Those are not large product failures, but they do create avoidable review churn
and weaken the repo's documentation discipline.

## Target Outcome

Add a maintainer-facing checklist for documentation updates that covers:
public/internal boundary clarity, canonical-source cross-linking, and empty
state phrasing.

## Human Value

Maintainers should be able to do a fast, repeatable quality pass on doc changes
before opening a PR.

## Agent Value

Agents should have an explicit checklist to follow instead of rediscovering the
same doc review hazards from comments.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- keep it short enough to run on every doc-heavy branch
- focus on recurring truth and discoverability failures
- prefer checklists that can be applied by both humans and agents
