# RL-005 — Agent Vault Lifecycle

## Legend

- [RL — Relay](../legends/RL-relay.md)

## Why This Exists

Relay can now read vault state and rotate vault passphrases, but the machine
surface still cannot create a vault or remove an entry directly.

That leaves the basic vault lifecycle split across human and agent surfaces:

- initialize a vault
- inspect and mutate its entries
- rotate its passphrase
- remove entries from the vault

## Target Outcome

Add machine-facing `git cas agent vault init` and `git cas agent vault remove`
commands with explicit commit-side effects.

## Human Value

Operators should be able to bootstrap and prune vault state through automation
without scraping CLI text or falling back to human-only flows.

## Agent Value

Agents should be able to:

- initialize plaintext or encrypted vaults
- remove entries by slug
- branch on missing inputs and missing entries through structured errors

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- keep both commands under `agent vault ...`
- preserve strict non-interactive passphrase handling for `vault init`
- make commit-side effects explicit in success rows
- keep the slice bounded to init and remove, not list/info/history
