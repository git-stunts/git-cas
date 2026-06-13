# TR — Manifest Signing

Legend: [TR - Truth](../../../method/legends/TR_truth.md)

## Idea

While `git-cas` verifies chunk integrity via SHA-256 digests, the manifest itself is currently unsigned. A malicious repository administrator or a compromised machine could theoretically modify the `blob` OIDs in a manifest to point to different data without triggering an integrity failure (as the new data would match its own digest, but not the *intended* data).

Allow manifests to be sealed with an optional Ed25519 cryptographic signature. This signature would cover the entire chunk list and metadata, ensuring that the *order and identity* of the chunks remain exactly as they were during the initial store operation.

## Why

1. **Cryptographic Settlement**: Provides mathematical proof that the restored asset is exactly what was stored, not just a set of valid-but-substituted chunks.
2. **Auditability**: Sealed manifests can be used as evidence in high-stakes coordination environments (like Xyph).
3. **Security**: Neutralizes "manifest substitution" attacks.

## Effort

Medium — requires adding signing logic to the store path and verification logic to the restore/verify paths.

## Status

- [x] Resolved (lighter variant) — `security/audit-fixes` branch
- `manifestHash` (SHA-256 of codec-encoded manifest) catches corruption and tampering
- No key management required — checksum-based, not signature-based
- Ed25519 signing remains a future option if cryptographic non-repudiation is needed,
  but the integrity goal of this card is met by the hash approach
