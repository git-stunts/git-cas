# 0043-vault-retry-abstraction

## Title

Unify vault mutations behind one CAS retry orchestration helper

## Why

`VaultService` already has retry logic for some mutations, but the orchestration
is still uneven:

- `addToVault()` and `removeFromVault()` go through `#retryMutation()`
- `initVault()` writes directly and bypasses the retry loop

That leaves one vault mutation outside the shared optimistic-concurrency path
and keeps the mutation boundary more ad hoc than it needs to be.

## Decision

Replace the current retry helper with a more explicit vault-mutation
orchestration seam and route `initVault()`, `addToVault()`, and
`removeFromVault()` through it.

## Scope

This cycle covers:

- one formal vault mutation retry helper
- moving `initVault()` onto the shared retry path
- preserving existing add/remove behavior through the same abstraction

This cycle does not cover:

- `rotateVaultPassphrase()`
- changing retry timing policy
- wider vault API redesign

## Playback Questions

1. Does `initVault()` now retry on `VAULT_CONFLICT` the same way add/remove do?
2. Do add/remove still behave the same while using the shared helper?
3. Did the cycle stay focused on vault mutation orchestration?

## Red Tests

The executable spec will live in:

- `test/unit/vault/VaultService.test.js`

## Green Shape

Vault mutations should provide only their delta logic while the service owns
the read-apply-write-retry loop.
