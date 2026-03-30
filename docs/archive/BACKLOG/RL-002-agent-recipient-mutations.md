# RL-002 — Agent Recipient Mutations

## Legend

- [RL — Relay](../../legends/RL-relay.md)

## Why This Exists

Relay can now inspect recipient state, but an agent still cannot mutate the
recipient lifecycle through a first-class contract.

That blocks a real automation loop:

- inspect recipients
- add or remove recipients safely
- later rotate recipient keys

## Target Outcome

Add machine-facing `git cas agent recipient add` and
`git cas agent recipient remove` commands that make vault-updating side effects
explicit.

## Human Value

Operators should be able to build recipient-management automation without
falling back to the human CLI or scraping its output.

## Agent Value

Agents should be able to:

- add a new recipient using an existing recipient key
- remove a recipient by label
- detect duplicate labels, missing labels, and last-recipient violations through
  structured failures

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- keep the slice focused on `recipient add` and `recipient remove`
- require explicit slug-based targeting because these commands update the vault
- make the updated tree and commit side effects explicit in the result payload
- leave `agent rotate` for the next cycle
