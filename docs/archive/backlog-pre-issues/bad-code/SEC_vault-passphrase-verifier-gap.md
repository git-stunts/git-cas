# SEC: Vault metadata lacks a passphrase verifier

- **File**: `src/domain/services/VaultService.js`
- **Severity**: Medium
- **Category**: Authentication ambiguity for empty encrypted vaults
- **Status**: Resolved for v6.0.0

## Description

Vault metadata stores KDF parameters but no authenticated verifier for the derived
vault key. The TUI can now keep encrypted/privacy vaults locked before unlock and
can reject wrong passphrases when `listVault({ encryptionKey })` or encrypted
manifest integrity verification fails. That still leaves an edge case: an
encrypted vault with no encrypted entries has nothing for the UI to authenticate
against after deriving a key.

## Why It Bothers Us

An empty encrypted vault, or a vault whose current entries are all plaintext,
can accept any passphrase that derives a well-formed key because there is no
metadata-level proof that the key is correct. Privacy mode usually catches this
through the encrypted privacy index, and encrypted manifests catch it through
integrity verification, but vault-level auth should not depend on existing
asset content.

## Follow-Up

- Added a metadata-level AES-GCM verifier encrypted by the vault key during
  `initVault`.
- `readState({ encryptionKey })`, `verifyVaultKey({ encryptionKey })`, human CLI
  passphrase flows, agent passphrase flows, and vault passphrase rotation now
  validate the verifier when it exists.
- Existing encrypted vaults that lack a verifier remain readable and gain the
  verifier on the next vault write that supplies the vault encryption key.

## Residual Note

Legacy encrypted vaults that have no verifier cannot be authenticated
retroactively while they are still empty; there is no prior ciphertext to check.
The first keyed write creates the verifier, and future wrong passphrases fail
before empty-vault writes are accepted.
