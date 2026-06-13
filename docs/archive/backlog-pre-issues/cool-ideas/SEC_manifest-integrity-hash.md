# SEC — Manifest-Level Integrity Hash

## The Idea

Chunk blobs are SHA-256 verified on restore, but the manifest blob itself relies
entirely on Git's content-addressed storage (the OID *is* the integrity check). A
corrupted or tampered `.git/objects` directory could serve a modified manifest
without detection.

Add a self-referential integrity field: hash the manifest content (minus the hash
field itself) and store it in the manifest. On read, recompute and compare. This
is distinct from manifest signing (which requires a key) — it's a checksum that
catches accidental corruption.

## Why It's Interesting

- Defense-in-depth against corrupted git object stores
- No key management required (unlike the existing manifest signing cool-idea)
- Could catch codec round-trip bugs (JSON → CBOR migration edge cases)
- Cheap: one SHA-256 on a few KB of JSON/CBOR
- Backward compatible: old manifests without the field just skip the check

## Status

- [x] Implemented — `security/audit-fixes` branch
- SHA-256 of codec-encoded manifest (minus hash field) stored as `manifestHash`
- Verified on read; MANIFEST_INTEGRITY_ERROR on mismatch
- Both flat and Merkle trees include the hash
- Old manifests without the field skip verification (backward compat)
