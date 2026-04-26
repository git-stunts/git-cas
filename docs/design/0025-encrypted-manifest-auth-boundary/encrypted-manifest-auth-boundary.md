# 0025-encrypted-manifest-auth-boundary

## Title

Enforce encrypted-manifest authenticity boundaries in restore and verify flows

## Why

The current encrypted restore and integrity behavior has two trust leaks:

1. a manifest can be tampered to set `encryption.encrypted = false`, causing
   restore to return ciphertext as if it were valid plaintext
2. `verifyIntegrity()` only re-hashes chunk blobs and can return `true` even if
   the AES-GCM tag in the manifest has been tampered

That means encrypted assets are using strong primitives inside a weak boundary.

## Decision

Tighten the boundary in two places:

- restore paths must reject invalid encrypted-manifest metadata instead of
  silently downgrading into plaintext restore
- `verifyIntegrity()` must perform authenticated verification for encrypted
  assets and only return `true` after both chunk hashing and decryption auth
  succeed

## Scope

This cycle covers:

- `restore()`
- `restoreStream()`
- `verifyIntegrity()`

It may extend `verifyIntegrity()` with optional decryption credentials while
keeping the boolean return contract.

This cycle does not cover:

- KDF parameter bounding
- rollback or replay protection
- streaming encrypted restore

## Behavior

### Restore

If a manifest includes encryption metadata, restore must treat that metadata as
security-critical.

Restore must fail with an integrity-style error when:

- `encryption.encrypted !== true`
- `encryption.algorithm !== 'aes-256-gcm'`

Restore must not emit ciphertext as valid output when encryption metadata has
been downgraded or malformed.

### Verify Integrity

For unencrypted content, behavior remains the same: hash chunks and return
`true` or `false`.

For encrypted content:

- chunk digests must still be verified
- authenticated decryption must also succeed
- `true` means both checks passed
- missing decryption credentials must not return `true`
- auth-tag tampering must return `false`

## Playback Questions

1. Does restore reject downgraded encrypted manifests instead of returning raw
   ciphertext?
2. Does encrypted `verifyIntegrity()` return `false` when authentication fails,
   even if chunk hashes still match?
3. Does encrypted `verifyIntegrity()` avoid false positives when no key or
   passphrase is provided?
4. Do unencrypted verify flows remain unchanged?

## Red Tests

The executable spec lives in:

- `test/unit/domain/services/CasService.restore.test.js`
- `test/unit/domain/services/CasService.errors.test.js`
- `test/unit/domain/services/CasService.events.test.js`

## Green Shape

Add a small encrypted-manifest validation helper in `CasService` and route both
restore and verify flows through it. Keep the changes local to the service
layer.
