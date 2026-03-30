# RL — Relay

## Status

Active

## Theme

Build a first-class machine-facing `git cas agent` contract and force the
application boundary to become explicit enough that later human-surface work
can reuse it honestly.

## Why This Legend Exists

The human CLI and TUI are already ahead of the planning docs.

The current product gap is not “can `git-cas` do useful things?”
It is “can agents perform those useful things deterministically without
scraping, prompting, or depending on terminal behavior?”

## Human Users, Jobs, And Hills

### Users

- maintainers
- release engineers
- operators who need trustworthy restore, verify, and vault workflows

### Jobs

- automate storage and restore without building brittle wrappers
- trust that machine-facing behavior is explicit and replayable

### Hill

A human operator can build reliable automation on top of `git-cas` without
needing a human escape hatch for ordinary success paths.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- CI jobs
- release bots
- backup and verification workflows

### Jobs

- inspect state
- verify integrity
- store and restore artifacts
- manage keys and recipients
- branch on failures using structured outputs instead of prose

### Hill

An agent can complete core `git-cas` workflows through a stable, non-interactive,
JSONL-first contract.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Current Cycle Surface

The currently landed Relay cycle docs still use legacy numeric naming:

- [0001 — M18 Relay: Agent CLI Foundation](../design/0001-m18-relay-agent-cli.md)
- [0002 — M18 Relay: Write Flows and Input Semantics](../design/0002-m18-relay-write-flows.md)
- [0003 — M18 Relay: Tree Creation Primitive](../design/0003-m18-relay-tree-creation.md)

Future Relay cycle docs should use the `RL-...` naming model.

Landed Relay cycle docs now using that model:

- [RL-001 — Relay: Agent Recipient List](../design/RL-001-agent-recipient-list.md)
- [RL-002 — Relay: Agent Recipient Mutations](../design/RL-002-agent-recipient-mutations.md)
- [RL-003 — Relay: Agent Rotate](../design/RL-003-agent-rotate.md)
- [RL-004 — Relay: Agent Vault Rotate](../design/RL-004-agent-vault-rotate.md)
- [RL-005 — Relay: Agent Vault Lifecycle](../design/RL-005-agent-vault-lifecycle.md)

Current Relay backlog:

- None currently.

## Explicit Non-Goals

- no attempt to collapse the human and agent surfaces into one contract
- no long-lived session protocol until playbacks demand it
- no TUI-first expansion that bypasses the shared app-layer boundary
