# RL-005 — Relay: Agent Vault Lifecycle

## Status

Landed

## Linked Legend

- [RL — Relay](../legends/RL-relay.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

Relay already covers:

- read-only vault inspection
- asset store and restore
- recipient mutation
- recipient key rotation
- vault passphrase rotation

The next missing bounded step is vault lifecycle mutation:

- initialize a vault
- remove an entry from the vault

These already exist in the human CLI. Relay needs the same behavior through a
machine-facing contract.

## Human Users, Jobs, And Hills

### Users

- maintainers
- release engineers
- operators bootstrapping or pruning vault state

### Jobs

- initialize a vault through automation with or without encryption
- remove an entry and know exactly what was deleted and what commit recorded it

### Hill

A human operator can automate the basic vault lifecycle without leaving the
Relay surface or guessing at hidden side effects.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- CI jobs
- repository automation workflows

### Jobs

- initialize plaintext or encrypted vaults deterministically
- remove entries by slug and observe the resulting commit and removed tree
- branch on invalid input and missing entry failures without parsing prose

### Hill

An agent can manage the basic vault lifecycle entirely through the Relay
contract.

## Human Playback

- Can an operator see whether vault initialization was encrypted directly from
  the result row?
- Can an operator see which tree was removed and which commit recorded the
  removal?

## Agent Playback

- Can an agent initialize a plaintext vault?
- Can it initialize an encrypted vault using request-payload passphrase-file
  inputs and observe the resulting KDF algorithm?
- Can it remove an entry by slug and get the removed tree plus commit directly?
- Do missing-passphrase and missing-entry failures stay structured?

## Explicit Non-Goals

- no asset store workflow in this cycle
- no vault passphrase rotation in this cycle
- no interactive passphrase prompts
- no vault entry add/update flow in this cycle

## Decisions

### Command Shape

Relay adds:

- `git cas agent vault init`
- `git cas agent vault remove --slug <slug>`

Optional `vault init` inputs:

- `--passphrase <pass>`
- `--passphrase-file <path>`
- `--algorithm <pbkdf2|scrypt>`

Request payloads may also provide the same fields.

### Secret Source Rules

- `vault init` remains non-interactive
- provide either inline passphrase or passphrase-file, not both
- if the request payload comes from stdin, the passphrase file cannot also be `-`
- `--algorithm` is only valid when vault encryption is requested
- empty passphrases are invalid

### Result Shape

Successful `vault init` `result` rows should expose:

- `commitOid`
- `initializedVault`
- `encrypted`
- `kdfAlgorithm` when encrypted

Successful `vault remove` `result` rows should expose:

- `slug`
- `commitOid`
- `removedTreeOid`
- `updatedVault`

### Error Behavior

Relay should preserve existing domain error codes where they already describe
the failure correctly:

- `VAULT_ENTRY_NOT_FOUND`

Missing or contradictory inputs remain `INVALID_INPUT`.

## Implementation Outline

1. Add `vault init` and `vault remove` to the Relay command registry.
2. Parse explicit slug and passphrase-source inputs from flags or request
   payloads.
3. Reuse the existing passphrase-file safety rules from the Relay surface.
4. Call the existing `cas.initVault()` and `cas.removeFromVault()` operations.
5. Return explicit result rows with commit-side effects.

## Tests To Write First

- vault init succeeds without encryption and reports a commit
- vault init succeeds with encrypted request-payload passphrase-file input and
  reports the resulting KDF algorithm
- vault init rejects `--algorithm` without an encryption source
- vault remove succeeds and reports the removed tree plus commit
- vault remove surfaces missing-entry failures as structured protocol errors

These are Relay contract tests and belong in the agent CLI integration suite.

## Risks And Unknowns

- `vault init` is foundational, so the passphrase contract must remain strict
  and unsurprising
- the result shapes should stay stable enough that future session-oriented
  Relay work can build on them without compatibility churn

## Retrospective

Pending.
