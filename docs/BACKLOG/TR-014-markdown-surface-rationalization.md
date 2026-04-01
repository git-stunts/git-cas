# TR-014 — Markdown Surface Rationalization

## Legend

- [TR — Truth](../legends/TR-truth.md)

## Why This Exists

The repo has accumulated a broad Markdown surface at the root and under `docs/`
across different planning eras.

Some of those files clearly belong where they are. Some probably need to be
cut, merged, or moved. Without a deliberate audit, the repo keeps paying a
navigation and review tax on every docs-heavy change.

## Target Outcome

Audit tracked Markdown files across the repo and make a recommendation for each
one using the categories:

- keep
- cut
- merge
- move

More than one recommendation may apply to a single file when a document should
be retained only after being split, relocated, or merged.

## Human Value

Maintainers should have a clearer map of which Markdown artifacts are canonical,
which are migration surfaces, and which should stop occupying high-visibility
locations.

## Agent Value

Agents should be able to plan doc work against a more intentional Markdown
surface instead of inheriting a flat pile of legacy and canonical files with
equal apparent status.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- include root-level Markdown in the audit, not just `docs/`
- explicitly call out which artifacts belong at the repo root
- separate current canonical docs from migration surfaces and local-only files
