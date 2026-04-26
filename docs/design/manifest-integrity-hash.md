# Design: Manifest-Level Integrity Hash

## Problem

Manifest blobs rely solely on Git's content-addressed OID for integrity. A
corrupted `.git/objects` directory or codec round-trip bug could serve a modified
manifest without detection. Chunk blobs are SHA-256 verified on restore, but
the manifest that lists them is not.

## Solution

Add an optional `manifestHash` field: SHA-256 of the manifest content encoded
without the hash field itself.

### Write Path (in `createTree`)

1. Build manifest data as a plain object (without `manifestHash`)
2. Encode with the codec → bytes
3. SHA-256(bytes) → 64-char hex hash
4. Set `manifestData.manifestHash = hash`
5. Re-encode with hash included → store

### Read Path (in `readManifest`)

1. Decode blob → object (may or may not have `manifestHash`)
2. If `manifestHash` is present:
   a. Extract and remove hash from a copy
   b. Re-encode the copy with the codec → bytes
   c. SHA-256(bytes) → compare to stored hash
   d. Throw `MANIFEST_INTEGRITY_ERROR` on mismatch
3. If absent → skip check (backward compat)

### Why codec-based hashing?

The hash is over the codec's encoded bytes (JSON or CBOR), not a separate
canonical form. This means the hash is tied to the codec, but that's correct —
a manifest is always read with the same codec it was written with.

### Changes

| Component | Change |
|-----------|--------|
| **ManifestSchema** | Add optional `manifestHash: z.string().regex(/^[0-9a-f]{64}$/)` |
| **CasService.createTree** | Compute hash before encoding, set field, re-encode |
| **CasService.readManifest** | Verify hash after decoding if present |
| **Manifest.toJSON** | Include `manifestHash` in serialization |

### Backward Compatibility

- Old manifests without `manifestHash` → no verification (skip)
- New manifests always include the hash
- No version bump needed — the field is optional
