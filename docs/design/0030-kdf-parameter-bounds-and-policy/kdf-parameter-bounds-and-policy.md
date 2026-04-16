# 0030-kdf-parameter-bounds-and-policy

## Title

Bound KDF metadata and align passphrase defaults with the published security posture

## Why

Passphrase-based store, restore, vault init, and vault rotation still trust KDF
parameters too much.

Two concrete problems remain:

- repository-controlled manifest or vault metadata can request absurd PBKDF2 or
  scrypt parameters and turn passphrase entry into a CPU or memory bomb
- the default KDF settings in code still trail the security guidance published
  in the repo docs

That means `git-cas` is doing real cryptography but still letting untrusted KDF
metadata drive operator cost too directly.

## Decision

Add one shared KDF policy and run the passphrase-bearing entry points through
it.

- New passphrase-derived metadata uses stronger defaults:
  - PBKDF2 defaults to `600000` iterations
  - scrypt defaults to `N=131072`, `r=8`, `p=1`
- Stored KDF metadata is validated before any derive operation runs.
- The read-side policy stays compatibility-aware so legacy metadata written with
  older defaults can still be restored, but out-of-bounds values fail before
  they reach the crypto adapter.
- Policy violations use one explicit error code with source context instead of
  falling through to generic crypto failures.

## Scope

This cycle covers:

- stronger default KDF parameters for new writes
- bounded validation for stored manifest KDF metadata
- bounded validation for stored vault KDF metadata
- explicit rejection of out-of-policy KDF options when creating new encrypted
  metadata through store, vault init, or vault passphrase rotation
- public documentation updates so the user-facing story matches the runtime
  story

This cycle does not cover:

- manifest encryption schema tightening beyond KDF policy
- changing the CLI surface beyond documenting the stronger defaults
- replacing PBKDF2 as the default algorithm

## Policy Shape

### New Write Defaults

- `pbkdf2.iterations = 600000`
- `scrypt.cost = 131072`
- `scrypt.blockSize = 8`
- `scrypt.parallelization = 1`
- `keyLength = 32`

### Stored Metadata Bounds

The stored-metadata policy must reject values that are obviously unsafe or
resource-hostile. It also must remain able to read legacy metadata already
written by older `git-cas` versions.

The first hardening pass will therefore distinguish:

- preferred defaults for new writes
- compatibility-aware acceptance bounds for stored metadata

That means the defaults become stronger immediately, while read-side policy
still protects operators from hostile high-end values without bricking all
older passphrase-encrypted artifacts.

## Behavior

### Store / Vault Init / Vault Rotate

When `git-cas` is about to persist KDF metadata:

- normalize defaults for the chosen algorithm
- validate the normalized parameters against the policy
- throw `KDF_POLICY_VIOLATION` if the parameters are out of bounds

### Restore / Vault Rotation (Old Metadata)

When `git-cas` reads KDF metadata from a manifest or `.vault.json`:

- validate the stored parameters first
- reject out-of-policy metadata with `KDF_POLICY_VIOLATION`
- only call the crypto adapter after policy validation succeeds

## Playback Questions

1. Do new PBKDF2 and scrypt derives use the stronger default parameters in the
   public API?
2. Does passphrase-based store persist the stronger default KDF metadata for new
   encrypted assets?
3. Does restore reject manifest KDF metadata that is outside the accepted
   policy before crypto work begins?
4. Do vault init and vault passphrase rotation reject out-of-policy KDF inputs
   and stored vault KDF metadata clearly?
5. Do the public docs now describe both the stronger defaults and the bounded
   legacy-compatibility policy honestly?

## Red Tests

The executable spec will live in:

- `test/unit/ports/CryptoPort.test.js`
- `test/unit/domain/services/CasService.kdf.test.js`
- `test/unit/domain/services/KeyResolver.test.js`
- `test/unit/domain/services/rotateVaultPassphrase.test.js`
- `test/unit/vault/VaultService.test.js`

## Green Shape

Keep the policy in one shared helper instead of scattering parameter checks
through `KeyResolver`, `VaultService`, `rotateVaultPassphrase`, and adapter
codepaths independently.
