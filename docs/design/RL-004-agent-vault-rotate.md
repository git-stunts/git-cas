# RL-004 — Relay: Agent Vault Rotate

## Status

Landed

## Linked Legend

- [RL — Relay](../legends/RL-relay.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

Relay can now:

- inspect vault state
- store and restore encrypted assets
- rotate recipient keys for individual assets

The next key-lifecycle gap is vault passphrase rotation.

The human CLI already supports it. Relay needs a machine-facing contract that is
explicit about secret sources and vault-wide side effects.

## Human Users, Jobs, And Hills

### Users

- maintainers
- release engineers
- operators rotating encrypted vault credentials

### Jobs

- rotate a vault passphrase without opening an interactive prompt
- know exactly which entries were rotated, which were skipped, and which commit
  recorded the change

### Hill

A human operator can trust agent-driven vault passphrase rotation because the
command reports the vault commit and the rotated/skipped entry set directly.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- CI jobs
- operations workflows

### Jobs

- rotate an encrypted vault with explicit old/new passphrase sources
- verify that the resulting KDF algorithm is what was requested
- branch on wrong-passphrase and unencrypted-vault failures without parsing prose

### Hill

An agent can rotate vault passphrases through Relay and learn exactly what the
vault commit changed.

## Human Playback

- Can an operator inspect the result row and immediately know whether the vault
  was updated successfully?
- Are rotated and skipped entries visible without follow-up commands?

## Agent Playback

- Can an agent rotate a vault using direct passphrase input?
- Can it rotate using request-payload file sources for secrets?
- Can it override the KDF algorithm and observe the resulting metadata?
- Do invalid-input and wrong-passphrase failures surface as structured protocol
  errors?

## Explicit Non-Goals

- no asset-level recipient mutation in this cycle
- no recipient-key rotation in this cycle
- no interactive prompts
- no attempt to read both request JSON and passphrases from stdin at once

## Decisions

### Command Shape

Relay adds:

- `git cas agent vault rotate --old-passphrase <pass> --new-passphrase <pass>`

Optional:

- `--old-passphrase-file <path>`
- `--new-passphrase-file <path>`
- `--algorithm <pbkdf2|scrypt>`

Request payloads may also provide the same fields.

### Secret Source Rules

- provide either direct passphrase values or passphrase-file paths
- reading both old and new passphrases from stdin is invalid
- reading request payload JSON from stdin and any passphrase from stdin is invalid
- empty passphrases are invalid

Relay must stay non-interactive. There is no prompt fallback.

### Result Shape

Successful `result` rows should expose:

- `commitOid`
- `updatedVault`
- `rotatedSlugs`
- `skippedSlugs`
- `rotatedCount`
- `skippedCount`
- `entryCount`
- `kdfAlgorithm`

This keeps both the vault side effect and the resulting metadata explicit.

### Error Behavior

Relay should preserve existing domain error codes where they already describe
the failure correctly:

- `NO_MATCHING_RECIPIENT`
- `VAULT_METADATA_INVALID`
- `VAULT_CONFLICT`

Missing or contradictory passphrase inputs remain `INVALID_INPUT`.

## Implementation Outline

1. Add `vault rotate` to the Relay command registry.
2. Parse passphrase sources from flags or request payloads.
3. Enforce stdin and empty-secret constraints explicitly.
4. Call the existing `cas.rotateVaultPassphrase()` operation.
5. Read updated vault metadata and return explicit commit/KDF/result data.

## Tests To Write First

- vault rotate succeeds and reports commit, rotated slugs, skipped slugs, and KDF algorithm
- vault rotate supports request payloads plus passphrase-file inputs
- vault rotate applies an algorithm override and exposes the resulting KDF algorithm
- missing old or new passphrase surfaces as `INVALID_INPUT`
- wrong old passphrase surfaces as a structured protocol error

These are Relay contract tests and belong in the agent CLI integration suite.

## Risks And Unknowns

- vault-wide rotation is a more sensitive operation than asset-level rotation,
  so the input contract must stay strict and unsurprising
- direct-key encrypted entries are intentionally skipped, and that distinction
  needs to remain explicit in the result payload

## Retrospective

Pending.
