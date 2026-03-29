# RL-003 — Agent Rotate

## Legend

- [RL — Relay](../legends/RL-relay.md)

## Why This Exists

Relay can now inspect recipients and mutate recipient membership, but an agent
still cannot rotate a recipient key through a first-class contract.

That leaves a hole in the machine-facing key lifecycle:

- inspect recipient state
- add or remove recipients
- rotate a recipient key without falling back to the human CLI

## Target Outcome

Add machine-facing `git cas agent rotate` support that makes new trees and
vault-updating side effects explicit.

## Human Value

Operators should be able to automate key rollover without scraping human CLI
output or guessing whether the vault entry was updated.

## Agent Value

Agents should be able to:

- rotate a recipient key for a vault entry by slug
- rotate a detached tree by OID and receive the new tree directly
- branch on recipient mismatch and unsupported-manifest failures through
  structured protocol errors

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- accept either `--slug` or `--oid`
- require explicit `--old-key-file` and `--new-key-file`
- allow optional `--label` for targeted rotation
- make detached-tree rotation explicit instead of pretending it updated the vault
