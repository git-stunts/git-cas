# TR-012 — Examples Surface Audit

## Legend

- [TR — Truth](../legends/TR-truth.md)

## Why This Exists

The `examples/` directory is part of the repo's public teaching surface, but it
has not had a recent accuracy and relevance pass against the current API,
workflow, and runtime story.

Examples that are stale, redundant, or misleading create the same trust problem
as stale docs, except they also invite copy-paste mistakes.

## Target Outcome

Audit the `examples/` surface and make a concrete recommendation for each entry:

- keep
- cut
- merge
- move
- refresh for accuracy

## Human Value

Maintainers and adopters should be able to trust that example files still teach
current, relevant `git-cas` usage instead of historical or partial patterns.

## Agent Value

Agents should be able to cite, update, or remove examples with a clear view of
which ones still belong in the repo and why.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- audit both the top-level `examples/README.md` and the example programs
- check API accuracy, not just prose quality
- distinguish educational value from nostalgia
