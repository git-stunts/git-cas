# RL-004 — Agent Vault Rotate

## Legend

- [RL — Relay](../../legends/RL-relay.md)

## Why This Exists

Relay can now rotate recipient keys, but vault passphrase rotation is still
human-CLI-only.

That keeps the machine-facing key lifecycle incomplete:

- rotate recipient keys for one asset
- rotate vault passphrase for all envelope-backed vault entries

## Target Outcome

Add machine-facing `git cas agent vault rotate` support that makes commit-side
effects, rotated/skipped entries, and resulting KDF state explicit.

## Human Value

Operators should be able to automate vault passphrase rotation without scraping
human CLI text or guessing whether the vault metadata actually changed.

## Agent Value

Agents should be able to:

- rotate an encrypted vault with explicit old/new passphrase sources
- read rotated and skipped slug lists directly
- branch on invalid input, wrong passphrase, and unencrypted-vault failures

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- keep the command under `agent vault ...`
- support direct passphrase fields and passphrase-file sources
- make the resulting KDF algorithm explicit in the result payload
- do not add prompts or TTY-dependent fallback behavior
