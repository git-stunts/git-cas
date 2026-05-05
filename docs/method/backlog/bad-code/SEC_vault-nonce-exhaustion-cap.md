# SEC: Vault encryption nonce budget needs an enforced cap

- **Status**: Resolved for v6 hard-cap behavior; operational surfacing remains
  a future enhancement
- **File**: `src/domain/services/VaultService.js`
- **Severity**: High
- **Category**: Cryptographic safety boundary

## Description

Encrypted vault writes were tracked with `encryptionCount` and warned after the
advisory threshold, but the service did not refuse writes once the vault reached
the maximum safe write budget for a key.

## Why It Bothers Us

Warnings are easy to miss in automation. A cryptographic usage budget should be
an enforceable invariant, not only an operator suggestion.

## Follow-Up

- Done: add `VaultService.ENCRYPTION_COUNT_MAX` at `2^32 - 1`.
- Done: make encrypted `addToVault` throw `VAULT_NONCE_EXHAUSTED` once the
  count reaches the hard cap.
- Done: add a regression proving exhausted vaults do not write blobs or update
  refs.
- Future operational enhancement: surface nonce-budget status in `git cas
  vault info`, `git cas doctor`, or release-readiness checks.
