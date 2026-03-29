# RL-001 — Agent Recipient List

## Legend

- [RL — Relay](../legends/RL-relay.md)

## Why This Exists

Relay can now inspect, verify, store, restore, and create trees, but agents
still cannot inspect envelope recipient state through a first-class contract.

That is a real gap because recipient and rotation work comes next. Agents need a
stable read path before they can mutate that lifecycle safely.

## Target Outcome

Add a machine-facing `git cas agent recipient list` command that reports
recipient state without scraping human CLI output.

## Human Value

Operators building automation should be able to inspect recipient state
confidently before attempting recipient mutation or key rotation.

## Agent Value

Agents should be able to determine:

- whether an asset uses envelope recipients
- which recipient labels exist
- which tree was inspected

without inferring from prose or TTY behavior.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- keep the command read-only
- support the normal Relay target model (`--slug` or `--oid`)
- return structured recipient rows, not bare terminal text
- leave add/remove/rotate for follow-on cycles
