# Design: AES-GCM AAD Binding

## Problem

AES-GCM encryption in git-cas does not use Additional Authenticated Data (AAD).
Ciphertext is not bound to its context (slug, frame position), so an attacker
with repo write access can swap encrypted blobs between manifests using the same
key. Decryption succeeds silently.

## Solution

Add derivable AAD to new encryption schemes `whole-v2` and `framed-v2`. Old
schemes remain unchanged for backward compatibility.

### AAD Construction

```
whole-v2:   AAD = UTF-8 bytes of slug
framed-v2:  AAD = UTF-8 bytes of "slug\0" + 4-byte big-endian frame index
```

NUL separator in framed AAD prevents slug collision: `"a\0" + frame1` is distinct
from `"a\0" + frame0`.

### Scheme Detection

Decryption checks `manifest.encryption.scheme`:
- `whole-v1` / absent → decrypt without AAD (backward compat)
- `whole-v2` → decrypt with slug as AAD
- `framed-v1` → decrypt frames without AAD
- `framed-v2` → decrypt frames with slug + frame index as AAD

New stores default to `whole-v2` (unframed) or `framed-v2` (framed).

### Changes Required

| Layer | Change |
|-------|--------|
| **CryptoPort** | Add optional `aad` param to `encryptBuffer`, `decryptBuffer`, `createEncryptionStream`, `createDecryptionStream` |
| **NodeCryptoAdapter** | Call `cipher.setAAD(aad)` / `decipher.setAAD(aad)` when provided |
| **BunCryptoAdapter** | Same as Node |
| **WebCryptoAdapter** | Add `additionalData: aad` to encrypt/decrypt algorithm params |
| **ManifestSchema** | Add `whole-v2` and `framed-v2` to scheme literals |
| **CasService store** | Thread slug → AAD through encryption paths; default to v2 schemes |
| **CasService restore** | Derive AAD from manifest slug + scheme; thread to decryption |

### No Manifest Storage Needed

AAD is derived from `slug` (already in manifest) and `frameIndex` (implicit in
stream order). Nothing new stored.

### Backward Compatibility

- Existing encrypted data with `whole-v1` / `framed-v1` / no scheme → decrypted
  without AAD exactly as before
- New data encrypted with v2 schemes → requires v2-aware code to decrypt
- This is a **minor version bump** (new feature, no breaking change to existing data)
