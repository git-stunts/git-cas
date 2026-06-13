# TR — Vault Privacy Mode

Legend: [TR - Truth](../../../method/legends/TR_truth.md)

## Idea

In the current implementation, vault slugs (e.g., `user/secrets/my-file.txt`) are stored as plain-text tree entry names in the `refs/cas/vault` ref. This allows anyone with read access to the repository to discover the names and counts of all stored assets, even if the content blobs are encrypted.

Add an optional "Privacy Mode" to the vault. When enabled, slugs are HMAC-hashed using a vault-level secret before being used as tree entry names. This masks the asset names while still allowing for O(1) resolution given the correct slug and secret.

## Why

1. **Discovery Prevention**: Prevents attackers from learning about the repository's contents through metadata analysis.
2. **Metadata Security**: Aligns with the "What It Is Not" section of the README (metadata-oblivious storage) by making it a reachable goal.
3. **Professionalism**: Industrial-grade storage should not leak the names of the files it is protecting.

## Effort

Medium — requires adding the HMAC logic to VaultService and updating the vault-initialization flow to manage the privacy secret.

## Status

- [x] Implemented — `security/audit-fixes` branch
- Privacy key derived via HMAC-SHA256(vaultKey, "git-cas-privacy-v1")
- Tree entry names become HMAC-SHA256(privacyKey, slug) (64-char hex)
- Encrypted `.privacy-index` blob maps slug→hash for listing
- Privacy mode requires vault encryption; opt-in via initVault
- CryptoPort.hmacSha256 added for cross-runtime HMAC support
- 12 new tests covering all operations and error paths
