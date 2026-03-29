# I-001 — Determinism, Trust, And Explicit Surfaces

## Statement

The following truths are non-negotiable for `git-cas`:

- Git is the substrate, not the product.
- Integrity is sacred.
- Restore must be deterministic.
- Provenance and verification matter.
- Human CLI/TUI and agent CLI are separate surfaces over one shared core.
- The default human UX must stay boring, legible, and trustworthy.
- The agent UX must stay non-interactive, explicit, and replayable.

## Implications

- no hidden side effects in normal operator or agent flows
- no TTY branching in the agent contract
- no implicit prompts in the agent contract
- no human-only access path for essential system behavior
- no storage or Git-internal trivia leaking into ordinary UX without cause
- no test design that depends on ambient user state, timing luck, or shell
  interaction

## Why This Matters

`git-cas` is only useful if people and agents can trust it.

Fancy internals are allowed.
Unclear behavior is not.
