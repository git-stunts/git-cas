# Design: Vault Privacy Mode

## Problem

Vault slugs are stored as plain-text tree entry names in `refs/cas/vault`.
Anyone with repo read access can discover asset names and counts even when
content is encrypted.

## Solution

Optional privacy mode that HMAC-hashes slugs before using them as tree entry
names. An encrypted slug index stored in the vault tree allows resolving
HMAC names back to slugs for listing.

### Requirements

- Privacy mode requires vault encryption (no point hiding names if content is
  plaintext)
- A privacy key is derived from the vault passphrase via HKDF-like derivation
- Tree entry names become `HMAC-SHA256(privacyKey, slug)` (64-char hex)
- An encrypted `.privacy-index` blob maps slug→hmacName for listing/enumeration
- Single-slug resolution works without the index: compute `HMAC(key, slug)` and
  look up the tree entry directly

### Privacy Key Derivation

```
privacyKey = HMAC-SHA256(vaultEncryptionKey, "git-cas-privacy-v1")
```

Derived deterministically from the vault encryption key. No separate secret
to manage. Changes when the vault passphrase rotates.

### Tree Structure (privacy mode on)

```
refs/cas/vault → commit → tree:
  .vault.json          (metadata with privacy: { enabled: true })
  .privacy-index       (encrypted JSON: { "slug": "hmacName", ... })
  <hmac-hash-1>        (tree OID for first entry)
  <hmac-hash-2>        (tree OID for second entry)
```

### Operations

| Operation | Without privacy | With privacy |
|-----------|-----------------|--------------|
| **Add** | `encodeSlug(slug)` → tree name | `HMAC(key, slug)` → tree name; update index |
| **Remove** | lookup by slug | `HMAC(key, slug)` → tree name; update index |
| **Resolve** | lookup by slug | `HMAC(key, slug)` → tree name (no index needed) |
| **List** | iterate tree names, decodeSlug | decrypt index, return slug list |

### Changes

| Component | Change |
|-----------|--------|
| **VaultService** | Add privacy mode flag check; derive privacy key; encrypt/decrypt index |
| **VaultService.writeCommit** | Use HMAC names when privacy enabled; write encrypted index |
| **VaultService.readState** | Decrypt index when privacy enabled to populate entries Map |
| **VaultService.listVault** | Requires passphrase when privacy enabled |
| **.vault.json schema** | Add `privacy: { enabled: boolean }` field |

### Backward Compatibility

- Existing vaults without privacy → no change
- Privacy mode is opt-in at vault initialization or via a migration command
- Git history still shows old plain-text names (privacy only affects new commits)

### Limitation

Privacy mode hides slug names in the current tree but does NOT scrub git history.
Old commits may still contain plain-text slug names. This is documented, not
a bug — git history rewriting is destructive and out of scope.
