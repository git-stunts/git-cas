# SEC: Vault metadata lacks a passphrase verifier

- **File**: `src/domain/services/VaultService.js`
- **Severity**: Medium
- **Category**: Authentication ambiguity for empty encrypted vaults

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

- Add a metadata-level verifier encrypted or MACed by the vault key during
  `initVault`.
- Validate the verifier before accepting a passphrase in CLI, agent, and TUI
  unlock paths.
- Add migration behavior for existing encrypted vaults that lack a verifier.
