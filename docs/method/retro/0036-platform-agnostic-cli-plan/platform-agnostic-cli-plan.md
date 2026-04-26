# Retro — 0036 Platform-Agnostic CLI Plan

## Drift Check

- The cycle stayed at the design and planning layer.
- It did not claim that the CLI is already portable.
- It did not start a launcher extraction without first naming the runtime and
  Git runner seams.

## What Shipped

- The old portability backlog note is now replaced by a design-backed plan with
  explicit boundaries and phases.
- The plan distinguishes command-core portability from distribution and binary
  packaging.
- The repo truth now points future portability work toward existing bad-code
  lanes instead of a vague up-next card.

## What Did Not

- No CLI runtime-portability code shipped in this cycle.
- No new launcher artifacts were added.

## Debt

- Existing portability debt remains in:
  - `TR — Platform Dependency Leaks`
  - `TR — CasService Decomposition Plan`

## Cool Ideas

- If the CLI core extraction goes well, a future portability matrix doc could
  map each command surface to “portable core”, “Node-only adapter”, and
  “packaging-only” status so distribution claims stay honest.
