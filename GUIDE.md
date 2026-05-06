# Developer Guide

Comprehensive guide to `@git-stunts/git-cas` -- content-addressed storage backed by Git's object database, with encryption, compression, chunking, and vault management.

For security posture and threat model, see [SECURITY.md](./SECURITY.md).
For architecture and port/adapter internals, see [ARCHITECTURE.md](./ARCHITECTURE.md).
For API reference, see [docs/API.md](./docs/API.md).
For extension points and custom adapter checklists, see [docs/EXTENDING.md](./docs/EXTENDING.md).
For store/restore state machines, see [docs/STORE_RESTORE_PIPELINE.md](./docs/STORE_RESTORE_PIPELINE.md).
For advanced topics (benchmarks, Merkle trees, large-asset strategies), see [ADVANCED_GUIDE.md](./ADVANCED_GUIDE.md).

---

## Choose Your Path

### 1. Library Integration
Embed content-addressed storage into your JavaScript/TypeScript application.
- Start with [Library Quick Start](#library-quick-start) below.
- Understand the port/adapter model: [ARCHITECTURE.md](./ARCHITECTURE.md).
- Custom adapters: [docs/EXTENDING.md](./docs/EXTENDING.md).

### 2. CLI / TUI Usage
Store, restore, and manage assets from the terminal.
- Jump to [CLI Reference](#cli-reference).
- Interactive explorer: `git-cas vault dashboard`.

### 3. Agentic Automation
Machine-facing agent CLI for structured CI/CD or agentic workflows.
- [docs/API.md](./docs/API.md) for the agent command surface.
- Run: `git-cas agent <command>`.

### 4. Contributing
- Read `METHOD.md` and `BEARING.md` for project process.
- See [Architecture](#architecture) for orientation.

---

## Feature Coverage Map

This guide and [ADVANCED_GUIDE.md](./ADVANCED_GUIDE.md) are the complete
feature coverage pair. The quick path lives here; implementation mechanics,
limits, and port contracts live in the advanced guide.

| Feature Area | Covered Here | Advanced Coverage |
|---|---|---|
| Facade lifecycle, JSON/CBOR factories, full constructor | [Library Quick Start](#library-quick-start), [Configuration Reference](#configuration-reference) | [Direct CasService and Custom Port Contracts](./ADVANCED_GUIDE.md#direct-casservice-and-custom-port-contracts) |
| Direct `CasService` construction | [Configuration Reference](#configuration-reference) notes the facade/direct split | [Direct CasService and Custom Port Contracts](./ADVANCED_GUIDE.md#direct-casservice-and-custom-port-contracts) |
| File, stream, tree, vault-safe store workflows | [Store Operations](#store-operations), [Vault Management](#vault-management) | [Store/Restore Pipeline](./docs/STORE_RESTORE_PIPELINE.md), [Manifest Integrity Hash](./ADVANCED_GUIDE.md#manifest-integrity-hash), [Merkle Manifests](./ADVANCED_GUIDE.md#merkle-manifests) |
| Restore modes and bounded memory behavior | [Restore Modes](#restore-modes) | [Store/Restore Pipeline](./docs/STORE_RESTORE_PIPELINE.md), [Parallel Chunk Restore](./ADVANCED_GUIDE.md#parallel-chunk-restore), [Streaming Decompression](./ADVANCED_GUIDE.md#streaming-decompression) |
| Fixed chunking, CDC, FastCDC normalization | [Chunking](#chunking) | [Content-Defined Chunking (CDC)](./ADVANCED_GUIDE.md#content-defined-chunking-cdc) |
| Encryption schemes and legacy migration | [Encryption](#encryption), [Migrating Legacy Encryption Schemes](#migrating-legacy-encryption-schemes) | [Encryption Schemes](./ADVANCED_GUIDE.md#encryption-schemes), [Convergent Encryption](./ADVANCED_GUIDE.md#convergent-encryption) |
| Passphrases, PBKDF2, scrypt, KDF policy | [Passphrase-Based Encryption](#passphrase-based-encryption) | [KDF Policy](./ADVANCED_GUIDE.md#kdf-policy) |
| Multi-recipient envelope encryption and key rotation | [Multi-Recipient (Envelope) Encryption](#multi-recipient-envelope-encryption), [Key and Recipient Management](#key-and-recipient-management) | [Envelope Encryption](./ADVANCED_GUIDE.md#envelope-encryption) |
| Vault init/list/resolve/remove, metadata, rotation, privacy mode | [Vault Management](#vault-management), [Vault Privacy Mode](#vault-privacy-mode) | [Vault Privacy Mode](./ADVANCED_GUIDE.md#vault-privacy-mode) |
| Compression and custom adapters | [Compression](#compression) | [CompressionPort Architecture](./ADVANCED_GUIDE.md#compressionport-architecture) |
| Manifest versions, format version, integrity hash, diffing | [Manifest Features](#manifest-features), [Manifest Diffing](#manifest-diffing) | [Format Version](./ADVANCED_GUIDE.md#format-version), [Manifest Integrity Hash](./ADVANCED_GUIDE.md#manifest-integrity-hash), [Manifest Diffing](./ADVANCED_GUIDE.md#manifest-diffing) |
| Inspection, verification, referenced chunk analysis, deprecated aliases | [Manifest Features](#manifest-features), [Inspection and Verification](#inspection-and-verification) | [Security Hardening Summary](./ADVANCED_GUIDE.md#security-hardening-summary) |
| Human CLI, TUI dashboard, agent CLI | [CLI Reference](#cli-reference) | [Operational Tooling](./ADVANCED_GUIDE.md#operational-tooling) |
| Runtime support, ports, custom adapters, resilience policy | [Architecture](#architecture) | [Direct CasService and Custom Port Contracts](./ADVANCED_GUIDE.md#direct-casservice-and-custom-port-contracts), [Configuration Reference](./ADVANCED_GUIDE.md#configuration-reference) |
| Release verification, migration, build stamping | [Migrating Legacy Encryption Schemes](#migrating-legacy-encryption-schemes) | [Operational Tooling](./ADVANCED_GUIDE.md#operational-tooling) |

---

## Library Quick Start

A complete init-store-tree-restore cycle:

```js
import ContentAddressableStore from '@git-stunts/git-cas';

// 1. Initialize
const cas = await ContentAddressableStore.open({ cwd: '/path/to/repo' });

// 2. Store a file
const manifest = await cas.storeFile({
  filePath: './photo.jpg',
  slug: 'photos/vacation',
});

// 3. Create a Git tree (persists the manifest + chunks as a tree object)
const treeOid = await cas.createTree({ manifest });

// 4. Add to the vault index (GC-safe ref)
await cas.addToVault({ slug: 'photos/vacation', treeOid });

// 5. Restore later
const readBack = await cas.readManifest({ treeOid });
const { buffer } = await cas.restore({ manifest: readBack });
```

### Factory Methods

| Factory | Codec | Use Case |
|---|---|---|
| `await ContentAddressableStore.open({ cwd })` | JSON | Shortest normal application setup |
| `ContentAddressableStore.createJson({ plumbing })` | JSON | Human-readable manifests, debugging |
| `ContentAddressableStore.createCbor({ plumbing })` | CBOR | Compact binary manifests, production |

`open()` is async and accepts `cwd` plus the same facade options as the
constructor except `plumbing`. Use `createJson()` or `createCbor()` when you
already have a custom Git plumbing instance. Both explicit-plumbing factories
accept the same facade options as the constructor except `codec`, which is fixed
by the factory name.

### Full Constructor

For complete control, use the constructor directly:

```js
import ContentAddressableStore, {
  CborCodec,
  EventEmitterObserver,
  CdcChunker,
  NodeCompressionAdapter,
} from '@git-stunts/git-cas';

const cas = new ContentAddressableStore({
  plumbing,
  chunkSize: 128 * 1024,          // 128 KiB chunks
  codec: new CborCodec(),
  observability: new EventEmitterObserver(),
  merkleThreshold: 500,            // Merkle sub-manifests above 500 chunks
  concurrency: 4,                  // Parallel chunk I/O
  maxRestoreBufferSize: 256 * 1024 * 1024,  // 256 MiB buffer limit
  compressionAdapter: new NodeCompressionAdapter(),
  chunking: {                      // CDC chunking
    strategy: 'cdc',
    targetChunkSize: 64 * 1024,
    minChunkSize: 16 * 1024,
    maxChunkSize: 256 * 1024,
  },
});
```

---

## Store Operations

### `store({ source, slug, filename })`

Stores data from any async iterable:

```js
async function* generateData() {
  yield new TextEncoder().encode('chunk one');
  yield new TextEncoder().encode('chunk two');
}

const manifest = await cas.store({
  source: generateData(),
  slug: 'data/stream-example',
  filename: 'output.bin',
});
```

### `storeFile({ filePath, slug })`

Convenience method that reads a file from disk:

```js
const manifest = await cas.storeFile({
  filePath: '/absolute/path/to/archive.tar.gz',
  slug: 'backups/2026-04-23',
});
```

The filename defaults to the basename of `filePath`. Override it with the optional `filename` parameter.

---

## Encryption

All store and restore methods accept encryption options. Encryption is AES-256-GCM.

### Encryption Schemes

| Scheme | Description | Default When |
|---|---|---|
| `convergent` | Per-chunk encryption keyed by content hash; preserves CDC deduplication across encrypted stores | CDC chunking + encryption |
| `framed` | Streaming framed encryption with per-frame AAD binding to slug | Non-CDC encrypted stores |
| `whole` | Whole-object encryption with AAD binding to slug | Explicit only |

AAD (Additional Authenticated Data) is always on for `whole` and `framed` schemes, binding ciphertext to the asset slug.

**Convergent encryption** is the default when CDC chunking is active and an encryption key is provided. It encrypts each chunk independently using a key derived from the chunk content, so identical plaintext chunks produce identical ciphertext -- preserving deduplication. For non-CDC stores, the default is `framed`.

#### Legacy Schemes

The v1/v2 scheme identifiers (`whole-v1`, `whole-v2`, `framed-v1`, `framed-v2`, `convergent-v1`) are no longer supported. Attempting to restore a manifest with a legacy scheme throws a `LEGACY_SCHEME` error. Run `scripts/migrate-encryption.js` to upgrade old manifests to current scheme names. See [Migration](#migrating-legacy-encryption-schemes) below.

### Raw Key Encryption

```js
import { randomBytes } from 'node:crypto';

const key = randomBytes(32); // 32-byte AES-256 key

// Store encrypted
const manifest = await cas.storeFile({
  filePath: './secret.pdf',
  slug: 'docs/secret',
  encryptionKey: key,
});

// Restore encrypted
const treeOid = await cas.createTree({ manifest });
const readBack = await cas.readManifest({ treeOid });
const { buffer } = await cas.restore({
  manifest: readBack,
  encryptionKey: key,
});
```

### Passphrase-Based Encryption

Derives a key using PBKDF2 (default) or scrypt:

PBKDF2 works across Node, Bun, and Deno/Web Crypto. scrypt requires a Node/Bun
crypto adapter; Web Crypto runtimes report a capability error for scrypt.

```js
// Store with passphrase (PBKDF2)
const pbkdf2Manifest = await cas.storeFile({
  filePath: './secret.pdf',
  slug: 'docs/secret',
  passphrase: 'my-strong-passphrase',
});

// Store with scrypt
const scryptManifest = await cas.storeFile({
  filePath: './secret.pdf',
  slug: 'docs/secret',
  passphrase: 'my-strong-passphrase',
  kdfOptions: { algorithm: 'scrypt' },
});

// Restore with passphrase
const readBack = await cas.readManifest({ treeOid });
const { buffer } = await cas.restore({
  manifest: readBack,
  passphrase: 'my-strong-passphrase',
});
```

### Multi-Recipient (Envelope) Encryption

Envelope encryption wraps a random DEK with each recipient's KEK. Adding or removing recipients never re-encrypts the data.

```js
import { randomBytes } from 'node:crypto';

const aliceKey = randomBytes(32);
const bobKey = randomBytes(32);

// Store with recipients
const manifest = await cas.storeFile({
  filePath: './shared-doc.pdf',
  slug: 'team/shared-doc',
  recipients: [
    { label: 'alice', key: aliceKey },
    { label: 'bob', key: bobKey },
  ],
});

// Restore using any recipient's key
const readBack = await cas.readManifest({ treeOid });
const { buffer } = await cas.restore({
  manifest: readBack,
  encryptionKey: aliceKey,
});

// Add a recipient
const updated = await cas.addRecipient({
  manifest: readBack,
  existingKey: aliceKey,       // Any current recipient's key
  newRecipientKey: carolKey,
  label: 'carol',
});

// Remove a recipient
const shrunk = await cas.removeRecipient({
  manifest: updated,
  label: 'bob',
});

// List recipients
const labels = await cas.listRecipients(readBack);
// => ['alice', 'bob']

// Rotate a recipient's key (no data re-encryption)
const rotated = await cas.rotateKey({
  manifest: readBack,
  oldKey: aliceKey,
  newKey: aliceNewKey,
  label: 'alice',              // Optional: target a specific recipient
});
```

### Explicit Scheme Selection

Override the default scheme:

```js
// Force framed encryption (even with CDC chunking)
const framedManifest = await cas.storeFile({
  filePath: './large-video.mp4',
  slug: 'media/video',
  encryptionKey: key,
  encryption: {
    scheme: 'framed',          // 'whole', 'framed', or 'convergent'
    frameBytes: 128 * 1024,    // 128 KiB frames (framed scheme only)
  },
});

// Force whole-object encryption
const wholeManifest = await cas.storeFile({
  filePath: './small-config.json',
  slug: 'config/app',
  encryptionKey: key,
  encryption: { scheme: 'whole' },
});
```

### Migrating Legacy Encryption Schemes

Manifests created with earlier versions may use v1/v2 scheme identifiers (`whole-v1`, `whole-v2`, `framed-v1`, `framed-v2`, `convergent-v1`). These are no longer supported in the main codebase. The migration script decrypts using the legacy logic and re-stores using current scheme names with AAD always on.

```sh
node scripts/migrate-encryption.js
printf '%s\n' 'my-secret' | node scripts/migrate-encryption.js --execute --passphrase-file -
node scripts/migrate-encryption.js --execute --key-file ./asset.key
```

The migration script handles both fast (rename-only for v2 schemes) and full (re-encryption with AAD for v1 schemes) migration paths. Full migration accepts `--passphrase-file`, `--key-file`, or inline `--passphrase` for compatibility; inline passphrases print a warning because they can leak through shell history and process listings. For privacy-enabled vaults, add `--vault-passphrase-file` or `--vault-key-file` when the vault passphrase differs from the content passphrase. The inline `--vault-passphrase` fallback is still accepted with the same warning. The main `src/` codebase throws `LEGACY_SCHEME` if it encounters a v1/v2 identifier.

---

## Chunking

Content is split into chunks before storage. Two strategies are available:

### Fixed Chunking (Default)

Splits data into equal-sized chunks. Simple and predictable.

```js
const cas = ContentAddressableStore.createJson({
  plumbing,
  chunkSize: 512 * 1024,   // 512 KiB chunks
});
```

### Content-Defined Chunking (CDC)

Uses a rolling hash to find chunk boundaries based on content. Provides deduplication across similar files.

```js
const cas = new ContentAddressableStore({
  plumbing,
  chunking: {
    strategy: 'cdc',
    targetChunkSize: 64 * 1024,    // 64 KiB target
    minChunkSize: 16 * 1024,       // 16 KiB minimum
    maxChunkSize: 256 * 1024,      // 256 KiB maximum
  },
});
```

CDC parameters:

| Parameter | Description |
|---|---|
| `targetChunkSize` | Average chunk size the rolling hash targets |
| `minChunkSize` | Minimum chunk size (never split smaller) |
| `maxChunkSize` | Maximum chunk size (force split at this boundary) |

> **Note**: CDC deduplication is ineffective with standard encryption (`whole` or `framed`), since ciphertext is pseudorandom. Use the `convergent` scheme (the default for CDC + encryption) to preserve deduplication.

---

## Compression

Enable gzip compression to reduce storage size. Compression runs before encryption (compress-then-encrypt). Plaintext and gzip-compressed content both stream during store and restore, so memory usage stays low regardless of file size.

### Library

```js
const manifest = await cas.storeFile({
  filePath: './large-log.txt',
  slug: 'logs/2026-04-23',
  compression: { algorithm: 'gzip' },
});

// Decompression is automatic on restore -- the manifest records the algorithm.
const { buffer } = await cas.restore({ manifest: readBack });
```

### Custom Compression Adapter

Implement the `CompressionPort` interface to use a different algorithm:

```js
import { CompressionPort } from '@git-stunts/git-cas';

class BrotliAdapter extends CompressionPort {
  async compressBuffer(buffer) { /* ... */ }
  async decompressBuffer(buffer) { /* ... */ }
  async *compressStream(source) { /* ... */ }
  async *decompressStream(source) { /* ... */ }
}

const cas = new ContentAddressableStore({
  plumbing,
  compressionAdapter: new BrotliAdapter(),
});
```

---

## Manifest Diffing

Compare two manifests to find added, removed, and unchanged chunks. This is a pure function with no I/O -- useful for incremental backup, sync, and deduplication analysis.

### Library

```js
// Static method (requires class, not an instance)
import CasService from '@git-stunts/git-cas/service';
const serviceDiff = CasService.diffManifests(oldManifest, newManifest);

// Standalone function
import { diffManifests } from '@git-stunts/git-cas';
const standaloneDiff = diffManifests(oldManifest, newManifest);

console.log(standaloneDiff.summary);
// => {
//   addedCount: 3, removedCount: 1, unchangedCount: 42,
//   addedBytes: 196608, removedBytes: 65536, unchangedBytes: 2752512,
// }
console.log(standaloneDiff.added);     // Chunk[] -- new chunks in newManifest
console.log(standaloneDiff.removed);   // Chunk[] -- chunks only in oldManifest
console.log(standaloneDiff.unchanged); // Chunk[] -- chunks in both (by digest)
```

---

## Vault Management

The vault is a GC-safe index backed by `refs/cas/vault`. It maps slugs to Git tree OIDs, ensuring stored assets are reachable by Git and not garbage-collected.

### Initialize the Vault

```js
// Plain vault (no encryption)
await cas.initVault();

// Encrypted vault with passphrase
await cas.initVault({
  passphrase: 'vault-secret',
  kdfOptions: { algorithm: 'pbkdf2' },  // or 'scrypt'
});

// Encrypted vault with privacy mode
await cas.initVault({
  passphrase: 'vault-secret',
  kdfOptions: { algorithm: 'pbkdf2' },
  privacy: true,
});
```

### Add, List, Resolve, Remove

```js
// Add an entry
await cas.addToVault({ slug: 'photos/vacation', treeOid });

// Overwrite an existing entry
await cas.addToVault({ slug: 'photos/vacation', treeOid: newTreeOid, force: true });

// List all entries
const entries = await cas.listVault();
// => [{ slug: 'photos/vacation', treeOid: 'abc123...' }, ...]

// Resolve a single slug to its tree OID
const oid = await cas.resolveVaultEntry({ slug: 'photos/vacation' });

// Remove an entry
const { commitOid, removedTreeOid } = await cas.removeFromVault({
  slug: 'photos/vacation',
});
```

### Rotate Vault Passphrase

Re-wraps every envelope-encrypted entry's DEK with a new key derived from `newPassphrase`. Entries using direct-key encryption are skipped.

```js
const { commitOid, rotatedSlugs, skippedSlugs } = await cas.rotateVaultPassphrase({
  oldPassphrase: 'old-secret',
  newPassphrase: 'new-secret',
  kdfOptions: { algorithm: 'scrypt' },  // optional: change KDF algorithm
});
```

### Get Vault Metadata

```js
const metadata = await cas.getVaultMetadata();
// => { version: 1, encryption: { cipher: 'aes-256-gcm', kdf: { ... }, verifier: { ... } } }
```

Encrypted v6 vaults include a verifier in `.vault.json`, so tools can reject a
wrong passphrase even before the vault contains entries. Normal CLI and facade
flows verify derived vault keys automatically. Custom tools that derive vault
keys themselves should call `verifyVaultKey({ encryptionKey })` before using the
key.

---

## Vault Privacy Mode

When privacy mode is enabled, vault entry names are stored as HMAC hashes instead of plaintext slugs. This prevents an attacker who has access to the Git object database from learning what assets are stored, even without the encryption key.

### Enabling Privacy Mode

Privacy mode requires vault-level encryption. Enable it at vault initialization:

```js
await cas.initVault({
  passphrase: 'vault-secret',
  kdfOptions: { algorithm: 'pbkdf2' },
  privacy: true,
});
```

### Limitations

- Privacy mode cannot be enabled on an existing vault -- it must be set at init time.
- All vault read operations that need to resolve slugs require the encryption key, since the slug-to-HMAC mapping is itself encrypted.
- Privacy mode adds overhead: an encrypted `.privacy-index` blob is maintained alongside the vault tree.

---

## Manifest Features

### Manifest Versions and Format Version

Manifests are versioned value objects that describe a stored asset:

- **v1**: Flat chunk list with SHA-256 integrity hashes.
- **v2**: Merkle sub-manifest support for large files. Activated when chunk count exceeds `merkleThreshold` (default 1000).

Each manifest also carries an optional `formatVersion` field -- a semver string (e.g. `"6.0.0"`) stamped by the library version that created it. This enables forward-compatible tooling to detect which features a manifest may use.

### Reading a Manifest

```js
const manifest = await cas.readManifest({ treeOid });

console.log(manifest.slug);          // 'photos/vacation'
console.log(manifest.filename);      // 'photo.jpg'
console.log(manifest.size);          // total bytes
console.log(manifest.chunks.length); // number of chunks
console.log(manifest.encryption);    // encryption metadata or undefined
console.log(manifest.compression);   // compression metadata or undefined
console.log(manifest.formatVersion); // '6.0.0' or undefined (older manifests)
```

### Inspecting an Asset

Returns metadata without performing a full restore:

```js
const info = await cas.inspectAsset({ treeOid });
// => { slug: 'photos/vacation', chunksOrphaned: 4 }
```

### Integrity Verification

Verifies every chunk's SHA-256 hash against the manifest:

```js
const ok = await cas.verifyIntegrity(manifest);
if (!ok) {
  console.error('Integrity check failed -- data may be corrupted');
}
```

---

## Restore Modes

Three restore modes serve different use cases. When `concurrency` is greater than 1, chunk reads are parallelized for faster restore.

### `restore({ manifest })` -- Buffered to Memory

Returns the entire file as a single buffer. Best for small-to-medium files.

```js
const manifest = await cas.readManifest({ treeOid });
const { buffer, bytesWritten } = await cas.restore({ manifest });
```

Encrypted content requires a key:

```js
const { buffer } = await cas.restore({
  manifest,
  encryptionKey: key,
  // or: passphrase: 'secret',
});
```

The `maxRestoreBufferSize` option (default 512 MiB) guards against out-of-memory errors.

### `restoreFile({ manifest, outputPath })` -- Atomic File Write

Writes directly to disk. Handles streaming internally for framed-encrypted and compressed content.

```js
const manifest = await cas.readManifest({ treeOid });
const { bytesWritten } = await cas.restoreFile({
  manifest,
  outputPath: '/tmp/restored-photo.jpg',
  encryptionKey: key,  // if encrypted
});
```

### `restoreStream({ manifest })` -- Async Iterable

Returns an async iterable of `Uint8Array` chunks. Best for large files, piping to other streams, or memory-constrained environments.

```js
const manifest = await cas.readManifest({ treeOid });

for await (const chunk of cas.restoreStream({ manifest, encryptionKey: key })) {
  process.stdout.write(chunk);
}
```

### When to Use Each

| Mode | Memory | Streaming | Use Case |
|---|---|---|---|
| `restore` | Full file in RAM | No | Small files, in-memory processing |
| `restoreFile` | Low | Yes (internal) | Disk targets, atomic writes |
| `restoreStream` | Low | Yes (external) | Pipes, HTTP responses, large files |

---

## CLI Reference

All commands support `--json` for machine-readable output and `--quiet` to suppress progress.

### Store and Restore

| Command | Description |
|---|---|
| `git-cas store <file> --slug <slug>` | Store a file into Git CAS |
| `git-cas restore --out <path> --slug <slug>` | Restore a file from vault slug |
| `git-cas restore --out <path> --oid <tree-oid>` | Restore a file from tree OID |

**Store flags:**

| Flag | Description |
|---|---|
| `--slug <slug>` | Asset slug identifier (required) |
| `--tree` | Create Git tree and add to vault |
| `--force` | Overwrite existing vault entry (requires `--tree`) |
| `--key-file <path>` | Path to 32-byte raw encryption key file |
| `--recipient <label:keyfile>` | Envelope recipient (repeatable) |
| `--vault-passphrase <pass>` | Inline vault passphrase (accepted with warning; prefer `--vault-passphrase-file -`, `GIT_CAS_PASSPHRASE`, or `--os-keychain-target`) |
| `--vault-passphrase-file <path>` | Read passphrase from file (`-` for stdin) |
| `--os-keychain-target <target>` | Read passphrase from OS keychain via `@git-stunts/vault` |
| `--os-keychain-account <account>` | Keychain account namespace (default: `git-cas`) |
| `--gzip` | Enable gzip compression |
| `--strategy <fixed\|cdc>` | Chunking strategy |
| `--chunk-size <n>` | Chunk size in bytes |
| `--target-chunk-size <n>` | CDC target chunk size |
| `--min-chunk-size <n>` | CDC minimum chunk size |
| `--max-chunk-size <n>` | CDC maximum chunk size |
| `--concurrency <n>` | Parallel chunk I/O operations |
| `--codec <json\|cbor>` | Manifest codec |
| `--merkle-threshold <n>` | Chunk count for Merkle sub-manifests |
| `--cwd <dir>` | Git working directory (default: `.`) |

**Restore flags:**

| Flag | Description |
|---|---|
| `--out <path>` | Output file path (required) |
| `--slug <slug>` | Resolve tree OID from vault slug |
| `--oid <tree-oid>` | Direct tree OID |
| `--key-file <path>` | Encryption key file |
| `--vault-passphrase <pass>` | Inline vault passphrase (accepted with warning; prefer file/stdin, env, or keychain sources) |
| `--vault-passphrase-file <path>` | Read passphrase from file (`-` for stdin) |
| `--os-keychain-target <target>` | OS keychain passphrase source |
| `--os-keychain-account <account>` | Keychain account namespace |
| `--concurrency <n>` | Parallel chunk I/O |
| `--max-restore-buffer <n>` | Max buffered restore size in bytes |
| `--cwd <dir>` | Git working directory |

### Vault Commands

| Command | Description |
|---|---|
| `git-cas vault init` | Initialize the vault |
| `git-cas vault list` | List all vault entries |
| `git-cas vault remove <slug>` | Remove a vault entry |
| `git-cas vault info <slug>` | Show info for a vault entry |
| `git-cas vault stats` | Vault size, dedup, encryption summary |
| `git-cas vault history` | Show vault commit history |
| `git-cas vault rotate` | Rotate vault passphrase |
| `git-cas vault dashboard` | Interactive TUI explorer |

**Vault init flags:**

| Flag | Description |
|---|---|
| `--vault-passphrase <pass>` | Enable encrypted vault from an inline passphrase (accepted with warning) |
| `--vault-passphrase-file <path>` | Read passphrase from file (`-` for stdin) |
| `--os-keychain-target <target>` | OS keychain passphrase source |
| `--algorithm <pbkdf2\|scrypt>` | KDF algorithm |

**Vault rotate flags:**

| Flag | Description |
|---|---|
| `--old-passphrase <pass>` | Current inline vault passphrase (accepted with warning) |
| `--new-passphrase <pass>` | New inline vault passphrase (accepted with warning) |
| `--old-passphrase-file <path>` | Read old passphrase from file (`-` for stdin) |
| `--new-passphrase-file <path>` | Read new passphrase from file (`-` for stdin) |
| `--algorithm <pbkdf2\|scrypt>` | KDF algorithm for new passphrase |

### Inspection and Verification

| Command | Description |
|---|---|
| `git-cas inspect --slug <slug>` | Inspect manifest (human-readable or JSON) |
| `git-cas inspect --oid <tree-oid> --heatmap` | Chunk size heatmap visualization |
| `git-cas verify --slug <slug>` | Verify chunk-level SHA-256 integrity |
| `git-cas doctor` | Vault health report |
| `git-cas tree --manifest <path>` | Create Git tree from manifest JSON file |

### Key and Recipient Management

| Command | Description |
|---|---|
| `git-cas rotate --slug <slug> --old-key-file <path> --new-key-file <path>` | Rotate encryption key |
| `git-cas recipient add <slug> --label <label> --key-file <path> --existing-key-file <path>` | Add recipient |
| `git-cas recipient remove <slug> --label <label>` | Remove recipient |
| `git-cas recipient list <slug>` | List recipients |

### Agent CLI

Machine-facing commands for CI/CD and agentic workflows. The agent CLI returns newline-delimited protocol events on stdout and exits with stable status codes. It accepts the same core targets and credential sources as the human CLI.

| Command | Description |
|---|---|
| `git-cas agent store <file> --slug <slug> --tree` | Store an asset and optionally vault it |
| `git-cas agent tree --manifest <path>` | Create a Git tree from manifest JSON |
| `git-cas agent restore --slug <slug> --out <path>` | Restore from a vault slug |
| `git-cas agent restore --oid <tree-oid> --out <path>` | Restore from a direct tree OID |
| `git-cas agent inspect --slug <slug>` | Return manifest JSON for a target |
| `git-cas agent verify --slug <slug>` | Verify integrity and return an agent exit code |
| `git-cas agent doctor` | Return a vault health report |
| `git-cas agent rotate --slug <slug>` | Rotate a recipient/key wrapper |
| `git-cas agent recipient add <slug>` | Add an envelope recipient |
| `git-cas agent recipient remove <slug>` | Remove an envelope recipient |
| `git-cas agent recipient list <slug>` | List envelope recipients |
| `git-cas agent vault init` | Initialize the vault |
| `git-cas agent vault list` | List vault entries |
| `git-cas agent vault info <slug>` | Inspect a vault entry |
| `git-cas agent vault history` | Return vault history |
| `git-cas agent vault remove <slug>` | Remove a vault entry |
| `git-cas agent vault rotate` | Rotate the vault passphrase |
| `git-cas agent vault stats` | Return vault size/dedupe/encryption stats |

Use `--request <json>` or stdin JSON for structured request payloads where a workflow needs machine-built inputs. See [docs/API.md](./docs/API.md) for the detailed protocol fields and response schemas.

---

## Configuration Reference

### Constructor Options

This table describes the high-level `ContentAddressableStore` facade. The facade supplies `FixedChunker`, `NodeCompressionAdapter`, runtime crypto, and the package `formatVersion` automatically when those options are omitted. If you construct `CasService` directly, `chunker` and `compressionAdapter` are required injections; see [ADVANCED_GUIDE.md](./ADVANCED_GUIDE.md#direct-casservice-and-custom-port-contracts).

| Option | Type | Default | Description |
|---|---|---|---|
| `plumbing` | `GitPlumbing` | (required) | `@git-stunts/plumbing` instance |
| `chunkSize` | `number` | `262144` (256 KiB) | Chunk size in bytes (min 1024, max 100 MiB) |
| `codec` | `CodecPort` | `JsonCodec` | Manifest serialization codec |
| `crypto` | `CryptoPort` | Auto-detected | Crypto adapter (Node or WebCrypto) |
| `observability` | `ObservabilityPort` | `SilentObserver` | Metrics, logs, spans |
| `policy` | `Policy` | None | `@git-stunts/alfred` resilience policy |
| `merkleThreshold` | `number` | `1000` | Chunk count above which Merkle sub-manifests are used |
| `concurrency` | `number` | `1` | Parallel chunk I/O operations (max 64); values > 1 enable parallel chunk restore |
| `chunking` | `object` | None | Chunking strategy config (see below) |
| `chunker` | `ChunkingPort` | `FixedChunker` | Pre-built chunker instance (advanced) |
| `maxRestoreBufferSize` | `number` | `536870912` (512 MiB) | Max bytes for buffered restore |
| `compressionAdapter` | `CompressionPort` | `NodeCompressionAdapter` | Compression adapter |
| `formatVersion` | `string` | Package version | Semver string stamped into new manifests by the facade. Directly configurable only on `CasService`. |

### Encryption Options (Store)

| Key | Type | Default | Description |
|---|---|---|---|
| `scheme` | `'whole' \| 'framed' \| 'convergent'` | `convergent` (CDC) / `framed` (fixed) | Encryption scheme |
| `frameBytes` | `number` | `65536` (64 KiB) | Frame size for `framed` scheme (max 64 MiB) |
| `convergent` | `boolean` | Auto | Explicit convergent opt-in/opt-out when no `scheme` is provided |

### Chunking Config Object

| Key | Type | Description |
|---|---|---|
| `strategy` | `'fixed' \| 'cdc'` | Chunking strategy |
| `chunkSize` | `number` | Fixed chunk size (fixed strategy only) |
| `targetChunkSize` | `number` | CDC target chunk size |
| `minChunkSize` | `number` | CDC minimum chunk size |
| `maxChunkSize` | `number` | CDC maximum chunk size |

### `.casrc` Project Config

Place a `.casrc` JSON file at your repository root to set defaults. CLI flags always override `.casrc` values.

```json
{
  "chunkSize": 131072,
  "strategy": "cdc",
  "concurrency": 4,
  "codec": "cbor",
  "compression": "gzip",
  "merkleThreshold": 500,
  "maxRestoreBufferSize": 268435456,
  "cdc": {
    "targetChunkSize": 65536,
    "minChunkSize": 16384,
    "maxChunkSize": 262144
  }
}
```

### Environment Variables

| Variable | Description |
|---|---|
| `GIT_CAS_PASSPHRASE` | Vault passphrase (preferred over `--vault-passphrase` flag) |

---

## Architecture

`git-cas` follows hexagonal architecture with four tiers:

1. **Facade** (`index.js`) -- Public entry point. Manages lazy initialization and adaptive crypto.
2. **CasService** (`src/domain/services/CasService.js`) -- Lean domain
   facade. Selects store/restore strategies, coordinates injected ports, and
   delegates byte-level work to domain services and strategy entities.
3. **VaultService** (`src/domain/services/VaultService.js`) -- Vault index. GC-safe ref-based asset reachability.
4. **Ports** -- Pure interfaces isolating the domain from I/O: `GitPersistencePort`, `CryptoPort`, `ChunkingPort`, `CompressionPort`, `ObservabilityPort`.

Adapters implement ports for specific runtimes: `GitPersistenceAdapter` (shells out to `git` via `@git-stunts/plumbing`), `NodeCryptoAdapter`, `NodeCompressionAdapter`, etc.

For the full architecture breakdown, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

**Tests are the spec. Every feature is defined by its tests.**
