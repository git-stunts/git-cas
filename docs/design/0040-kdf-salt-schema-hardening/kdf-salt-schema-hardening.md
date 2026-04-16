# 0040-kdf-salt-schema-hardening

## Title

Harden stored KDF salt shape across manifest and vault metadata

## Why

KDF parameter policy is now bounded, but the stored `salt` field still accepts
any non-empty string at the schema layer. That leaves a structural mismatch:
most KDF metadata is validated explicitly while salt shape still depends on
downstream decode behavior.

## Decision

Use one canonical-base64 helper for stored KDF salt validation and apply it in
both the manifest schema path and the runtime stored-KDF policy path.

## Scope

This cycle covers:

- one shared canonical-base64 helper
- manifest KDF salt schema hardening
- runtime stored-KDF salt validation for vault and passphrase-restore paths

This cycle does not cover:

- KDF cost/iteration policy changes
- changing salt length policy
- broader crypto metadata redesign

## Playback Questions

1. Do manifests now reject malformed KDF salt strings at parse time?
2. Do vault metadata and stored-manifest KDF paths reject malformed salt before
   derive work begins?
3. Did the cycle stay structural instead of reopening KDF cost policy?

## Red Tests

The executable spec will live in:

- `test/unit/domain/value-objects/Manifest.test.js`
- `test/unit/vault/VaultService.test.js`
- `test/unit/domain/services/KeyResolver.test.js`

## Green Shape

One canonical-base64 rule, applied consistently wherever stored KDF salt is
trusted.
