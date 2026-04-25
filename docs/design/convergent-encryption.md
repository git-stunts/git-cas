# Design: Convergent Encryption

## Problem

CDC deduplication is useless with encryption — ciphertext is pseudorandom, so
identical plaintext chunks produce different blobs. The "encryption kills dedup"
tension has been on the BEARING since day one.

## Solution

New scheme `convergent-v1`: chunk plaintext first, then encrypt each chunk with a
deterministic key derived from its content hash. Identical plaintext → identical
key → identical ciphertext → Git deduplicates at the blob level.

### How It Works

```
For each plaintext chunk:
  1. digest     = SHA-256(plaintext)           — same as today
  2. chunkKey   = HMAC-SHA256(masterKey, "git-cas-convergent-key:" + digest)
  3. chunkNonce = first 12 bytes of HMAC-SHA256(masterKey, "git-cas-convergent-nonce:" + digest)
  4. { ciphertext, tag } = AES-256-GCM(chunkKey, chunkNonce, plaintext)
  5. blob       = persistence.writeBlob(ciphertext || tag)   — tag appended
  6. manifest chunk: { index, size, digest, blob }           — unchanged schema
```

### Why This Works for Dedup

- Same plaintext → same digest → same derived key + nonce → same ciphertext
- Git is content-addressed: identical ciphertext → same blob OID
- Two manifests referencing the same plaintext chunk share one Git blob

### Manifest

```json
{
  "scheme": "convergent-v1",
  "algorithm": "aes-256-gcm",
  "encrypted": true
}
```

No per-chunk encryption metadata needed. The key and nonce are derived from
the manifest's existing `digest` field. The GCM auth tag is appended to the
blob (16 bytes).

ChunkSchema is UNCHANGED — `{ index, size, digest, blob }` stays the same.
The `digest` is over plaintext (not ciphertext), which is what makes dedup work.

### Store Path

In `_storeChunk()` (line ~160):
- Compute plaintext digest (existing)
- If convergent: derive key + nonce from digest, encrypt, append tag, write
- If not convergent: write plaintext (existing)

The convergent key is threaded from `store()` through `_chunkAndStore()`.

### Restore Path

In `_readAndVerifyChunk()` (line ~1109):
- Read blob from Git
- If convergent: split off 16-byte tag, derive key + nonce from stored digest,
  decrypt, verify SHA-256(plaintext) === digest
- If not convergent: verify SHA-256(blob) === digest (existing)

### Default Behavior

- CDC + encryption → convergent on by default
- Fixed chunking + encryption → convergent off (fixed chunks have less dedup benefit)
- User can override: `encryption: { convergent: false }` to opt out
- `encryption: { convergent: true }` forces it on regardless of chunking strategy

### Backward Compatibility

- Existing `whole-v1/v2` and `framed-v1/v2` manifests → restored as before
- `convergent-v1` is a new scheme — old code will reject it with "unknown scheme"
- This is a minor version bump

### Security Tradeoff

Convergent encryption leaks whether two chunks contain identical plaintext.
An attacker with read access to the Git object database can observe that two
manifests reference the same blob OID, inferring content equality. This is
the well-known limitation of convergent encryption (Tahoe-LAFS, etc.).

**Acceptable for**: backups, build artifacts, asset storage, binary blobs.
**Not suitable for**: scenarios where knowing two files are identical is itself
sensitive (e.g., healthcare records, classified documents).

### Changes Required

| Component | Change |
|-----------|--------|
| **ManifestSchema** | Add `convergent-v1` to scheme enum |
| **CasService._storeChunk** | Per-chunk encryption when convergent key present |
| **CasService._readAndVerifyChunk** | Per-chunk decryption + plaintext digest verify |
| **CasService._chunkAndStore** | Thread convergent key |
| **CasService._resolveStoreEncryptionConfig** | Default convergent when CDC + encryption |
| **CasService store/restore** | Detect `convergent-v1` scheme, derive key, thread |
| **Key derivation helpers** | `deriveConvergentChunkKey()`, `deriveConvergentNonce()` |
