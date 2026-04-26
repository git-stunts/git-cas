# REL: Document breaking changes and migration guide

## What

A `UPGRADING.md` at the repo root that covers every breaking change in v6.0.0
and exactly what users need to do.

## Breaking Changes to Document

### 1. Encryption scheme identifiers renamed

- `whole-v1` / `whole-v2` → `whole`
- `framed-v1` / `framed-v2` → `framed`
- `convergent-v1` → `convergent`
- Legacy identifiers throw `LEGACY_SCHEME` at `readManifest()` time
- Run `npm run upgrade` to migrate existing manifests

### 2. CasService constructor requires injected dependencies

- `chunker` (ChunkingPort) is now required — was optional with FixedChunker default
- `compressionAdapter` (CompressionPort) is now required — was optional with node:zlib default
- Users of the facade (`ContentAddressableStore`) are unaffected — it handles defaults
- Users of `CasService` directly must inject both

### 3. AAD is always on

- `whole` and `framed` always bind AAD (slug / slug+frame index)
- No opt-out. v1-style no-AAD encryption is gone.
- v1-encrypted data needs re-encryption via `npm run upgrade`

### 4. Default encryption scheme changed

- CDC + encryption now defaults to `convergent` (was `framed-v1`)
- Non-CDC + encryption now defaults to `framed` (was `framed-v1`)
- Explicit `encryption: { scheme: 'whole' }` still works

### 5. ManifestSchema.scheme is required

- Encrypted manifests must have a `scheme` field
- Pre-scheme manifests (very old) fail schema validation
- Migration adds the field

### 6. New manifest field: formatVersion

- New manifests include `formatVersion: "6.0.0"` (semver from package.json)
- Optional on read — old manifests without it still parse
- Informational only — used by migration script to detect writer version

### 7. New CryptoPort abstract methods

- `hmacSha256(key, data)` — required for vault privacy mode
- `encryptBufferWithNonce(buffer, key, nonce)` — required for convergent encryption
- `decryptBufferWithNonceTag(buffer, key, nonce, tag)` — required for convergent encryption
- Custom CryptoPort implementations must add these

### 8. Plaintext + gzip restore now streams

- Was buffered (entire file in memory), now streams
- Behavioral change: lower memory usage, different error timing
- Should be transparent to most users

## Acceptance Criteria

- [x] `UPGRADING.md` exists at repo root
- [x] Every breaking change has: what changed, who is affected, what to do
- [x] Code examples for common migration scenarios
- [x] Links to `npm run upgrade` for automated migration

## Status

- [x] Resolved — `release/v6.0.0` branch
