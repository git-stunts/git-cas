# Upgrading to git-cas v6.0.0

v6.0.0 is a major release that simplifies the encryption model, hardens security defaults, and cleans up the architecture. This guide covers every breaking change and what you need to do.

## Quick Start

If you have an existing vault with encrypted assets:

```bash
# See what needs migration (safe — no changes made)
npm run upgrade

# Apply the migration
npm run upgrade -- --execute --passphrase <your-vault-passphrase>
```

If you only use the library API (no vault), skip to [API Changes](#api-changes).

---

## Encryption Scheme Simplification

### What Changed

v5 had 5 encryption scheme identifiers. v6 has 3:

| v5 Scheme | v6 Scheme | Migration |
|---|---|---|
| `whole-v1` | `whole` | **Re-encryption required** (v1 had no AAD) |
| `whole-v2` | `whole` | Rename only (already had AAD) |
| `framed-v1` | `framed` | **Re-encryption required** (v1 had no AAD) |
| `framed-v2` | `framed` | Rename only (already had AAD) |
| `convergent-v1` | `convergent` | Rename only |

### Why

Version suffixes on scheme names were compatibility cruft. AAD (Additional Authenticated Data) binding is now unconditional — every `whole` and `framed` manifest binds the slug to the ciphertext, preventing cross-manifest blob substitution attacks.

### What Happens if You Don't Migrate

Any call to `readManifest()`, `restore()`, `restoreFile()`, or `restoreStream()` on a v5 manifest will throw:

```
CasError: Legacy encryption scheme "framed-v1" is no longer supported.
Run scripts/migrate-encryption.js to upgrade this manifest.
[code: LEGACY_SCHEME]
```

### How to Migrate

```bash
# Dry-run: see what needs migration
npm run upgrade

# Execute: migrate all vault entries
npm run upgrade -- --execute --passphrase <passphrase>
```

The migration script has two modes:

- **Fast mode** (v2 schemes + convergent): renames the scheme in the manifest metadata. No re-encryption. Seconds.
- **Full mode** (v1 schemes): restores through the legacy pipeline (decrypts without AAD), then re-stores with the current scheme (encrypts with AAD). Requires passphrase.

Original blobs are never deleted — Git's garbage collection only removes unreferenced objects after `git gc`.

---

## Default Scheme Changes

### What Changed

| Scenario | v5 Default | v6 Default |
|---|---|---|
| CDC chunking + encryption | `framed-v1` | `convergent` |
| Fixed chunking + encryption | `framed-v1` | `framed` |
| Explicit `whole` | `whole-v1` | `whole` |

### What This Means

- **Convergent encryption** is now the default when using CDC chunking with encryption. This means deduplication works even with encrypted content — identical plaintext chunks produce identical ciphertext.
- If you were explicitly passing `encryption: { scheme: 'framed-v1' }`, change to `encryption: { scheme: 'framed' }`.
- If you were relying on the old default and want to keep framed encryption with CDC, pass `encryption: { scheme: 'framed' }` explicitly.

---

## API Changes

### Byte Types

Public byte-oriented APIs now use `Uint8Array` instead of Node-specific
`Buffer` types:

- `store({ source })` expects `AsyncIterable<Uint8Array>`.
- `restore()` returns `{ buffer: Uint8Array, bytesWritten }`.
- `restoreStream()` yields `Uint8Array` chunks.
- Port implementations for crypto, compression, chunking, persistence, and
  codecs should accept and return `Uint8Array`.

Node callers can still pass `Buffer` values because `Buffer` is a
`Uint8Array` subclass. Code that calls `buffer.equals(...)` on restore results
should compare with `Buffer.from(buffer).equals(...)` or use a runtime-neutral
byte comparison helper.

### CasService Constructor (Library Users)

**If you use `ContentAddressableStore` (the facade):** No changes needed. The facade handles all defaults.

**If you use `CasService` directly:**

```diff
- const service = new CasService({
-   persistence, codec, crypto, observability,
- });

+ import { FixedChunker, NodeCompressionAdapter } from '@git-stunts/git-cas';
+
+ const service = new CasService({
+   persistence, codec, crypto, observability,
+   chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
+   compressionAdapter: new NodeCompressionAdapter(),
+ });
```

`chunker` and `compressionAdapter` are now **required**. They were previously optional with internal defaults — the defaults moved to the facade layer to keep the domain service free of infrastructure imports.

### New CryptoPort Methods

If you implement a custom `CryptoPort`, you must add these methods:

```js
// HMAC-SHA256 (used by vault privacy mode)
hmacSha256(key, data) { /* return 32-byte Uint8Array or Promise<Uint8Array> */ }

// Deterministic encryption (used by convergent encryption)
encryptBufferWithNonce(buffer, key, nonce) { /* return { buf, tag } */ }
decryptBufferWithNonceTag(buffer, key, nonce, tag) { /* return Uint8Array */ }
```

The shipped adapters (`NodeCryptoAdapter`, `BunCryptoAdapter`, `WebCryptoAdapter`) already implement these.

### Encryption Metadata Schema

Encrypted manifests now **require** the `scheme` field. Pre-v5.2 manifests that omitted `scheme` will fail schema validation. The migration script handles this.

### New Manifest Fields

- **`formatVersion`**: Semver string (e.g., `"6.0.0"`) stamped into new manifests. Identifies which library version wrote the manifest. Optional on read — old manifests without it still parse.
- **`manifestHash`**: SHA-256 of the codec-encoded manifest content. Verified on read. Catches corruption. Optional on read.

### New Exports

```js
// Standalone manifest diffing
import { diffManifests } from '@git-stunts/git-cas';

// Or as a static method
import ContentAddressableStore from '@git-stunts/git-cas';
ContentAddressableStore.diffManifests(oldManifest, newManifest);

// Compression port for custom adapters
import { CompressionPort, NodeCompressionAdapter } from '@git-stunts/git-cas';

// Scheme constants
import { SCHEME_WHOLE, SCHEME_FRAMED, SCHEME_CONVERGENT } from '@git-stunts/git-cas';
```

### Behavioral Changes

| Change | Impact |
|---|---|
| Plaintext + gzip restore now streams | Lower memory usage. Should be transparent. |
| AAD always on for `whole` and `framed` | Cannot opt out. v1-style no-AAD is gone. |
| Manifest integrity hash verified on read | Corrupted manifests that previously loaded will now throw `MANIFEST_INTEGRITY_ERROR`. |
| KDF policy enforced in `deriveKey()` | Dangerously weak params (e.g., 1 PBKDF2 iteration) now throw `KDF_POLICY_VIOLATION`. |
| Concurrency capped at 64 | Was unbounded. Unlikely to affect real usage. |
| frameBytes capped at 64 MiB | Was unbounded. Unlikely to affect real usage. |

---

## New Features (Non-Breaking)

These are new capabilities that don't require migration:

- **Convergent encryption** — CDC dedup works with encryption
- **FastCDC dual-mask normalization** — tighter chunk size distribution (default on)
- **Manifest integrity hash** — SHA-256 checksum on manifests
- **Vault privacy mode** — HMAC-hashed slug names
- **Manifest diffing** — compare two manifests by chunk digest
- **Parallel chunk restore** — prefetch window for concurrent reads
- **CompressionPort** — pluggable compression (shipped: gzip via NodeCompressionAdapter)
- **ConvergentEncryption service** — extracted domain service
- **PrefetchWindow** — ordered parallel read primitive
- **Scheme truth module** — `src/domain/encryption/schemes.js`

---

## Troubleshooting

### `LEGACY_SCHEME` error on restore

```
CasError: Legacy encryption scheme "whole-v1" is no longer supported.
```

Run `npm run upgrade -- --execute --passphrase <pass>` to migrate.

### `KDF_POLICY_VIOLATION` on deriveKey

```
CasError: deriveKey KDF field "iterations" must be between 100000 and 2000000
```

v6 enforces minimum KDF parameters. Increase iterations to at least 100,000 (PBKDF2) or cost to at least 16,384 (scrypt).

### `MANIFEST_INTEGRITY_ERROR` on readManifest

```
CasError: Manifest integrity check failed: hash mismatch
```

The manifest blob was corrupted or tampered with after storage. The original data may still be recoverable from Git's object database if the corruption was in the tree, not the blob.

### Constructor throws "chunker is required"

You're using `CasService` directly. Either switch to the `ContentAddressableStore` facade (recommended) or inject a `chunker` and `compressionAdapter` manually. See [API Changes](#casservice-constructor-library-users).
