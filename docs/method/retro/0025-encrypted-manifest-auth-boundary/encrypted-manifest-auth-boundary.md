# Retro — 0025 Encrypted Manifest Auth Boundary

## Drift Check

- The slice stayed focused on restore and verify behavior.
- The public library API only widened `verifyIntegrity()` enough to accept
  optional encrypted-manifest credentials.
- This cycle did not try to solve streaming encrypted restore, KDF policy, or
  manifest-signing concerns.

## What Shipped

- `restore()` and `restoreStream()` now reject downgraded encrypted manifests
  and unexpected encryption algorithms instead of silently restoring
  ciphertext.
- `verifyIntegrity()` now supports optional `encryptionKey` and `passphrase`
  inputs and only passes encrypted manifests after both digest checks and
  authenticated decrypt succeed.
- `integrity:fail` now covers encrypted-auth failures in addition to chunk
  mismatches.
- API and security docs now explain that encrypted verification requires
  credentials and validates ciphertext authenticity.

## What Did Not

- KDF parameter bounds and stronger defaults did not ship.
- Restore memory hard limits still need a deeper pass for oversized blob and
  decompression-bomb cases.
- Manifest-schema tightening did not move into `ManifestSchema` yet; the first
  enforcement is in the service layer.

## Debt

- Logged follow-on work in:
  - `docs/method/backlog/asap/TR_kdf-parameter-bounds-and-policy.md`
  - `docs/method/backlog/asap/TR_restore-buffer-hard-limits.md`
  - `docs/method/backlog/asap/TR_encryption-metadata-schema-hardening.md`

## Cool Ideas

- If multi-scheme encryption lands later, keep the service-layer validation
  strict and explicit rather than slipping back into “best effort” metadata
  interpretation.
