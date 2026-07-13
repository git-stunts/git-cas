# API Reference

This document provides the complete API reference for git-cas.

For cryptographic design, nonce and KDF guidance, and security-relevant
implementation details, see [SECURITY.md](../SECURITY.md). For attacker models,
trust boundaries, exposed metadata, and explicit non-goals, see
[docs/THREAT_MODEL.md](./THREAT_MODEL.md).

All public byte-oriented APIs use `Uint8Array`. Node callers can still pass
`Buffer` instances because `Buffer` extends `Uint8Array`, but portable code
should treat restored data, chunker output, codec output, and keys as
`Uint8Array`.

## Table of Contents

1. [ContentAddressableStore](#contentaddressablestore)
2. [Application Storage](#application-storage)
3. [Root Sets](#root-sets)
4. [Cache Sets](#cache-sets)
5. [Expiring Sets](#expiring-sets)
6. [Repository Diagnostics](#repository-diagnostics)
7. [Vault](#vault)
8. [CasService](#casservice)
9. [Events](#events)
10. [Value Objects](#value-objects)
11. [Ports](#ports)
12. [Codecs](#codecs)
13. [Error Codes](#error-codes)

## ContentAddressableStore

The main facade class providing high-level API for content-addressable storage.

### open

```javascript
await ContentAddressableStore.open({ cwd, chunkSize, policy });
```

Creates the default JSON-codec facade from a Git working directory. This is the
recommended entry point for normal application code.

**Parameters:**

- `cwd` (optional): Git working directory (default: `"."`)
- `chunkSize` (optional): Chunk size in bytes
- `policy` (optional): Resilience policy
- Any other `ContentAddressableStore` constructor option except `plumbing`

**Returns:** `Promise<ContentAddressableStore>`

**Example:**

```javascript
import ContentAddressableStore from '@git-stunts/git-cas';

const cas = await ContentAddressableStore.open({ cwd: '/path/to/repo' });
```

### Constructor

```javascript
new ContentAddressableStore(options);
```

**Parameters:**

- `options.plumbing` (required): Plumbing instance from `@git-stunts/plumbing`
- `options.chunkSize` (optional): Chunk size in bytes (default: 262144 / 256 KiB)
- `options.codec` (optional): CodecPort implementation (default: JsonCodec)
- `options.crypto` (optional): CryptoPort implementation (default: auto-detected)
- `options.observability` (optional): ObservabilityPort implementation (default: SilentObserver)
- `options.policy` (optional): Resilience policy from `@git-stunts/alfred` for Git I/O
- `options.merkleThreshold` (optional): Chunk count threshold for Merkle manifests (default: 1000)
- `options.concurrency` (optional): Maximum parallel chunk I/O operations (default: 1)
- `options.chunking` (optional): Declarative chunking strategy config `{ strategy: 'fixed'|'cdc', chunkSize?, targetChunkSize?, minChunkSize?, maxChunkSize? }`
- `options.chunker` (optional): Pre-built ChunkingPort instance (advanced; overrides `chunking`)
- `options.maxRestoreBufferSize` (optional): Max bytes for buffered encrypted/compressed restore (default: 536870912 / 512 MiB)
- `options.maxBlobSize` (optional): Max bytes for metadata blob reads (default: 10485760 / 10 MiB)
- `options.maxPageSize` (optional): Maximum immutable page bytes (default: 16777216 / 16 MiB)
- `options.bundleLimits` (optional): Repository maximums for bundle members, path bytes, descriptor bytes, fanout entries, and fanout depth
- `options.maxBundleNestingDepth` (optional): Maximum nested bundle depth (default: 32)
- `options.compressionAdapter` (optional): CompressionPort implementation (default: NodeCompressionAdapter)
- `options.applicationRefPrefixes` (optional): Explicit application-owned ref prefixes allowed for generic publication; publication is disabled when omitted, and Git/CAS-managed namespaces are always reserved
- `options.clock` (optional): `{ now(): Date }` clock used for deterministic staged results and retention witnesses

**Example:**

```javascript
import ContentAddressableStore from '@git-stunts/git-cas';
import GitPlumbing from '@git-stunts/plumbing';

const plumbing = await GitPlumbing.createDefault({ cwd: '/path/to/repo' });
const cas = new ContentAddressableStore({ plumbing });
```

### Factory Methods

Use these factories when you already have a custom Git plumbing instance.

#### createJson

```javascript
ContentAddressableStore.createJson({ plumbing, chunkSize, policy, chunking });
```

Creates a CAS instance with JSON codec.

**Parameters:**

- `plumbing` (required): Plumbing instance
- `chunkSize` (optional): Chunk size in bytes
- `policy` (optional): Resilience policy
- Any other `ContentAddressableStore` constructor option except `codec`

**Returns:** `ContentAddressableStore`

**Example:**

```javascript
const cas = ContentAddressableStore.createJson({ plumbing });
```

#### createCbor

```javascript
ContentAddressableStore.createCbor({ plumbing, chunkSize, policy, chunking });
```

Creates a CAS instance with CBOR codec.

**Parameters:**

- `plumbing` (required): Plumbing instance
- `chunkSize` (optional): Chunk size in bytes
- `policy` (optional): Resilience policy
- Any other `ContentAddressableStore` constructor option except `codec`

**Returns:** `ContentAddressableStore`

**Example:**

```javascript
const cas = ContentAddressableStore.createCbor({ plumbing });
```

### Methods

#### getService

```javascript
await cas.getService();
```

Lazily initializes and returns the underlying CasService instance.

**Returns:** `Promise<CasService>`

**Example:**

```javascript
const service = await cas.getService();
```

#### getVaultService

```javascript
await cas.getVaultService();
```

Lazily initializes and returns the underlying VaultService instance.

**Returns:** `Promise<VaultService>`

**Example:**

```javascript
const vaultService = await cas.getVaultService();
```

#### store

```javascript
await cas.store({
  source,
  slug,
  filename,
  encryptionKey,
  passphrase,
  encryption,
  kdfOptions,
  compression,
  chunking,
  recipients,
  merkleThreshold,
});
```

Stores content from an async iterable source.

**Parameters:**

- `source` (required): `AsyncIterable<Uint8Array>` - Content stream
- `slug` (required): `string` - Unique identifier for the asset
- `filename` (required): `string` - Original filename
- `encryptionKey` (optional): `Uint8Array` - 32-byte encryption key
- `passphrase` (optional): `string` - Derive encryption key from passphrase (alternative to `encryptionKey`)
- `encryption` (optional): `Object` - Explicit encryption mode selection for encrypted stores. If omitted, encrypted stores default to `convergent` for CDC chunkers and `framed` otherwise
- `encryption.scheme` (optional): `'whole' | 'framed' | 'convergent'` - `whole` is the explicit compatibility whole-object AES-GCM format; `framed` stores independently authenticated frames so restore can stream verified plaintext incrementally and is the fixed-chunk default; `convergent` derives per-chunk keys from content, enabling deduplication across encrypted stores and is the default when using CDC chunking with encryption
- `encryption.frameBytes` (optional): `number` - Plaintext bytes per framed record (default `65536`)
- `encryption.convergent` (optional): `boolean` - Explicit convergent opt-in/opt-out when `encryption.scheme` is omitted
- `kdfOptions` (optional): `Object` - KDF options when using `passphrase` (`{ algorithm, iterations, cost, ... }`). New passphrase stores default to PBKDF2 `600000` iterations or scrypt `N=131072`, and out-of-policy values fail with `KDF_POLICY_VIOLATION`
- `compression` (optional): `{ algorithm: 'gzip' }` - Enable compression before encryption/chunking
- `chunking` (optional): `{ strategy: 'fixed' | 'cdc', chunkSize?, targetChunkSize?, minChunkSize?, maxChunkSize?, normalized? }` - Per-operation chunking override. It affects only this store call; the facade's default chunker is unchanged
- `recipients` (optional): `Array<{ label: string, key: Uint8Array }>` - Envelope recipients for multi-recipient encryption (mutually exclusive with `encryptionKey`/`passphrase`)
- `merkleThreshold` (optional): `number` - Per-operation chunk count threshold used when this manifest is later published with `createTree()`

**Returns:** `Promise<Manifest>`

**Throws:**

- `CasError` with code `INVALID_KEY_TYPE` if encryptionKey is not a Uint8Array
- `CasError` with code `INVALID_KEY_LENGTH` if encryptionKey is not 32 bytes
- `CasError` with code `STREAM_ERROR` if the source stream fails
- `CasError` with code `INVALID_OPTIONS` if both `passphrase` and `encryptionKey` are provided
- `CasError` with code `INVALID_OPTIONS` if an unsupported encryption scheme is specified
- `CasError` with code `INVALID_OPTIONS` if an unsupported compression algorithm is specified

**Example:**

```javascript
import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';

const stream = createReadStream('/path/to/file.txt');
const key = randomBytes(32);
const manifest = await cas.store({
  source: stream,
  slug: 'my-asset',
  filename: 'file.txt',
  encryptionKey: key,
});
```

#### storeFile

```javascript
await cas.storeFile({
  filePath,
  slug,
  filename,
  encryptionKey,
  passphrase,
  encryption,
  kdfOptions,
  compression,
  chunking,
  recipients,
  merkleThreshold,
});
```

Convenience method that opens a file and stores it.

**Parameters:**

- `filePath` (required): `string` - Path to file
- `slug` (required): `string` - Unique identifier for the asset
- `filename` (optional): `string` - Filename (defaults to basename of filePath)
- `encryptionKey` (optional): `Uint8Array` - 32-byte encryption key
- `passphrase` (optional): `string` - Derive encryption key from passphrase
- `encryption` (optional): `Object` - Explicit encryption mode selection for encrypted stores. If omitted, encrypted stores default to `convergent` for CDC chunkers and `framed` otherwise
- `encryption.scheme` (optional): `'whole' | 'framed' | 'convergent'` - `whole` is the explicit compatibility whole-object AES-GCM format; `framed` stores independently authenticated frames so restore can stream verified plaintext incrementally and is the fixed-chunk default; `convergent` derives per-chunk keys from content, enabling deduplication across encrypted stores and is the default when using CDC chunking with encryption
- `encryption.frameBytes` (optional): `number` - Plaintext bytes per framed record (default `65536`)
- `encryption.convergent` (optional): `boolean` - Explicit convergent opt-in/opt-out when `encryption.scheme` is omitted
- `kdfOptions` (optional): `Object` - KDF options when using `passphrase`. New passphrase stores default to PBKDF2 `600000` iterations or scrypt `N=131072`, and out-of-policy values fail with `KDF_POLICY_VIOLATION`
- `compression` (optional): `{ algorithm: 'gzip' }` - Enable compression
- `chunking` (optional): `{ strategy: 'fixed' | 'cdc', chunkSize?, targetChunkSize?, minChunkSize?, maxChunkSize?, normalized? }` - Per-operation chunking override. It affects only this file store; the facade's default chunker is unchanged
- `recipients` (optional): `Array<{ label: string, key: Uint8Array }>` - Envelope recipients for multi-recipient encryption (mutually exclusive with `encryptionKey`/`passphrase`)
- `merkleThreshold` (optional): `number` - Per-operation chunk count threshold used when this manifest is later published with `createTree()`

**Returns:** `Promise<Manifest>`

**Throws:** Same as `store()`

**Example:**

```javascript
const manifest = await cas.storeFile({
  filePath: '/path/to/file.txt',
  slug: 'my-asset',
  encryptionKey: key,
  chunking: { strategy: 'cdc' },
});
```

#### restore

```javascript
await cas.restore({ manifest, encryptionKey, passphrase });
```

Restores content from a manifest and returns the buffer.

For encrypted content, `whole` still buffers the full ciphertext before
authenticating and decrypting. `framed` restores authenticated plaintext
frame-by-frame and only the final `restore()` collector buffers the result.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object
- `encryptionKey` (optional): `Uint8Array` - 32-byte encryption key (required if content is encrypted)
- `passphrase` (optional): `string` - Passphrase for KDF-based decryption (alternative to `encryptionKey`)

**Returns:** `Promise<{ buffer: Uint8Array, bytesWritten: number }>`

**Throws:**

- `CasError` with code `MISSING_KEY` if content is encrypted but no key provided
- `CasError` with code `INVALID_KEY_TYPE` if encryptionKey is not a Uint8Array
- `CasError` with code `INVALID_KEY_LENGTH` if encryptionKey is not 32 bytes
- `CasError` with code `INTEGRITY_ERROR` if chunk digest verification fails
- `CasError` with code `INTEGRITY_ERROR` if decryption fails
- `CasError` with code `INTEGRITY_ERROR` if decompression fails
- `CasError` with code `INVALID_OPTIONS` if both `passphrase` and `encryptionKey` are provided

**Example:**

```javascript
const { buffer, bytesWritten } = await cas.restore({ manifest });
```

#### restoreFile

```javascript
await cas.restoreFile({ manifest, encryptionKey, passphrase, outputPath, baseDirectory });
```

Restores content from a manifest and writes it to a file.

**Security Boundary:** `baseDirectory` is required. The `outputPath` is resolved
relative to `baseDirectory`, and the system will throw a
`SECURITY_BOUNDARY_VIOLATION` if the canonical path escapes the base directory,
including through symlinked path components.

For plaintext, `framed`, `convergent`, and uncompressed `whole`, this writes
from a streaming restore path. For `whole`, bytes are verified, streamed through
AES-GCM decryption into a temporary sibling path, and renamed into place only
after the pipeline completes successfully. This improves file restores without
changing the contract of `restoreStream()`, which remains buffered for `whole`.

For `whole` + gzip, authentication must complete before gunzip sees plaintext.
That path preserves the auth-before-decompress boundary and may buffer the
encrypted compressed payload; use `framed` or `convergent` for large compressed
encrypted assets.
On Web Crypto runtimes, the whole-object decrypt step is still internally
one-shot; the parity improvement is that this path now stays bounded by the
adapter's decryption buffer limit instead of collecting ciphertext without a
guard.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object
- `encryptionKey` (optional): `Uint8Array` - 32-byte encryption key
- `passphrase` (optional): `string` - Passphrase for KDF-based decryption
- `outputPath` (required): `string` - Path to write the restored file
- `baseDirectory` (required): `string` - Directory boundary that `outputPath` must stay inside

**Returns:** `Promise<{ bytesWritten: number }>`

**Throws:** Same as `restore()`

**Example:**

```javascript
await cas.restoreFile({
  manifest,
  outputPath: 'restored.txt',
  baseDirectory: process.cwd(),
});
```

#### createTree

```javascript
await cas.createTree({ manifest, merkleThreshold });
```

Creates a Git tree object from a manifest.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object
- `merkleThreshold` (optional): `number` - Override the constructor-level chunk count threshold for this tree publication

**Returns:** `Promise<string>` - Git tree OID

**Example:**

```javascript
const treeOid = await cas.createTree({ manifest });
```

#### verifyIntegrity

```javascript
await cas.verifyIntegrity(manifest);
```

Verifies the integrity of stored content by re-hashing all chunks. For
encrypted manifests, pass the same decryption credentials you would use for
`restore()` so the ciphertext is also authenticated. `whole` authenticates
the full ciphertext as one unit, `framed` authenticates every stored frame,
and `convergent` decrypts each chunk and verifies its plaintext digest.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object
- `options` (optional): `object`
- `options.encryptionKey` (optional): `Uint8Array` - 32-byte key for encrypted manifests
- `options.passphrase` (optional): `string` - Passphrase for KDF-based encrypted manifests

**Returns:** `Promise<boolean>` - True if all chunks pass verification

**Example:**

```javascript
const isValid = await cas.verifyIntegrity(manifest);
if (!isValid) {
  console.log('Integrity check failed');
}
```

Encrypted example:

```javascript
const isValid = await cas.verifyIntegrity(manifest, {
  encryptionKey: key,
});
```

#### readManifest

```javascript
await cas.readManifest({ treeOid });
```

Reads a Git tree, locates the manifest entry, decodes it, and returns a validated Manifest value object.

**Parameters:**

- `treeOid` (required): `string` - Git tree OID

**Returns:** `Promise<Manifest>` - Frozen, Zod-validated Manifest

**Throws:**

- `CasError` with code `MANIFEST_NOT_FOUND` if no manifest entry exists in the tree
- `CasError` with code `GIT_ERROR` if the underlying Git command fails
- Zod validation error if the manifest blob is corrupt

**Example:**

```javascript
const treeOid = 'a1b2c3d4e5f6...';
const manifest = await cas.readManifest({ treeOid });
console.log(manifest.slug); // "photos/vacation"
console.log(manifest.chunks); // array of Chunk objects
```

#### restoreStream

```javascript
const stream = cas.restoreStream({ manifest, encryptionKey, passphrase });
```

Restores content from a manifest as an async iterable of Uint8Array chunks.

For unencrypted, uncompressed files this is true per-chunk streaming with O(chunkSize) memory. `whole` encrypted paths still collect internally before yielding, while `framed` encrypted payloads authenticate and emit plaintext incrementally.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object
- `encryptionKey` (optional): `Uint8Array` - 32-byte encryption key (required if content is encrypted)
- `passphrase` (optional): `string` - Passphrase for KDF-based decryption (alternative to `encryptionKey`)

**Returns:** `AsyncIterable<Uint8Array>`

**Throws:**

- `CasError` with code `MISSING_KEY` if content is encrypted but no key provided
- `CasError` with code `INTEGRITY_ERROR` if chunk verification or decryption fails

**Example:**

```javascript
for await (const chunk of cas.restoreStream({ manifest })) {
  process.stdout.write(chunk);
}
```

#### inspectAsset

```javascript
await cas.inspectAsset({ treeOid });
```

Reads a manifest from a Git tree and returns inspection metadata. Does not perform any destructive Git operations.

**Parameters:**

- `treeOid` (required): `string` - Git tree OID of the asset

**Returns:** `Promise<{ slug: string, chunksOrphaned: number }>`

**Throws:**

- `CasError` with code `MANIFEST_NOT_FOUND` if the tree has no manifest
- `CasError` with code `GIT_ERROR` if the underlying Git command fails

**Example:**

```javascript
const { slug, chunksOrphaned } = await cas.inspectAsset({ treeOid });
console.log(`Asset "${slug}" has ${chunksOrphaned} chunks`);
```

#### diffManifests (static)

```javascript
ContentAddressableStore.diffManifests(oldManifest, newManifest);
```

Compares two manifests by chunk digest to find added, removed, and unchanged chunks. Pure function — no I/O. Does not require initialization.

**Parameters:**

- `oldManifest` (required): `Manifest` - Previous manifest
- `newManifest` (required): `Manifest` - Updated manifest

**Returns:** `ManifestDiffResult` — object with `added`, `removed`, and `unchanged` chunk arrays

**Example:**

```javascript
const diff = ContentAddressableStore.diffManifests(oldManifest, newManifest);
console.log(`Added: ${diff.added.length}, Removed: ${diff.removed.length}`);
```

#### addRecipient

```javascript
await cas.addRecipient({ manifest, existingKey, newRecipientKey, label });
```

Adds a recipient to an envelope-encrypted manifest. Unwraps the DEK using `existingKey`, then re-wraps it with `newRecipientKey` for the new recipient.

**Parameters:**

- `manifest` (required): `Manifest` - Envelope-encrypted manifest
- `existingKey` (required): `Uint8Array` - KEK of an existing recipient (used to unwrap the DEK)
- `newRecipientKey` (required): `Uint8Array` - KEK for the new recipient
- `label` (required): `string` - Label for the new recipient

**Returns:** `Promise<Manifest>` - Updated manifest with the new recipient entry

**Throws:**

- `CasError` with code `INVALID_OPTIONS` if manifest has no recipients
- `CasError` with code `RECIPIENT_ALREADY_EXISTS` if label is a duplicate
- `CasError` with code `DEK_UNWRAP_FAILED` if existingKey doesn't match any recipient

**Example:**

```javascript
const updated = await cas.addRecipient({
  manifest,
  existingKey: aliceKey,
  newRecipientKey: bobKey,
  label: 'bob',
});
```

#### removeRecipient

```javascript
await cas.removeRecipient({ manifest, label });
```

Removes a recipient from an envelope-encrypted manifest.

**Parameters:**

- `manifest` (required): `Manifest` - Envelope-encrypted manifest
- `label` (required): `string` - Label of the recipient to remove

**Returns:** `Promise<Manifest>` - Updated manifest without the removed recipient

**Throws:**

- `CasError` with code `RECIPIENT_NOT_FOUND` if label doesn't exist
- `CasError` with code `CANNOT_REMOVE_LAST_RECIPIENT` if only one recipient remains

**Example:**

```javascript
const updated = await cas.removeRecipient({ manifest, label: 'bob' });
```

#### listRecipients

```javascript
await cas.listRecipients(manifest);
```

Lists recipient labels from an envelope-encrypted manifest.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest to inspect

**Returns:** `Promise<string[]>` - Recipient labels, or empty array if not envelope-encrypted

**Example:**

```javascript
const labels = await cas.listRecipients(manifest);
console.log('Recipients:', labels.join(', '));
```

#### collectReferencedChunks

```javascript
await cas.collectReferencedChunks({ treeOids });
```

Aggregates referenced chunk blob OIDs across multiple stored assets. Analysis only — does not delete or modify anything.

**Parameters:**

- `treeOids` (required): `Array<string>` - Git tree OIDs to analyze

**Returns:** `Promise<{ referenced: Set<string>, total: number }>`

- `referenced` — deduplicated Set of all chunk blob OIDs across the given trees
- `total` — total number of chunk references (before deduplication)

**Throws:**

- `CasError` with code `MANIFEST_NOT_FOUND` if any `treeOid` lacks a manifest (fail closed)
- `CasError` with code `GIT_ERROR` if the underlying Git command fails

**Example:**

```javascript
const { referenced, total } = await cas.collectReferencedChunks({
  treeOids: [treeOid1, treeOid2, treeOid3],
});
console.log(`${referenced.size} unique blobs across ${total} total chunk references`);
```

#### deleteAsset

> **Deprecated.** Use [`inspectAsset`](#inspectasset) instead.

```javascript
await cas.deleteAsset({ treeOid });
```

Returns logical deletion metadata for an asset. Does not perform any destructive Git operations — the caller must remove refs, and physical deletion requires `git gc --prune`.

**Parameters:**

- `treeOid` (required): `string` - Git tree OID

**Returns:** `Promise<{ slug: string, chunksOrphaned: number }>`

**Throws:**

- `CasError` with code `MANIFEST_NOT_FOUND` (delegates to `readManifest`)
- `CasError` with code `GIT_ERROR` if the underlying Git command fails

**Example:**

```javascript
const { slug, chunksOrphaned } = await cas.deleteAsset({ treeOid });
console.log(`Asset "${slug}" has ${chunksOrphaned} chunks to clean up`);
// Caller must remove refs pointing to treeOid; run `git gc --prune` to reclaim space
```

#### deriveKey

```javascript
await cas.deriveKey(options);
```

Derives an encryption key from a passphrase using PBKDF2 or scrypt. PBKDF2 is
available across Node, Bun, and Web Crypto runtimes. scrypt requires a
Node/Bun-compatible crypto adapter; Web Crypto runtimes report an explicit
capability error.

**Parameters:**

- `options.passphrase` (required): `string` - The passphrase
- `options.salt` (optional): `Uint8Array` - Salt (random if omitted)
- `options.algorithm` (optional): `'pbkdf2' | 'scrypt'` - KDF algorithm (default: `'pbkdf2'`)
- `options.iterations` (optional): `number` - PBKDF2 iterations (default: 600000)
- `options.cost` (optional): `number` - scrypt cost parameter N (default: 131072)
- `options.blockSize` (optional): `number` - scrypt block size r (default: 8)
- `options.parallelization` (optional): `number` - scrypt parallelization p (default: 1)
- `options.keyLength` (optional): `number` - Derived key length (default: 32)

**Returns:** `Promise<{ key: Uint8Array, salt: Uint8Array, params: Object }>`

- `key` — the derived 32-byte encryption key
- `salt` — the salt used (save this for re-derivation)
- `params` — full KDF parameters object (stored in manifest when using `passphrase` option)

**Example:**

```javascript
const { key, salt, params } = await cas.deriveKey({
  passphrase: 'my secret passphrase',
  algorithm: 'pbkdf2',
  iterations: 600000,
});

// Use the derived key for encryption
const manifest = await cas.storeFile({
  filePath: '/path/to/file.txt',
  slug: 'my-asset',
  encryptionKey: key,
});
```

#### findOrphanedChunks

> **Deprecated.** Use [`collectReferencedChunks`](#collectreferencedchunks) instead.

```javascript
await cas.findOrphanedChunks({ treeOids });
```

Aggregates all chunk blob OIDs referenced across multiple assets and returns a report. Analysis only — does not delete or modify anything.

**Parameters:**

- `treeOids` (required): `Array<string>` - Array of Git tree OIDs

**Returns:** `Promise<{ referenced: Set<string>, total: number }>`

- `referenced` — deduplicated Set of all chunk blob OIDs across the given trees
- `total` — total number of chunk references (before deduplication)

**Throws:**

- `CasError` with code `MANIFEST_NOT_FOUND` if any `treeOid` lacks a manifest (fail closed)
- `CasError` with code `GIT_ERROR` if the underlying Git command fails

**Example:**

```javascript
const { referenced, total } = await cas.findOrphanedChunks({
  treeOids: [treeOid1, treeOid2, treeOid3],
});
console.log(`${referenced.size} unique blobs across ${total} total chunk references`);
```

#### encrypt

```javascript
await cas.encrypt({ buffer, key });
```

Encrypts a buffer using AES-256-GCM.

**Parameters:**

- `buffer` (required): `Uint8Array` - Data to encrypt
- `key` (required): `Uint8Array` - 32-byte encryption key

**Returns:** `Promise<{ buf: Uint8Array, meta: Object }>`

**Throws:**

- `CasError` with code `INVALID_KEY_TYPE` if key is not a Uint8Array
- `CasError` with code `INVALID_KEY_LENGTH` if key is not 32 bytes

**Example:**

```javascript
const { buf, meta } = await cas.encrypt({
  buffer: new TextEncoder().encode('secret data'),
  key: crypto.randomBytes(32),
});
```

#### decrypt

```javascript
await cas.decrypt({ buffer, key, meta });
```

Decrypts a buffer using AES-256-GCM.

**Parameters:**

- `buffer` (required): `Uint8Array` - Encrypted data
- `key` (required): `Uint8Array` - 32-byte encryption key
- `meta` (required): `Object` - Encryption metadata (from encrypt result)

**Returns:** `Promise<Uint8Array>` - Decrypted data

**Throws:**

- `CasError` with code `INTEGRITY_ERROR` if decryption fails

**Example:**

```javascript
const decrypted = await cas.decrypt({ buffer: buf, key, meta });
```

#### rotateKey

```javascript
await cas.rotateKey({ manifest, oldKey, newKey, label });
```

Rotates a recipient's encryption key without re-encrypting data blobs. Unwraps
the DEK with `oldKey`, re-wraps with `newKey`, and increments `keyVersion`
counters. When `label` is omitted, git-cas scans every recipient candidate and
rotates the first matching entry.

**Parameters:**

- `manifest` (required): `Manifest` - Envelope-encrypted manifest
- `oldKey` (required): `Uint8Array` - Current 32-byte KEK
- `newKey` (required): `Uint8Array` - New 32-byte KEK
- `label` (optional): `string` - If provided, only rotate the named recipient

**Returns:** `Promise<Manifest>` - Updated manifest with re-wrapped DEK and incremented `keyVersion`

**Throws:**

- `CasError` with code `ROTATION_NOT_SUPPORTED` if manifest has no recipients (legacy/unencrypted)
- `CasError` with code `RECIPIENT_NOT_FOUND` if `label` doesn't exist
- `CasError` with code `DEK_UNWRAP_FAILED` if `oldKey` doesn't match the recipient
- `CasError` with code `NO_MATCHING_RECIPIENT` if no label is provided and `oldKey` matches no entry

**Example:**

```javascript
const rotated = await cas.rotateKey({
  manifest,
  oldKey: aliceOldKey,
  newKey: aliceNewKey,
  label: 'alice',
});
const treeOid = await cas.createTree({ manifest: rotated });
await cas.addToVault({ slug: 'my-asset', treeOid, force: true });
```

#### rotateVaultPassphrase

```javascript
await cas.rotateVaultPassphrase({ oldPassphrase, newPassphrase, kdfOptions });
```

Rotates the vault-level encryption passphrase. Re-wraps every envelope-encrypted entry's DEK with a new KEK derived from `newPassphrase`. Non-envelope entries are skipped.

**Parameters:**

- `oldPassphrase` (required): `string` - Current vault passphrase
- `newPassphrase` (required): `string` - New vault passphrase
- `kdfOptions` (optional): `Object` - KDF options for new passphrase (e.g., `{ algorithm: 'scrypt' }`). Defaults use PBKDF2 `600000` or scrypt `N=131072`, and out-of-policy values fail with `KDF_POLICY_VIOLATION`

**Returns:** `Promise<{ commitOid: string, rotatedSlugs: string[], skippedSlugs: string[] }>`

**Throws:**

- `CasError` with code `VAULT_METADATA_INVALID` if vault is not encrypted
- `CasError` with code `DEK_UNWRAP_FAILED` or `NO_MATCHING_RECIPIENT` if old passphrase is wrong
- `CasError` with code `KDF_POLICY_VIOLATION` if stored or requested KDF parameters fall outside policy
- `CasError` with code `VAULT_CONFLICT` if concurrent vault updates exhaust retries

**Example:**

```javascript
const { commitOid, rotatedSlugs, skippedSlugs } = await cas.rotateVaultPassphrase({
  oldPassphrase: 'old-secret',
  newPassphrase: 'new-secret',
});
console.log(`Rotated: ${rotatedSlugs.join(', ')}`);
console.log(`Skipped: ${skippedSlugs.join(', ')}`);
```

### Properties

#### chunkSize

```javascript
cas.chunkSize;
```

Returns the configured chunk size in bytes.

**Type:** `number`

**Example:**

```javascript
console.log(cas.chunkSize); // 262144
```

## Application Storage

The high-level application boundary exposes immutable content handles and
explicit lifecycle operations. It composes the lower-level store, manifest,
tree, RootSet, commit, and ref operations without requiring callers to manage
payload OIDs.

### `assets.put()`

```javascript
const staged = await cas.assets.put({
  source,
  slug,
  filename,
  encryptionKey,
  passphrase,
  encryption,
  kdfOptions,
  compression,
  recipients,
  merkleThreshold,
  chunking,
});
```

Streams an `AsyncIterable<Uint8Array>` through the existing CAS pipeline,
creates its manifest tree, and returns an immutable `StagedAsset`. Payload
bytes are consumed through the configured chunker and are not returned in the
result. Manifest metadata remains subject to the existing manifest and Merkle
limits documented in the streaming matrix.

`filename` defaults to `slug`. All other storage options have the same meaning
as `store()`.

**Returns:** `Promise<StagedAsset>`

```javascript
{
  version: 1,
  state: 'staged',
  handle: AssetHandle,
  asset: { slug, filename, size },
  retention: {
    policy: null,
    reachability: 'unanchored',
    protection: 'not-established',
  },
  observedAt: '2026-07-13T10:00:00.000Z',
}
```

`unanchored` means this operation created no reachability root. It is not a
global assertion that a deduplicated object graph is unreachable through every
other Git ref. `not-established` likewise means this operation made no
protection claim. Call `retention.retain()` or `publications.commit()` before
relying on a new handle beyond Git's unreachable-object grace period.

### `assets.open()`

```javascript
for await (const chunk of cas.assets.open({
  handle,
  encryptionKey,
  passphrase,
})) {
  consume(chunk);
}
```

Validates the canonical handle, codec, root tree, manifest, and referenced
chunk graph, then returns restored bytes as an `AsyncIterable<Uint8Array>`.
Encrypted restore behavior follows the existing streaming matrix; explicit
`whole` encryption may use its documented bounded compatibility buffer.

Missing transferred objects fail with `HANDLE_TARGET_MISSING`. A handle created
for a different manifest codec fails with `HANDLE_CODEC_MISMATCH`.

### `assets.adopt()`

```javascript
const staged = await cas.assets.adopt({ treeOid });
```

Validates an existing git-cas manifest tree and wraps it in the same staged
result returned by `assets.put()`. This is a migration bridge for callers that
already persisted raw tree OIDs; new application code should exchange handles.

### `pages.put()`, `pages.open()`, and `pages.get()`

```javascript
const staged = await cas.pages.put({ source, maxBytes });

for await (const chunk of cas.pages.open({ handle: staged.handle })) {
  consume(chunk);
}

const bytes = await cas.pages.get({ handle: staged.handle, maxBytes });
```

A page is one immutable raw Git blob intended for a bounded trie, index, or
materialization node. `source` may be a `Uint8Array`, `Iterable<Uint8Array>`, or
`AsyncIterable<Uint8Array>`. The facade default `maxPageSize` is 16 MiB; an
operation may lower that bound with `maxBytes` but cannot raise it.

`put()` returns an immutable `StagedPage` and identical bytes deduplicate to the
same `PageHandle`. `open()` validates the blob type and size through Git object
metadata before streaming it. `get()` additionally collects the page under its
effective byte bound. An imported handle above the configured maximum fails
with `PAGE_TOO_LARGE` without materializing the blob.

The canonical page token is:

```text
git-cas:1:page:blob:raw:<sha1|sha256>:<oid>
```

### `bundles.put()` and `bundles.putOrdered()`

```javascript
const staged = await cas.bundles.put({
  members: {
    'nodes/root': nodePageHandle,
    'edges/root': edgePageHandle,
    'state/frontier': frontierBytes,
  },
  limits: { maxFanoutEntries: 256 },
});

const streamed = await cas.bundles.putOrdered({
  members: orderedAsyncMemberPairs,
});
```

Members are named application handles, byte sources, or `{ source, maxBytes }`
page inputs. Inline bytes are staged as pages. Existing assets, pages, and
bundles remain immutable; a bundle tree creates direct Git reachability edges
to every member handle. `put()` sorts an in-memory object, `Map`, or pair array.
`putOrdered()` consumes an already sorted iterable and rejects duplicate or
out-of-order canonical paths, enabling construction with bounded resident
state.

Repository defaults, which an operation may only lower, are:

| Limit | Default |
| --- | ---: |
| `maxMembers` | 100,000 |
| `maxMemberPathBytes` | 512 bytes |
| `maxDescriptorBytes` | 64 MiB |
| `maxFanoutEntries` | 1,024 Git entries per node |
| `maxFanoutDepth` | 8 levels |

Paths must be non-empty NFC text, use `/` separators, and cannot contain empty,
`.` or `..` segments, backslashes, NULs, or control characters. Construction
is deterministic across input chunking and in-memory member order. A staged
bundle remains unanchored until retention or publication succeeds.

The canonical bundle token is:

```text
git-cas:1:bundle:fanout-tree:<codec>:<sha1|sha256>:<oid>
```

### `bundles.getMember()`, `bundles.iterateMembers()`, and `bundles.openMember()`

```javascript
const member = await cas.bundles.getMember({
  handle: materializationHandle,
  path: 'nodes/root',
});

for await (const member of cas.bundles.iterateMembers({
  handle: materializationHandle,
})) {
  consumeDescriptor(member);
}

for await (const chunk of cas.bundles.openMember({
  handle: materializationHandle,
  path: 'nodes/root',
})) {
  consume(chunk);
}
```

`getMember()` returns the selected member descriptor or `null`. `openMember()`
streams one selected page or asset and fails with `BUNDLE_MEMBER_NOT_FOUND` for
an absent path. A nested bundle is a structured handle rather than a byte
stream and fails with `BUNDLE_MEMBER_NOT_STREAMABLE` when opened directly.

`iterateMembers()` validates each member support graph before yielding its
immutable descriptor in canonical path order. Completing the iteration also
validates the root and fanout summaries. It does not allocate an array or other
cardinality-sized inventory for the member set. Bundle root resolution reports deterministic
`logicalBytes`: descriptor bytes plus each distinct immediate member handle's
transitive logical bytes. Repeating one handle within a bundle charges it once;
using the same handle in two independent cache entries charges each entry.

`getMember()` and `openMember()` traverse only the bounded fanout path needed
for the selected member. `iterateMembers()` is the explicit full-index
streaming surface; retention, publication, and bundle-root resolution also
validate the complete graph.

### Application Handles

`AssetHandle`, `PageHandle`, and `BundleHandle` are immutable, versioned content
locators. The asset token has this shape:

```text
git-cas:1:asset:manifest-tree:<codec>:<sha1|sha256>:<oid>
```

```javascript
import { AssetHandle } from '@git-stunts/git-cas';

const token = staged.handle.toString();
const parsed = AssetHandle.parse(token);
const data = parsed.toJSON();
```

The token contains no filesystem or repository location. It works in another
clone or mirror only after the referenced Git object graph has been transferred.
"Opaque" is an ownership boundary, not encryption: callers may serialize and
compare the token, while `git-cas` owns interpretation and object traversal.

### `retention.retain()`

```javascript
const result = await cas.retention.retain({
  handle,
  root: {
    ref: 'refs/cas/rootsets/my-app-cache',
    name: 'coordinate-184',
  },
  policy: 'evictable',
});
```

Validates an asset, page, or bundle handle graph, installs its root in the named
current-generation RootSet, and returns:

```javascript
{
  changed: true,
  witness: RetentionWitness,
}
```

The witness records `policy`, observed `reachability`, timestamp, RootSet ref,
generation commit, and the exact tree path that retained the handle. The
default policy is `pinned`; `evictable` allows higher-level cache policy to
release the entry. Neither policy creates a Git pack `.keep` file.

### `publications.commit()`

```javascript
const result = await cas.publications.commit({
  root: handle,
  commit: {
    message: 'Publish application state',
    parents: previous === null ? [] : [previous],
  },
  ref: {
    name: 'refs/my-app/state',
    expected: previous,
  },
});
```

Generic publication is available only below a constructor-configured
`applicationRefPrefixes` allowlist. Even a broad allowlist cannot publish below
`refs/bisect/*`, `refs/cas/*`, `refs/heads/*`, `refs/notes/*`,
`refs/remotes/*`, `refs/replace/*`, `refs/rewritten/*`, `refs/stash`,
`refs/tags/*`, or `refs/worktree/*`. The method:

1. validates the complete supported handle graph;
2. validates at most 64 ordered parent commit IDs and a commit message of at
   most 1 MiB;
3. creates a commit whose tree is the validated handle root; blob-backed pages
   use a deterministic single-entry wrapper tree; and
4. updates the application ref with compare-and-swap semantics.

`ref.expected` is mandatory. Use `null` to require that the ref not exist.
A stale expectation fails with `PUBLICATION_CONFLICT`; error metadata includes
`expected`, `observed`, and `attemptedCommitId`. Because Git objects are
immutable, a failed ref update can leave the attempted commit unreachable until
normal Git pruning; it cannot publish a partial ref state.

**Returns:**

```javascript
{
  operation: 'publication',
  commitId,
  ref,
  root: AssetHandle | PageHandle | BundleHandle,
  witness: RetentionWitness,
}
```

### `RetentionWitness`

A `RetentionWitness` is immutable evidence for one observed retaining
generation. It does not promise that a mutable ref still points to that
generation later.

```javascript
{
  version: 1,
  handle: AssetHandle | PageHandle | BundleHandle,
  policy: 'pinned' | 'evictable',
  reachability: 'anchored' | 'orphaned' | 'volatile',
  root: {
    kind: 'root-set' | 'publication' | 'cache-set' | 'expiring-set',
    namespace: string,
    ref: string,
    generation: string,
    path: string,
  },
  observedAt: string,
}
```

`toJSON()` serializes `handle` to its canonical token and copies the root
evidence fields.

## Root Sets

Root sets retain a mutable current set of Git blobs or trees. They are intended
for caches, indexes, checkpoints, and other derived state that must survive Git
garbage collection while live but should become collectible after eviction.

| Surface | Git state after write | History policy | Removal behavior | Typical use |
| --- | --- | --- | --- | --- |
| `createTree()` / plumbing | orphaned unless another ref reaches it | none | already prune-eligible after Git's grace period | immediate composition |
| Root set | anchored while present | current generation only | becomes orphaned when no other ref reaches it | cache and derived state |
| Vault | anchored | commit history retained | old generations remain reachable through vault history | durable named assets |

The `pinned` and `evictable` entry values are application retention policy.
Both are Git-anchored while present in a root set. `pinned` does not create a
pack `.keep` file and does not make an object immune to explicit ref deletion.

### Storage Structure

```text
refs/cas/rootsets/warp/state-cache -> parentless commit -> tree
                                                        |-- .rootset.json
                                                        |-- root-00000000 -> tree/blob
                                                        `-- root-00000001 -> tree/blob
```

Every generation commit is parentless by default. Updating the ref therefore
releases the previous generation instead of retaining it as history. OIDs in
`.rootset.json` are descriptive; the Git tree entries are what make targets
reachable.

### Open A Root Set

```javascript
const rootSet = await cas.rootSets.open({
  ref: 'refs/cas/rootsets/warp/state-cache',
});
```

Root-set refs must be below `refs/cas/rootsets/`. Invalid or unsafe ref names
fail with `ROOT_SET_REF_INVALID`.

### put

```javascript
await rootSet.put({
  name: snapshotId,
  oid: payloadTreeOid,
  type: 'tree',
  retention: 'evictable',
});
```

Adds or replaces one named entry. `type` must be `blob` or `tree` and must
match the actual Git object type. `retention` defaults to `pinned` and may be
`pinned` or `evictable`.

The target is checked before metadata is written. Missing targets fail with
`ROOT_SET_TARGET_MISSING`; type mismatches fail with
`ROOT_SET_TARGET_TYPE_MISMATCH`.

### list And contains

```javascript
const entries = await rootSet.list();
const retained = await rootSet.contains(snapshotId);
```

`list()` returns canonical name-sorted entries. `contains(name)` checks the
current snapshot.

### remove

```javascript
const { removed } = await rootSet.remove({ name: snapshotId });
```

Removes one entry. When no other ref reaches its target, that target becomes
orphaned and follows normal Git expiration and pruning rules. Removal is a
no-op when the name is absent.

### replace

```javascript
await rootSet.replace({
  expectedHeadOid: (await rootSet.read()).headOid,
  entries: liveSnapshots.map(({ id, payloadRef }) => ({
    name: id,
    oid: payloadRef,
    type: 'tree',
    retention: 'evictable',
  })),
});
```

Atomically replaces the current set. This is the preferred integration for an
application that already has an authoritative live-entry index. Pass
`expectedHeadOid` (including `null` for a set that must not exist yet) when the
replacement was derived from a particular generation. A stale expectation
fails with `ROOT_SET_CONFLICT` instead of overwriting newer state.

### mutate

```javascript
const { headOid } = await rootSet.read();
await rootSet.mutate(
  (entries) => entries.filter((entry) => shouldKeep(entry)),
  { expectedHeadOid: headOid },
);
```

Runs a compare-and-swap read/modify/write operation. The callback receives a
frozen entry snapshot plus the observed `{ ref, headOid, treeOid }` generation
context, and returns the next iterable of entries. Without
`expectedHeadOid`, conflicts are retried against a fresh snapshot. With an
expected head, the callback is guarded to that generation and any stale read
or write conflict is returned to the caller without retrying.

### doctor

```javascript
const report = await rootSet.doctor();
```

Returns a non-mutating report with:

- `healthy`, `ref`, `headOid`, `treeOid`, and `entryCount`
- `policyCounts` for `pinned` and `evictable`
- `reachabilityCounts` for `anchored`, `missing`, `unknown`, `orphaned`, and
  `volatile`
- per-target existence and actual Git object type
- stable issue codes for missing or mismatched targets

Current members are `anchored`. `orphaned` and `volatile` describe objects
outside the current root set and are reported as zero by a single-set doctor.
Use [`cas.diagnostics.doctor()`](#repository-diagnostics) for repository-wide
classification across refs and reflogs.

### repair

```javascript
await rootSet.repair({ entries: authoritativeLiveEntries });
```

Replaces a missing or malformed root-set head from an authoritative entry
list, without trusting the current metadata. Repair can only adopt objects that
still exist. Run repair before destructive cleanup:

1. Read the application's authoritative live OIDs.
2. Call `doctor()` and compare the application index with `list()`.
3. Call `repair({ entries })` to anchor every known-live object.
4. Re-run `doctor()` and require `healthy: true`.
5. Only then run a Git prune dry-run or garbage collection.

### Direct Services

`RootSet` and `RootSetRegistry` are exported from the package root. Normal
callers should use `cas.rootSets.open(...)`; `getRootSetRegistry()` exposes the
shared registry for advanced composition.

Custom persistence implementations that support root sets must implement
`readObjectType(oid)`, and custom ref adapters must implement
`resolveParents(commitOid)`. The default Git adapters use structured
`git cat-file --batch-check` output and `git rev-list --parents` so missing
targets, repository read failures, and parentful heads remain distinct doctor
findings without parsing runtime-specific stderr. Existing store, restore, and
vault paths do not call these methods.

## Cache Sets

Cache sets are the managed application cache surface. A caller supplies cache
keys and application handles; git-cas owns the immutable index objects, Git
reachability, compare-and-swap replacement, expiry, capacity policy,
diagnostics, and repair.

```javascript
const cache = await cas.caches.open({
  namespace: 'git-warp/materializations',
  policy: {
    maxEntries: 128,
    maxBytes: 2 * 1024 * 1024 * 1024,
    accessResolutionMs: 60 * 60 * 1000,
  },
});
```

The namespace maps to
`refs/cas/caches/git-warp/materializations`. Namespaces contain 1 to 16
slash-separated lowercase ASCII components and at most 240 bytes. Components
start and end with an ASCII letter or digit, may contain `.` and `-`, and
cannot contain `..`, end in `.lock`, or start with the reserved `git-cas-`
prefix. Invalid namespaces fail with `COLLECTION_NAMESPACE_INVALID`.

Cache keys are non-empty, well-formed Unicode in NFC form, contain no C0 or C1
control characters, and encode to at most 1024 UTF-8 bytes. Keys are rejected
rather than normalized. Their lowercase SHA-256 digest is the canonical index
path; the original key remains in metadata and is checked on every read so a
digest collision fails closed with `CACHE_ENTRY_INVALID`.

The default cache policy is `maxEntries: 10000`, `maxBytes: null`, and
`accessResolutionMs: 3600000` (one hour). `maxEntries` is bounded from 1 to
99999. `maxBytes` is either `null` or a non-negative safe integer, and
`accessResolutionMs` is a non-negative safe integer.

### Storage And Reachability

```text
refs/cas/caches/<namespace> -> parentless generation commit
                              `-- root-00000000 -> structured bundle index
                                  |-- .cache/state -> immutable page
                                  `-- entries/<sha256-key> -> entry bundle
                                      |-- meta -> immutable page
                                      `-- target -> asset/page/bundle handle
```

Every successful mutation builds and validates immutable pages and bundles
before publishing one new generation with a guarded ref update. The generation
commit is parentless, so the previous index and evicted targets become
collectible when no other ref reaches them. A failed concurrent attempt may
leave harmless unanchored objects; it cannot remove or overwrite the winning
generation. CacheSet never runs Git garbage collection and never directly
deletes an object.

The ref is mutable because it names the current generation. Its metadata,
entry records, indexes, and targets are immutable CAS objects. CacheSet does
not maintain a second filesystem or process-memory cache.

### put And replace

```javascript
const stored = await cache.put('optic:user:alice', materializationHandle, {
  retention: 'evictable',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
});

const replaced = await cache.replace('optic:user:alice', nextHandle, {
  expectedHandle: materializationHandle,
});
```

`put()` is an upsert unless `expectedHandle` is supplied; a guarded put requires
that current target to exist and match. `replace()` always requires the key to
already exist. On either operation, `expectedHandle` guards replacement to a
particular current target.
The result includes `changed`, `accepted`, `hit`, `previous`, `generation`, a
capacity-policy report, and a `RetentionWitness` for the accepted target.

Writes reject already-expired timestamps. `pinned` and `evictable` entries are
both Git-reachable while present. Capacity sweeps may remove only `evictable`
entries; explicit expiry applies to either policy. When pinned entries or the
newly written entry alone exceed capacity, the write remains successful and
returns `policy.satisfied: false` instead of silently dropping protected data.

### get And touch

```javascript
const hit = await cache.get('optic:user:alice');
if (hit) {
  use(hit.handle);
  await cache.touch(hit.key);
}
```

`get(key)` returns an immutable `CacheHit` or `null`. Expired entries are cache
misses. A hit contains the key, parsed application handle, retention policy,
expiry, deterministic logical bytes, creation and access timestamps, current
generation, and immutable retention evidence.

`get()` never performs a durable write, including for an expired entry.
`touch(key)` is the explicit access update. It writes only when the persisted
`accessedAt` is at least `accessResolutionMs` old, coalescing approximate-LRU
updates without turning every read into a Git ref mutation.

### remove And sweep

```javascript
const removed = await cache.remove('optic:user:alice');
const swept = await cache.sweep();
```

`remove()` releases one key. `sweep()` first releases expired entries, then
evicts the oldest eligible entries until `maxEntries` and `maxBytes` are met.
Eviction selection uses a fixed-size oldest-candidate heap and repeats bounded
streaming passes when more candidates are needed; resident memory does not
scale with cache cardinality.

Logical-byte accounting is versioned and deterministic:

- assets charge manifest logical size;
- pages charge exact blob bytes;
- bundles charge descriptor bytes plus transitive distinct child logical
  bytes;
- one repeated child handle in a bundle is charged once;
- the same target under two cache keys is charged to both entries.

### inspect And doctor

```javascript
const first = await cache.inspect({ limit: 100 });
const next = await cache.inspect({ limit: 100, cursor: first.nextCursor });
const report = await cache.doctor();
```

`inspect()` streams the index to compute exact aggregate counts and returns at
most 1,000 entry records per call. Its cursor is the last returned SHA-256 key
digest. `doctor()` does not mutate the repository. It validates the cache ref,
parentless generation, RootSet edge, structured bundle support graph, key
digests, target handles, canonical metadata, accounting version, persisted
summary, and capacity posture.

### repair

```javascript
await cache.repair({
  entries: authoritativeEntries,
  policy: { maxEntries: 128, maxBytes: 2 * 1024 * 1024 * 1024 },
});
```

`repair()` rebuilds a missing or malformed generation from an authoritative
bounded entry list without trusting current cache metadata. It validates every
target before publishing the replacement generation and returns a retention
witness for the repaired index. Run `doctor()` again and require
`healthy: true` before any destructive repository maintenance.

## Expiring Sets

Expiring sets are the durable replay-marker surface. They are stricter than
cache sets: a live marker is pinned through its declared acceptance window and
cannot be removed for capacity, recency, repair, or caller convenience.

```javascript
const replay = await cas.expiringSets.open({
  namespace: 'git-warp/admission-replay',
});

const result = await replay.addIfAbsent(requestNonce, {
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
});

if (!result.admitted) {
  throw new Error('Replay rejected');
}
```

The namespace uses the same canonical grammar as CacheSet and maps to
`refs/cas/expiring/git-warp/admission-replay`. Open options accept only
`namespace` and an optional RootSet conflict `retry` policy. Capacity and
eviction options fail with `INVALID_OPTIONS` rather than being ignored.

### Key Privacy And Collision Detection

Keys use the same non-empty, NFC, control-free, 1,024-byte input boundary as
cache keys, but plaintext keys are never persisted. ExpiringSet computes two
domain-separated SHA-256 values:

- the primary digest is the deterministic marker path;
- the verification digest detects a primary-digest collision when that key is
  checked or admitted.

Both digests are lowercase canonical hex. A crypto adapter that returns an
invalid digest or collapses both domains is rejected. Deterministic digests can
still reveal low-entropy input through offline guessing, so callers should use
high-entropy nonces or hash a suitably secret protocol value before admission.

### Storage And Reachability

```text
refs/cas/expiring/<namespace> -> parentless generation commit
                                `-- root-00000000 -> structured bundle index
                                    |-- .expiring/state -> immutable page
                                    `-- markers/<sha256-key> -> immutable page
```

Marker pages contain only the metadata version, primary and verification
digests, `createdAt`, and `expiresAt`. Every current marker is a real transitive
Git tree edge below the one RootSet slot. The returned `RetentionWitness` names
that physical slot and the immutable marker page it supports; it does not
pretend that a structured bundle's logical member name is a physical path in
the generation tree.

Every generation commit is parentless. Replacing the same expired key or
sweeping expired markers releases old support without preserving it through a
commit-parent chain. ExpiringSet never deletes Git objects and never invokes
garbage collection.

### addIfAbsent And contains

`addIfAbsent(key, { expiresAt })` requires a future canonical UTC timestamp or
a valid `Date`. It performs a compare-and-swap RootSet mutation. Concurrent
duplicate calls produce exactly one `admitted: true` winner; a loser returns
the winning immutable `ExpiringMarker` and its generation-scoped witness.

The operation rechecks the expiry on every conflict retry, clears all
attempt-local result state, and validates the persisted state page against a
streamed historical marker scan before staging a write. Missing, malformed, or
inconsistent marker support fails closed instead of being silently healed.

`contains(key)` is a targeted, non-mutating membership check. It returns `true`
only while the matching marker is unexpired. Callers that need atomic replay
admission must use `addIfAbsent()` rather than composing `contains()` with a
later write.

### sweep

```javascript
const swept = await replay.sweep();
```

`sweep()` validates current state and then releases only markers whose
`expiresAt` is less than or equal to the injected clock. There is no public
`remove()` or `repair()` method and no capacity or LRU policy. The implementation
uses bounded streaming validation, classification, and rewrite passes without
retaining an array proportional to set cardinality.

An expired marker remains anchored until `sweep()` or admission of that same
expired key publishes a replacement generation. `contains()` never performs
that cleanup as a side effect.

### inspect And doctor

```javascript
const page = await replay.inspect({ limit: 100 });
const report = await replay.doctor();
```

`inspect()` returns digest-only marker records, live/expired classification,
current aggregate counts, retention evidence, and a digest cursor. It returns
at most 1,000 records per call. `doctor()` is non-mutating and validates the
ref, parentless RootSet generation, structured index, canonical state and
marker pages, nested object existence, and persisted count/expiry summary.
Expired markers are reported as an operational classification, not corruption.

Malformed or missing state has no automatic repair path because an
authoritative-but-incomplete replacement could weaken replay protection.
Reconstruction requires a trusted external ledger and a separately reviewed
operator procedure.

### Clock Trust

The constructor-level `clock` option controls deterministic evaluation in
tests and host integrations. Clock rollback extends protection because markers
remain live longer. A forward jump can shorten a window, so security callers
must validate request timestamps and choose `expiresAt` from the same trusted
clock. Marker state survives process restart because the Git ref, not process
memory, is authoritative.

## Repository Diagnostics

`cas.diagnostics.doctor()` returns immutable, machine-readable evidence about
the complete Git object store and the managed git-cas refs without running
garbage collection or destructive prune.

```javascript
const report = await cas.diagnostics.doctor({
  gracePeriodMs: 14 * 24 * 60 * 60 * 1000,
  maxCollectionsPerKind: 100,
});

console.log(report.repository.objects);
console.log(report.usage.caches);
console.log(report.limitations);
```

Pass either `gracePeriodMs` or an exact canonical `expiresBefore` UTC timestamp,
not both. The default grace period is 14 days. `maxCollectionsPerKind` bounds
detailed CacheSet, RootSet, and ExpiringSet rows from 1 through 1000; its default
is 100. Every managed collection is still inspected sequentially and included
in `totals`. Coverage reports `observed`, `inspected`, `detailed`, and
`complete`, so detail truncation is visible instead of silently dropping
managed refs or undercounting repository usage.

The reachability classes have precise operational meanings:

- `anchored` is the object set reached by all refs and all reflog entries.
- `volatile` is the loose unreachable set reported by
  `git prune --dry-run --verbose --no-progress --expire=<cutoff>`.
- `orphaned` is the remaining unreachable set not targeted by that exact dry
  run.

The volatile inventory always goes through
`GitPlumbing.inspectPrunableObjects()` from `@git-stunts/plumbing`; git-cas does
not construct or expose a mutating prune path. If independent writers change
the object store while the streamed inventories run, arithmetic invariants
fail closed: `healthy` becomes false, derived counts become `null`, and the
report includes `REPOSITORY_CHANGED_DURING_INSPECTION`.

Repository-wide physical bytes are reported where Git provides compatible
evidence: total object bytes, anchored bytes, and their combined unreachable
difference. Physical bytes for an individual cache, root set, vault, orphaned
class, or volatile class are `null`; shared objects and pack deltas cannot be
assigned honestly to one owner. A dry prune also cannot expose the age of
packed unreachable objects. Git may include configured alternate object stores
in its inventory, while object disk sizes exclude pack indexes, bitmaps, and
other repository metadata. These facts appear in `limitations` rather than
being estimated.

Cache summaries report entry count, deterministic logical bytes, age, expiry,
capacity policy, and pinned/evictable counts. RootSet policy counts and Vault
entry counts are reported independently from reachability. A privacy-mode
vault remains healthy but reports `entryCount: null` because repository doctor
does not request or retain vault key material.

Object and ref inventories are consumed as streams, and managed collections are
inspected one at a time. Runtime memory is bounded by stream windows,
`maxCollectionsPerKind`, and existing per-collection/blob safety limits;
runtime is linear in repository object and managed-collection count. Doctor
never updates a ref, writes an object, runs `git gc`, or runs a destructive
`git prune`.

## Vault

The vault provides GC-safe storage by maintaining a single Git ref (`refs/cas/vault`) pointing to a commit chain. The commit's tree indexes all stored assets by slug. This prevents `git gc` from garbage-collecting stored data.

### Vault Tree Structure

```text
refs/cas/vault → commit → tree
                            ├── 100644 blob <oid>  .vault.json
                            ├── 040000 tree <oid>  demo/hello
                            ├── 040000 tree <oid>  photos/beach
```

### Types

#### VaultEntry

```typescript
interface VaultEntry {
  slug: string;
  treeOid: string;
}
```

#### VaultMetadata

```typescript
interface VaultEncryptionVerifier {
  version: 1;
  ciphertext: string;
  meta: EncryptionMeta;
}

interface VaultMetadata {
  version: number;
  encryption?: {
    cipher: string;
    kdf: {
      algorithm: string;
      salt: string;
      iterations?: number;
      cost?: number;
      blockSize?: number;
      parallelization?: number;
      keyLength: number;
    };
    verifier?: VaultEncryptionVerifier;
  };
  privacy?: {
    enabled: boolean;
    indexMeta?: EncryptionMeta;
  };
  encryptionCount?: number;
}
```

Encrypted vaults created by v6 include `encryption.verifier`, an AES-GCM
encrypted metadata verifier that authenticates a derived vault key even when the
vault has no entries yet. Older encrypted vaults may lack the field; `git-cas`
adds it on the next vault write that provides the vault encryption key.

### Methods

#### initVault

```javascript
await cas.initVault({ passphrase?, kdfOptions? })
```

Initializes the vault. Optionally configures vault-level encryption with a passphrase.

**Parameters:**

- `passphrase` (optional): `string` - Passphrase for vault-level key derivation
- `kdfOptions` (optional): `Object` - KDF options (`{ algorithm, iterations, cost, ... }`). Defaults use PBKDF2 `600000` or scrypt `N=131072`, and out-of-policy values fail with `KDF_POLICY_VIOLATION`

**Returns:** `Promise<{ commitOid: string }>`

**Throws:**

- `CasError` with code `VAULT_ENCRYPTION_ALREADY_CONFIGURED` if vault already has encryption
- `CasError` with code `KDF_POLICY_VIOLATION` if requested KDF parameters fall outside policy

**Example:**

```javascript
// Without encryption
await cas.initVault();

// With encryption
await cas.initVault({
  passphrase: 'my secret passphrase',
  kdfOptions: { algorithm: 'pbkdf2' },
});
```

#### addToVault

```javascript
await cas.addToVault({ slug, treeOid, force? })
```

Adds an entry to the vault. Auto-initializes the vault if it doesn't exist.

**Parameters:**

- `slug` (required): `string` - Entry slug (e.g., `"demo/hello"`, `"photos/beach-2024"`)
- `treeOid` (required): `string` - Git tree OID
- `force` (optional): `boolean` - Overwrite existing entry (default: `false`)

**Returns:** `Promise<{ commitOid: string }>`

**Throws:**

- `CasError` with code `INVALID_SLUG` if slug fails validation
- `CasError` with code `VAULT_ENTRY_EXISTS` if slug exists and `force` is false
- `CasError` with code `VAULT_CONFLICT` if concurrent update detected after retries

**Example:**

```javascript
const treeOid = await cas.createTree({ manifest });
await cas.addToVault({ slug: 'demo/hello', treeOid });
```

#### listVault

```javascript
await cas.listVault();
```

Lists all vault entries sorted by slug.

**Returns:** `Promise<VaultEntry[]>`

**Example:**

```javascript
const entries = await cas.listVault();
for (const { slug, treeOid } of entries) {
  console.log(`${slug}\t${treeOid}`);
}
```

#### removeFromVault

```javascript
await cas.removeFromVault({ slug });
```

Removes an entry from the vault.

**Parameters:**

- `slug` (required): `string` - Entry slug to remove

**Returns:** `Promise<{ commitOid: string, removedTreeOid: string }>`

**Throws:**

- `CasError` with code `VAULT_ENTRY_NOT_FOUND` if slug does not exist

**Example:**

```javascript
const { removedTreeOid } = await cas.removeFromVault({ slug: 'demo/hello' });
```

#### resolveVaultEntry

```javascript
await cas.resolveVaultEntry({ slug });
```

Resolves a vault entry slug to its tree OID.

**Parameters:**

- `slug` (required): `string` - Entry slug

**Returns:** `Promise<string>` - The tree OID

**Throws:**

- `CasError` with code `VAULT_ENTRY_NOT_FOUND` if slug does not exist

**Example:**

```javascript
const treeOid = await cas.resolveVaultEntry({ slug: 'demo/hello' });
const manifest = await cas.readManifest({ treeOid });
```

#### verifyVaultKey

```javascript
await cas.verifyVaultKey({ encryptionKey });
```

Verifies a derived vault encryption key against verifier metadata when the
vault has a verifier. This is primarily useful for tools that derive keys
themselves from `getVaultMetadata()` and `deriveKey()`.

**Parameters:**

- `encryptionKey` (required): `Uint8Array` - Derived vault encryption key

**Returns:** `Promise<{ verified: boolean, requiresMigration: boolean }>`

`verified` is `true` when verifier metadata exists and the key authenticated.
`requiresMigration` is `true` for older encrypted vaults that have no verifier
yet; the next keyed vault write adds the verifier.

**Throws:**

- `CasError` with code `INTEGRITY_ERROR` if verifier authentication fails
- `CasError` with code `VAULT_METADATA_INVALID` if the vault is not encrypted

#### getVaultMetadata

```javascript
await cas.getVaultMetadata();
```

Returns the vault metadata, or `null` if no vault exists.

**Returns:** `Promise<VaultMetadata | null>`

**Example:**

```javascript
const metadata = await cas.getVaultMetadata();
if (metadata?.encryption) {
  console.log('Vault is encrypted with', metadata.encryption.kdf.algorithm);
}
```

### Slug Validation

Slugs are validated with the following rules:

- Must be a non-empty string
- Must not start or end with `/`
- Must not contain empty segments (`a//b`)
- Must not contain `.` or `..` segments
- Must not contain control characters (0x00–0x1f, 0x7f)
- Each segment must not exceed 255 bytes
- Total slug must not exceed 1024 bytes

### Vault-Configured Passphrase Encryption

When a vault is initialized with a passphrase, the human CLI can derive an
asset encryption key from the vault's KDF configuration when you supply
`GIT_CAS_PASSPHRASE`, `--vault-passphrase-file`, or `--os-keychain-target`
during store and restore. The inline `--vault-passphrase` flag remains
available for compatibility, but it prints a warning because command-line
arguments can be captured by shell history and process listings:

```javascript
// Initialize vault with encryption
await cas.initVault({ passphrase: 'secret' });

// Store with vault-configured passphrase derivation (human CLI convenience)
// GIT_CAS_PASSPHRASE=secret git-cas store file.txt --slug demo/hello --tree

// Restore with vault-configured passphrase derivation
// GIT_CAS_PASSPHRASE=secret git-cas restore --slug demo/hello --out file.txt

// Or resolve the vault passphrase from stdin or the OS keychain
// printf '%s\n' 'secret' | git-cas restore --slug demo/hello --out file.txt --vault-passphrase-file -
// git-cas restore --slug demo/hello --out file.txt --os-keychain-target demo/passphrase
```

The vault stores the KDF parameters (algorithm, salt, iterations) in
`.vault.json`; the passphrase is never stored.

This does not make `refs/cas/vault` itself confidential. The vault remains a
readable slug-to-tree index for repository readers. See
[SECURITY.md](../SECURITY.md) for the cryptographic design details and
[docs/THREAT_MODEL.md](./THREAT_MODEL.md) for the explicit boundary.

This is not an implicit library-level `store()` or `restore()` behavior.
Library callers still pass explicit `encryptionKey` or `passphrase` values, or
derive keys themselves through `getVaultMetadata()` plus `deriveKey()` before
calling the content APIs.

When `--os-keychain-target` is used, the human CLI resolves the passphrase
through `@git-stunts/vault` using OS-native secure storage. The optional
`--os-keychain-account` flag scopes the lookup; the default account is
`git-cas`.

The machine-facing `git cas agent` surface now supports the same explicit
keychain lookup model for vault-derived passphrase flows through structured
request fields:

- `osKeychainTarget` / `osKeychainAccount` for agent store, restore, and vault init
- `oldOsKeychainTarget` / `oldOsKeychainAccount` and
  `newOsKeychainTarget` / `newOsKeychainAccount` for agent vault rotate

### CLI Vault Commands

```bash
git cas vault init                               # Initialize vault
printf '%s\n' 'secret' | git cas vault init --vault-passphrase-file -
git cas vault init --os-keychain-target demo/passphrase
git cas vault list                               # List all entries
git cas vault info <slug>                        # Show slug + tree OID
git cas vault remove <slug>                      # Remove an entry
git cas vault history                            # Show commit history
git cas vault history -n 10                      # Last N commits
git cas vault rotate --old-passphrase-file old.txt --new-passphrase-file new.txt
git cas vault rotate --old-passphrase-file old.txt --new-passphrase-file new.txt --algorithm scrypt
```

### CLI Key Rotation Commands

```bash
# Rotate a single asset's key (by vault slug)
git cas rotate --slug demo/hello \
  --old-key-file old.key --new-key-file new.key

# Rotate a single asset's key (by tree OID)
git cas rotate --oid <tree-oid> \
  --old-key-file old.key --new-key-file new.key

# Rotate only a named recipient
git cas rotate --slug demo/hello \
  --old-key-file old.key --new-key-file new.key --label alice
```

#### `git cas rotate` flags

| Flag                    | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `--slug <slug>`         | Resolve tree OID from vault slug (updates vault entry) |
| `--oid <tree-oid>`      | Direct tree OID (outputs updated manifest)             |
| `--old-key-file <path>` | Path to current 32-byte key file (required)            |
| `--new-key-file <path>` | Path to new 32-byte key file (required)                |
| `--label <label>`       | Only rotate the named recipient entry                  |
| `--cwd <dir>`           | Git working directory (default: `.`)                   |

#### `git cas vault rotate` flags

| Flag                           | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| `--old-passphrase <pass>`      | Current inline passphrase (warns; prefer file)          |
| `--new-passphrase <pass>`      | New inline passphrase (warns; prefer file)              |
| `--old-passphrase-file <path>` | Read current passphrase from file (`-` for stdin)       |
| `--new-passphrase-file <path>` | Read new passphrase from file (`-` for stdin)           |
| `--algorithm <alg>`            | KDF algorithm for new passphrase (`pbkdf2` or `scrypt`) |
| `--cwd <dir>`                  | Git working directory (default: `.`)                    |

### Vault History

The vault maintains a full commit history via `refs/cas/vault`. Each mutation (add, remove, init) creates a new commit. Use `vault history` (or `git log refs/cas/vault`) to inspect the audit trail.

## VaultService

Domain service for vault operations. Requires three ports:

- `persistence` (`GitPersistencePort`) — blob/tree read/write
- `ref` (`GitRefPort`) — ref resolution, commits, atomic updates
- `crypto` (`CryptoPort`) — KDF for vault-level encryption

```javascript
import { VaultService } from '@git-stunts/git-cas'; // or via facade
const vault = await cas.getVaultService();
```

## CasService

Core domain service implementing CAS operations. Usually accessed via ContentAddressableStore, but can be used directly for advanced scenarios.

### Constructor

```javascript
new CasService({
  persistence,
  codec,
  crypto,
  observability,
  chunkSize,
  merkleThreshold,
  concurrency,
  chunker,
  compressionAdapter,
  maxRestoreBufferSize,
  maxBlobSize,
  formatVersion,
  legacyMode,
});
```

**Parameters:**

- `persistence` (required): `GitPersistencePort` implementation
- `codec` (required): `CodecPort` implementation
- `crypto` (required): `CryptoPort` implementation
- `observability` (required): `ObservabilityPort` implementation
- `chunkSize` (optional): `number` - Chunk size in bytes (default: 262144, minimum: 1024)
- `merkleThreshold` (optional): `number` - Chunk count threshold for Merkle manifests (default: 1000)
- `concurrency` (optional): `number` - Maximum parallel chunk I/O operations (default: 1, max: 64)
- `chunker` (required): `ChunkingPort` - Chunking strategy instance (e.g., `FixedChunker`, `CdcChunker`)
- `compressionAdapter` (required): `CompressionPort` - Compression adapter (e.g., `NodeCompressionAdapter`)
- `maxRestoreBufferSize` (optional): `number` - Max bytes for buffered encrypted/compressed restore (default: 536870912 / 512 MiB)
- `maxBlobSize` (optional): `number` - Max bytes for metadata blob reads (default: 10485760 / 10 MiB)
- `formatVersion` (optional): `string` - Semver version stamped into new manifests
- `legacyMode` (optional): `boolean` - When true, allows reading manifests with legacy encryption schemes (default: false)

**Throws:**

- `Error` if chunkSize is less than 1024 bytes
- `Error` if merkleThreshold is not a positive integer
- `Error` if chunker is not provided
- `Error` if compressionAdapter is not provided
- `Error` if observability does not implement ObservabilityPort

**Example:**

```javascript
import CasService from '@git-stunts/git-cas/service';
// Or: import { CasService } from '@git-stunts/git-cas';
import {
  GitPersistenceAdapter,
  JsonCodec,
  NodeCryptoAdapter,
  SilentObserver,
  FixedChunker,
  NodeCompressionAdapter,
} from '@git-stunts/git-cas';

const service = new CasService({
  persistence: new GitPersistenceAdapter({ plumbing }),
  codec: new JsonCodec(),
  crypto: new NodeCryptoAdapter(),
  observability: new SilentObserver(),
  chunker: new FixedChunker({ chunkSize: 512 * 1024 }),
  compressionAdapter: new NodeCompressionAdapter(),
});
```

### Methods

All methods from ContentAddressableStore delegate to CasService. See ContentAddressableStore documentation above for:

- `store({ source, slug, filename, encryptionKey, passphrase, encryption, kdfOptions, compression, chunker, recipients })`
- `restore({ manifest, encryptionKey, passphrase })`
- `restoreStream({ manifest, encryptionKey, passphrase })`
- `createTree({ manifest })`
- `verifyIntegrity(manifest, { encryptionKey, passphrase })`
- `readManifest({ treeOid })`
- `inspectAsset({ treeOid })`
- `collectReferencedChunks({ treeOids })`
- `addRecipient({ manifest, existingKey, newRecipientKey, label })`
- `removeRecipient({ manifest, label })`
- `listRecipients(manifest)` — **synchronous** on CasService (returns `string[]`, not a Promise)
- `rotateKey({ manifest, oldKey, newKey, label })`
- `encrypt({ buffer, key })`
- `decrypt({ buffer, key, meta })`
- `deriveKey(options)`
- `deleteAsset({ treeOid })` — **deprecated**, use `inspectAsset`
- `findOrphanedChunks({ treeOids })` — **deprecated**, use `collectReferencedChunks`

#### CasService-only methods

The following methods are available only on CasService (not on the facade):

##### readManifestRaw

```javascript
await service.readManifestRaw({ treeOid });
```

Reads a manifest from a Git tree OID and returns the raw decoded object WITHOUT Manifest construction or scheme assertion. This is the migration entry point -- it can read manifests with legacy encryption scheme identifiers that the normal `readManifest` rejects.

**Parameters:**

- `treeOid` (required): `string` - Git tree OID

**Returns:** `Promise<Record<string, unknown>>` - Raw decoded manifest data

**Throws:**

- `CasError` with code `MANIFEST_NOT_FOUND` if no manifest entry exists in the tree
- `CasError` with code `GIT_ERROR` if the underlying Git command fails

> **Warning**: This method skips manifest hash verification and schema validation.
> It is intended for migration tooling only. Do not use for production reads.

**Example:**

```javascript
const service = await cas.getService();
const raw = await service.readManifestRaw({ treeOid });
console.log(raw.slug, raw.encryption?.scheme);
```

##### createFileRestorePlan

```javascript
await service.createFileRestorePlan({ manifest, encryptionKey, passphrase });
```

Creates a named restore plan for file publication without leaking internal helper coupling into infrastructure adapters. `stream` plans can be piped directly to the destination file. `bounded-file` plans preserve the whole-object auth boundary by writing to a temp file and only publishing on success.

**Parameters:**

- `manifest` (required): `Manifest` - The file manifest
- `encryptionKey` (optional): `Uint8Array` - 32-byte encryption key
- `passphrase` (optional): `string` - Passphrase for KDF-based decryption

**Returns:** `Promise<FileRestorePlan>`

```typescript
interface FileRestorePlan {
  mode: 'stream' | 'bounded-file';
  source: AsyncIterable<Uint8Array>;
  encryptionMeta?: EncryptionMeta;
}
```

**Example:**

```javascript
const service = await cas.getService();
const plan = await service.createFileRestorePlan({ manifest, encryptionKey });
if (plan.mode === 'stream') {
  // Pipe plan.source directly to disk
} else {
  // Write to temp, rename on success
}
```

### Observability

CasService delegates metrics and logging to the injected `ObservabilityPort` adapter. Use `EventEmitterObserver` for event-based monitoring or `StatsCollector` for metric aggregation.

## Events

Events are emitted through the `ObservabilityPort` adapter, not directly from CasService. Attach an `EventEmitterObserver` to listen:

```javascript
import ContentAddressableStore, { EventEmitterObserver } from '@git-stunts/git-cas';

const observability = new EventEmitterObserver();
const cas = new ContentAddressableStore({ plumbing, observability });

observability.on('chunk:stored', (payload) => {
  console.log('Chunk stored:', payload);
});
```

### chunk:stored

Emitted when a chunk is successfully stored.

**Payload:**

```javascript
{
  index: number,      // Chunk index (0-based)
  size: number,       // Chunk size in bytes
  digest: string,     // SHA-256 hex digest (64 chars)
  blob: string        // Git blob OID
}
```

### chunk:restored

Emitted when a chunk is successfully restored and verified.

**Payload:**

```javascript
{
  index: number,      // Chunk index (0-based)
  size: number,       // Chunk size in bytes
  digest: string      // SHA-256 hex digest (64 chars)
}
```

### file:stored

Emitted when a complete file is successfully stored.

**Payload:**

```javascript
{
  slug: string,       // Asset slug
  size: number,       // Total file size in bytes
  chunkCount: number, // Number of chunks
  encrypted: boolean  // Whether content was encrypted
}
```

### file:restored

Emitted when a complete file is successfully restored.

**Payload:**

```javascript
{
  slug: string,       // Asset slug
  size: number,       // Total file size in bytes
  chunkCount: number  // Number of chunks
}
```

### integrity:pass

Emitted when integrity verification passes for all chunks.

**Payload:**

```javascript
{
  slug: string; // Asset slug
}
```

### integrity:fail

Emitted when integrity verification fails for a chunk.

**Payload:**

```javascript
{
  slug: string,       // Asset slug
  chunkIndex: number, // Failed chunk index
  expected: string,   // Expected SHA-256 digest
  actual: string      // Actual SHA-256 digest
}
```

### error

Emitted when an error occurs during streaming operations (if listeners are registered).

**Payload:**

```javascript
{
  code: string,       // CasError code
  message: string     // Error message
}
```

## Value Objects

### Manifest

Immutable value object representing a file manifest.

#### Constructor

```javascript
new Manifest(data);
```

**Parameters:**

- `data.slug` (required): `string` - Unique identifier (min length: 1)
- `data.filename` (required): `string` - Original filename (min length: 1)
- `data.size` (required): `number` - Total file size in bytes (>= 0)
- `data.chunks` (required): `Array<Object>` - Chunk metadata array
- `data.encryption` (optional): `Object` - Encryption metadata (may include `kdf` field for passphrase-derived keys)
- `data.version` (optional): `number` - Manifest version (1 = flat, 2 = Merkle; default: 1)
- `data.compression` (optional): `Object` - Compression metadata `{ algorithm: 'gzip' }`
- `data.subManifests` (optional): `Array<Object>` - Sub-manifest references (v2 Merkle manifests only)

**Throws:** `Error` if data does not match ManifestSchema

**Example:**

```javascript
const manifest = new Manifest({
  slug: 'my-asset',
  filename: 'file.txt',
  size: 1024,
  chunks: [
    {
      index: 0,
      size: 1024,
      digest: 'a'.repeat(64),
      blob: 'abc123def456',
    },
  ],
});
```

#### Fields

- `slug`: `string` - Asset identifier
- `filename`: `string` - Original filename
- `size`: `number` - Total file size
- `chunks`: `Array<Chunk>` - Array of Chunk objects
- `encryption`: `Object | undefined` - Encryption metadata (may include `kdf` sub-object)
- `version`: `number` - Manifest version (1 or 2, default: 1)
- `compression`: `Object | undefined` - Compression metadata `{ algorithm }`
- `subManifests`: `Array | undefined` - Sub-manifest references (v2 only)

#### Methods

##### toJSON

```javascript
manifest.toJSON();
```

Returns a plain object representation suitable for serialization.

**Returns:** `Object`

**Example:**

```javascript
const json = manifest.toJSON();
console.log(JSON.stringify(json, null, 2));
```

### Chunk

Immutable value object representing a content chunk.

#### Constructor

```javascript
new Chunk(data);
```

**Parameters:**

- `data.index` (required): `number` - Chunk index (>= 0)
- `data.size` (required): `number` - Chunk size in bytes (> 0)
- `data.digest` (required): `string` - SHA-256 hex digest (exactly 64 chars)
- `data.blob` (required): `string` - Git blob OID (min length: 1)

**Throws:** `Error` if data does not match ChunkSchema

**Example:**

```javascript
const chunk = new Chunk({
  index: 0,
  size: 262144,
  digest: 'a'.repeat(64),
  blob: 'abc123def456',
});
```

#### Fields

- `index`: `number` - Chunk index (0-based)
- `size`: `number` - Chunk size in bytes
- `digest`: `string` - SHA-256 hex digest
- `blob`: `string` - Git blob OID

## Ports

Ports define the interfaces for pluggable adapters. Implementations are provided but you can create custom adapters.

### GitPersistencePort

Interface for Git persistence operations.

#### Methods

##### writeBlob

```javascript
await port.writeBlob(content);
```

Writes content as a Git blob.

**Parameters:**

- `content`: `Uint8Array` - Content to store

**Returns:** `Promise<string>` - Git blob OID

##### writeTree

```javascript
await port.writeTree(entries);
```

Creates a Git tree object.

**Parameters:**

- `entries`: `Array<string>` - Git mktree format lines (e.g., `"100644 blob <oid>\t<name>"`)

**Returns:** `Promise<string>` - Git tree OID

##### readBlob

```javascript
await port.readBlob(oid, maxBytes);
```

Reads a Git blob.

**Parameters:**

- `oid`: `string` - Git blob OID
- `maxBytes` (optional): positive integer per-call safety limit for adapters
  that support bounded blob reads

**Returns:** `Promise<Uint8Array>` - Blob content

##### readBlobStream

```javascript
await port.readBlobStream(oid);
```

Reads a Git blob as an async stream of `Uint8Array` chunks.

For custom persistence adapters, this method is required for hard-limited
buffered restore modes such as `whole` encrypted restore and buffered
compression restore. `readBlob()` remains a compatibility fallback for
plaintext restore only.

**Parameters:**

- `oid`: `string` - Git blob OID

**Returns:** `Promise<AsyncIterable<Uint8Array>>` - Blob byte stream

##### readTree

```javascript
await port.readTree(treeOid);
```

Reads a Git tree object.

**Parameters:**

- `treeOid`: `string` - Git tree OID

**Returns:** `Promise<Array<{ mode: string, type: string, oid: string, name: string }>>`

##### readObjectType

```javascript
await port.readObjectType(oid);
```

Reads an object's Git type without materializing its content. Root sets use
this capability to reject missing targets and type mismatches before changing
a ref.

**Returns:** `Promise<string>` - Git object type such as `blob`, `tree`, or
`commit`

**Example Implementation:**

```javascript
class CustomGitAdapter {
  async writeBlob(content) {
    // Implementation
  }

  async writeTree(entries) {
    // Implementation
  }

  async readBlobStream(oid) {
    // Implementation
  }

  async readBlob(oid) {
    // Implementation
  }

  async readTree(treeOid) {
    // Implementation
  }

  async readObjectType(oid) {
    // Implementation
  }
}
```

### RepositoryInspectionPort

The domain-facing, non-mutating port behind repository doctor. Its Git adapter
streams all-object metadata, reachable OIDs, dry-run-prunable loose objects,
and refs, and obtains the aggregate reachable object disk usage. Application
code normally uses `cas.diagnostics.doctor()` instead of this low-level port.

```javascript
for await (const object of port.iterateObjects()) {
  console.log(object.oid, object.type, object.logicalBytes, object.physicalBytes);
}

for await (const oid of port.iterateReachableObjectIds()) {
  // refs and reflogs both contribute
}

for await (const object of port.iteratePrunableObjects({ expiresBefore })) {
  // safe dry-run evidence only
}
```

`GitRepositoryInspectionAdapter` requires `@git-stunts/plumbing` 3.1.0 or
newer. Structured Git output is validated strictly; malformed records or a
non-zero stream status fail with `REPOSITORY_INSPECTION_INVALID`.

### CodecPort

Interface for encoding/decoding manifest data.

#### Methods

##### encode

```javascript
port.encode(data);
```

Encodes data to bytes.

**Parameters:**

- `data`: `Object` - Data to encode

**Returns:** `Uint8Array` - Encoded data

##### decode

```javascript
port.decode(buffer);
```

Decodes data from bytes.

**Parameters:**

- `buffer`: `Uint8Array` - Encoded data

**Returns:** `Object` - Decoded data

#### Properties

##### extension

```javascript
port.extension;
```

File extension for this codec (e.g., 'json', 'cbor').

**Returns:** `string`

**Example Implementation:**

```javascript
class XmlCodec {
  encode(data) {
    return new TextEncoder().encode(convertToXml(data));
  }

  decode(buffer) {
    return parseXml(new TextDecoder().decode(buffer));
  }

  get extension() {
    return 'xml';
  }
}
```

### CryptoPort

Interface for cryptographic operations.

#### Methods

##### sha256

```javascript
port.sha256(buf);
```

Computes SHA-256 hash.

**Parameters:**

- `buf`: `Uint8Array` - Data to hash

**Returns:** `Promise<string>` - 64-character hex digest

##### randomBytes

```javascript
port.randomBytes(n);
```

Generates cryptographically random bytes.

**Parameters:**

- `n`: `number` - Number of bytes

**Returns:** `Uint8Array` - Random bytes

##### encryptBuffer

```javascript
port.encryptBuffer(buffer, key, aad);
```

Encrypts a buffer using AES-256-GCM.

**Parameters:**

- `buffer`: `Uint8Array` - Data to encrypt
- `key`: `Uint8Array` - 32-byte encryption key
- `aad` (optional): `Uint8Array` - Additional authenticated data (AAD)

**Returns:** `{ buf: Uint8Array, meta: { algorithm: string, nonce: string, tag: string, encrypted: boolean } } | Promise<...>`

##### decryptBuffer

```javascript
port.decryptBuffer(buffer, key, meta, aad);
```

Decrypts a buffer using AES-256-GCM.

**Parameters:**

- `buffer`: `Uint8Array` - Encrypted data
- `key`: `Uint8Array` - 32-byte encryption key
- `meta`: `Object` - Encryption metadata with `algorithm`, `nonce`, `tag`, `encrypted`
- `aad` (optional): `Uint8Array` - Additional authenticated data (AAD). Must match the AAD used during encryption

**Returns:** `Uint8Array | Promise<Uint8Array>` - Decrypted data

**Throws:** On authentication failure

##### createEncryptionStream

```javascript
port.createEncryptionStream(key, aad);
```

Creates a streaming encryption context.

**Parameters:**

- `key`: `Uint8Array` - 32-byte encryption key
- `aad` (optional): `Uint8Array` - Additional authenticated data (AAD)

**Returns:** `{ encrypt: Function, finalize: Function }`

- `encrypt`: `(source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>` - Transform function
- `finalize`: `() => { algorithm: string, nonce: string, tag: string, encrypted: boolean }` - Get metadata

##### createDecryptionStream

```javascript
port.createDecryptionStream(key, meta, aad);
```

Creates a streaming decryption context. The returned stream may yield tentative plaintext before final auth succeeds, so callers must control publication semantics themselves.

**Parameters:**

- `key`: `Uint8Array` - 32-byte encryption key
- `meta`: `Object` - Encryption metadata from the encrypt operation
- `aad` (optional): `Uint8Array` - Additional authenticated data (AAD). Must match the AAD used during encryption

**Returns:** `{ decrypt: Function }`

- `decrypt`: `(source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>` - Transform function

##### hmacSha256

```javascript
port.hmacSha256(key, data);
```

Computes HMAC-SHA256 of the given data with the given key.

**Parameters:**

- `key`: `Uint8Array` - HMAC key
- `data`: `Uint8Array` - Data to authenticate

**Returns:** `Uint8Array` - 32-byte HMAC digest

##### encryptBufferWithNonce

```javascript
port.encryptBufferWithNonce(buffer, key, nonce);
```

Encrypts a buffer using AES-256-GCM with a caller-provided nonce. Used by convergent encryption where the nonce must be deterministic (derived from content hash) to enable deduplication.

**Parameters:**

- `buffer`: `Uint8Array` - Plaintext to encrypt
- `key`: `Uint8Array` - 32-byte encryption key
- `nonce`: `Uint8Array` - 12-byte nonce (IV)

**Returns:** `{ buf: Uint8Array, tag: Uint8Array } | Promise<{ buf: Uint8Array, tag: Uint8Array }>`

##### decryptBufferWithNonceTag

```javascript
port.decryptBufferWithNonceTag(buffer, key, nonce, tag);
```

Decrypts a buffer using AES-256-GCM with explicit nonce and tag. Used by convergent encryption to decrypt per-chunk ciphertext where the nonce and tag are stored/derived externally.

**Parameters:**

- `buffer`: `Uint8Array` - Ciphertext to decrypt
- `key`: `Uint8Array` - 32-byte encryption key
- `nonce`: `Uint8Array` - 12-byte nonce (IV)
- `tag`: `Uint8Array` - 16-byte GCM authentication tag

**Returns:** `Uint8Array | Promise<Uint8Array>`

**Throws:** On authentication failure

##### deriveKey

```javascript
await port.deriveKey(options);
```

Derives an encryption key from a passphrase using PBKDF2 or scrypt. PBKDF2 is
available across Node, Bun, and Web Crypto runtimes. scrypt requires a
Node/Bun-compatible crypto adapter; Web Crypto runtimes report an explicit
capability error.

**Parameters:**

- `options.passphrase`: `string` - The passphrase
- `options.salt` (optional): `Uint8Array` - Salt (random if omitted)
- `options.algorithm` (optional): `'pbkdf2' | 'scrypt'` - KDF algorithm (default: `'pbkdf2'`)
- `options.iterations` (optional): `number` - PBKDF2 iterations (default: `600000`)
- `options.cost` (optional): `number` - scrypt cost N (default: `131072`)
- `options.blockSize` (optional): `number` - scrypt block size r
- `options.parallelization` (optional): `number` - scrypt parallelization p
- `options.keyLength` (optional): `number` - Derived key length (default: 32)

`deriveKey()` is the raw derivation primitive. Policy enforcement for persisted
KDF metadata happens in `store()`, `restore()`, `initVault()`, and
`rotateVaultPassphrase()`.

**Returns:** `Promise<{ key: Uint8Array, salt: Uint8Array, params: Object }>`

**Example Implementation:**

```javascript
import { CryptoPort } from '@git-stunts/git-cas';

class CustomCryptoAdapter extends CryptoPort {
  sha256(buf) {
    // Implementation — returns Promise<string>
  }

  randomBytes(n) {
    // Implementation
  }

  encryptBuffer(buffer, key, aad) {
    // Implementation
  }

  decryptBuffer(buffer, key, meta, aad) {
    // Implementation
  }

  createEncryptionStream(key, aad) {
    // Implementation
  }

  createDecryptionStream(key, meta, aad) {
    // Implementation
  }

  hmacSha256(key, data) {
    // Implementation
  }

  encryptBufferWithNonce(buffer, key, nonce) {
    // Implementation
  }

  decryptBufferWithNonceTag(buffer, key, nonce, tag) {
    // Implementation
  }

  async deriveKey(options) {
    // Implementation
  }
}
```

## Codecs

Built-in codec implementations.

### JsonCodec

JSON codec for manifest serialization.

```javascript
import { JsonCodec } from '@git-stunts/git-cas';

const codec = new JsonCodec();
const encoded = codec.encode({ key: 'value' });
const decoded = codec.decode(encoded);
console.log(codec.extension); // 'json'
```

### CborCodec

CBOR codec for compact binary serialization.

```javascript
import { CborCodec } from '@git-stunts/git-cas';

const codec = new CborCodec();
const encoded = codec.encode({ key: 'value' });
const decoded = codec.decode(encoded);
console.log(codec.extension); // 'cbor'
```

## Error Codes

All errors thrown by git-cas are instances of `CasError`.

### CasError

`CasError` is the runtime error class and is re-exported from the package root.
Public callers should branch on the stable `code` field; `documentationUrl` is
present when an error has a canonical docs page.

#### Constructor

```javascript
new CasError(message, code, meta);
new CasError({ message, code, meta, documentationUrl });
```

**Parameters:**

- `message`: `string` - Error message
- `code`: `string` - Error code (see below)
- `meta`: `Object` - Additional error context (default: `{}`)
- `documentationUrl`: `string` - Optional documentation URL

#### Fields

- `name`: `string` - Always "CasError"
- `message`: `string` - Error message
- `code`: `string` - Error code
- `meta`: `Object` - Additional context
- `documentationUrl`: `string | undefined` - Optional documentation URL
- `stack`: `string` - Stack trace

### Error Codes

| Code                                  | Description                                                                                                        | Thrown By                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `INVALID_KEY_TYPE`                    | Encryption key must be a Uint8Array                                                                                | `encrypt()`, `decrypt()`, `store()`, `restore()`                                |
| `INVALID_KEY_LENGTH`                  | Encryption key must be exactly 32 bytes                                                                            | `encrypt()`, `decrypt()`, `store()`, `restore()`                                |
| `MISSING_KEY`                         | Encryption key required to restore encrypted content but none was provided                                         | `restore()`                                                                     |
| `INTEGRITY_ERROR`                     | Chunk digest verification failed or decryption authentication failed                                               | `restore()`, `verifyIntegrity()`, `decrypt()`                                   |
| `PERSISTENCE_CAPABILITY_REQUIRED`     | Buffered restore mode requires `readBlobStream()` so `maxRestoreBufferSize` can be enforced with memory-safe reads | `restore()`, `restoreStream()`                                                  |
| `DECRYPTION_BUFFER_EXCEEDED`          | Web Crypto whole-object decrypt exceeded the configured buffer limit                                               | `createDecryptionStream()` via Web Crypto restore paths                         |
| `KDF_POLICY_VIOLATION`                | KDF parameters fell outside the accepted policy window                                                             | `store()`, `restore()`, `initVault()`, `rotateVaultPassphrase()`, `readState()` |
| `STREAM_ERROR`                        | Stream error occurred during store operation                                                                       | `store()`                                                                       |
| `STORE_ERROR`                         | Chunk write failed during store after dispatch                                                                     | `store()`                                                                       |
| `MANIFEST_NOT_FOUND`                  | No manifest entry found in the Git tree                                                                            | `readManifest()`, `inspectAsset()`, `collectReferencedChunks()`                 |
| `GIT_ERROR`                           | Underlying Git plumbing command failed                                                                             | `readManifest()`, `inspectAsset()`, `collectReferencedChunks()`                 |
| `GIT_REF_NOT_FOUND`                   | Git ref lookup found no ref; vault reads normalize this to empty state                                             | `GitRefAdapter`, `VaultPersistence`                                             |
| `INVALID_OPTIONS`                     | Mutually exclusive options provided or unsupported option value                                                    | `store()`, `restore()`                                                          |
| `HANDLE_INVALID`                      | Handle object, canonical token, or staged result is malformed or unsupported                                       | Application handles and staged results                                          |
| `HANDLE_KIND_MISMATCH`                | A handle has a valid envelope but the wrong content kind                                                           | Handle parsing and application storage                                          |
| `HANDLE_CODEC_MISMATCH`               | Handle manifest codec differs from the active CAS codec                                                            | `assets.open()`, `assets.adopt()`, retention, publication                       |
| `HANDLE_TARGET_MISSING`               | The repository does not contain the complete object graph referenced by a handle                                   | `assets.open()`, `assets.adopt()`, retention, publication                       |
| `HANDLE_TARGET_TYPE_MISMATCH`         | A handle root or referenced object has the wrong Git object type                                                   | Application storage validation                                                  |
| `PAGE_TOO_LARGE`                      | Page input or imported page blob exceeds the effective byte bound                                                  | `pages.put()`, `pages.get()`, `pages.open()`                                    |
| `BUNDLE_CORRUPT`                      | Persisted bundle descriptors, edges, ranges, or target summaries disagree                                          | Bundle reads, retention, publication                                             |
| `BUNDLE_DESCRIPTOR_LIMIT`             | Bundle descriptor bytes exceed admission or repository read policy                                                 | Bundle construction and validation                                               |
| `BUNDLE_DUPLICATE_PATH`               | Two ordered bundle members use the same canonical path                                                             | `bundles.putOrdered()`                                                           |
| `BUNDLE_FANOUT_LIMIT`                 | Bundle tree width, depth, or nesting exceeds policy                                                                | Bundle construction and validation                                               |
| `BUNDLE_LIMIT_INVALID`                | Configured or per-operation bundle limits are malformed or attempt to raise repository policy                     | Facade construction, bundle writes                                               |
| `BUNDLE_MEMBER_INVALID`               | Bundle member input or resolved handle target is invalid                                                           | Bundle construction                                                              |
| `BUNDLE_MEMBER_LIMIT`                 | Bundle member count exceeds admission or repository read policy                                                    | Bundle construction and validation                                               |
| `BUNDLE_MEMBER_NOT_FOUND`             | Requested bundle member path is absent                                                                             | `bundles.openMember()`                                                           |
| `BUNDLE_MEMBER_NOT_STREAMABLE`        | Requested member is a nested structured bundle rather than bytes                                                   | `bundles.openMember()`                                                           |
| `BUNDLE_MEMBER_ORDER`                 | Ordered bundle input is not strictly increasing by canonical path                                                  | `bundles.putOrdered()`                                                           |
| `BUNDLE_PATH_INVALID`                 | Bundle member path is empty, unsafe, or non-canonical                                                              | Bundle writes and reads                                                          |
| `BUNDLE_PATH_LIMIT`                   | Bundle member path exceeds its UTF-8 byte bound                                                                    | Bundle construction and validation                                               |
| `COLLECTION_NAMESPACE_INVALID`        | Managed collection namespace or cache ref is not canonical                                                         | `caches.open()`                                                                  |
| `CACHE_KEY_INVALID`                   | Cache key is empty, non-canonical, too large, or contains controls                                                  | CacheSet key operations                                                          |
| `CACHE_ENTRY_INVALID`                 | Entry metadata, retention, expiry, handle identity, or key digest is invalid                                       | CacheSet writes and reads                                                        |
| `CACHE_STATE_INVALID`                 | Cache state, structured index, counts, or namespace is inconsistent                                                | CacheSet reads, `doctor()`, and `repair()`                                       |
| `CACHE_POLICY_INVALID`                | Cache entry, byte, access-resolution, or repair bound is invalid                                                    | `caches.open()`, CacheSet policy operations                                      |
| `CACHE_LOGICAL_SIZE_UNKNOWN`          | A target has no deterministic safe-integer logical size                                                            | `put()`, `replace()`, accounting, and repair                                     |
| `CACHE_CONFLICT`                      | Concurrent cache update exhausted bounded compare-and-swap retries                                                 | CacheSet mutations and repair                                                    |
| `RETENTION_WITNESS_INVALID`           | Witness policy, reachability, root evidence, generation, or timestamp is invalid                                   | `RetentionWitness`                                                              |
| `PUBLICATION_INVALID`                 | Publication message, parent list, expected head, dependency, or clock input is invalid                             | `publications.commit()`                                                         |
| `PUBLICATION_REF_FORBIDDEN`           | Target ref is invalid, reserved, or outside configured application namespaces                                      | `publications.commit()`                                                         |
| `PUBLICATION_CONFLICT`                | Application ref head differs from the explicit expected head                                                       | `publications.commit()`                                                         |
| `PUBLICATION_REF_UPDATE_FAILED`       | Application ref update or post-failure head observation failed for a non-conflict reason                           | `publications.commit()`                                                         |
| `INVALID_SLUG`                        | Slug fails validation (empty, control chars, `..` segments, etc.)                                                  | `addToVault()`                                                                  |
| `ROOT_SET_REF_INVALID`                | Ref is outside `refs/cas/rootsets/*` or is not a safe Git ref                                                      | `rootSets.open()`                                                               |
| `ROOT_SET_ENTRY_INVALID`              | Entry name, OID, type, retention, or duplicate-name validation failed                                              | `put()`, `replace()`, `mutate()`, `repair()`                                    |
| `ROOT_SET_TARGET_MISSING`             | A requested target OID does not exist                                                                              | `put()`, `replace()`, `mutate()`, `repair()`                                    |
| `ROOT_SET_TARGET_UNREADABLE`          | Git could not inspect a target, but did not prove that it was missing                                              | Root-set mutation and doctor                                                    |
| `ROOT_SET_TARGET_TYPE_MISMATCH`       | Declared blob/tree type does not match the Git object                                                              | `put()`, `replace()`, `mutate()`, `repair()`                                    |
| `ROOT_SET_CONFLICT`                   | Concurrent root-set update exhausted bounded compare-and-swap retries                                              | Root-set mutations and repair                                                   |
| `ROOT_SET_HEAD_INVALID`               | Root-set ref cannot resolve to a readable commit tree                                                              | `read()`, `list()`, `doctor()`                                                  |
| `ROOT_SET_METADATA_INVALID`           | `.rootset.json` is malformed, non-canonical, or belongs to another ref                                             | `read()`, `list()`, `doctor()`                                                  |
| `ROOT_SET_TREE_INVALID`               | Metadata and the Git tree's actual reachability edges disagree                                                     | `read()`, `list()`, `doctor()`                                                  |
| `ROOT_SET_REF_UPDATE_FAILED`          | Root-set ref update failed for a non-conflict reason                                                               | Root-set mutations and repair                                                   |
| `REPOSITORY_INSPECTION_INVALID`       | Repository doctor options, Git output, dependencies, or safe-integer totals are invalid                            | `cas.diagnostics.doctor()`, repository inspection adapter                       |
| `VAULT_ENTRY_NOT_FOUND`               | Slug does not exist in vault                                                                                       | `removeFromVault()`, `resolveVaultEntry()`                                      |
| `VAULT_ENTRY_EXISTS`                  | Slug already exists (use `force` to overwrite)                                                                     | `addToVault()`                                                                  |
| `VAULT_CONFLICT`                      | Concurrent vault update detected (CAS failure after retries)                                                       | `addToVault()`, `removeFromVault()`, `initVault()`, `rotateVaultPassphrase()`   |
| `VAULT_REF_MISSING`                   | Vault ref is absent during diagnostics                                                                             | `git cas doctor`                                                                |
| `VAULT_REF_UPDATE_FAILED`             | Vault ref update failed for a non-CAS reason                                                                       | `addToVault()`, `removeFromVault()`, `initVault()`, `rotateVaultPassphrase()`   |
| `VAULT_HEAD_INVALID`                  | Vault ref exists but cannot be resolved to a readable commit tree                                                  | `readState()`, `getVaultMetadata()`, `git cas doctor`                           |
| `VAULT_METADATA_INVALID`              | `.vault.json` malformed, unknown version, unsupported cipher, or missing required fields                           | `readState()`, `rotateVaultPassphrase()`, `git cas doctor`                      |
| `VAULT_PRIVACY_INDEX_INVALID`         | Privacy index metadata, payload, or raw HMAC tree coverage is invalid                                              | `readState()`, `listVault()`, `resolveVaultEntry()`, `git cas doctor`           |
| `VAULT_PRIVACY_INDEX_MISSING`         | Privacy mode is enabled but `.privacy-index` is missing                                                            | `readState()`, `listVault()`, `git cas doctor`                                  |
| `VAULT_PRIVACY_KEY_REQUIRED`          | Privacy mode requires a vault encryption key for state reads                                                       | `readState()`, `listVault()`, `resolveVaultEntry()`                             |
| `VAULT_ENCRYPTION_ALREADY_CONFIGURED` | Cannot reconfigure encryption without key rotation                                                                 | `initVault()`                                                                   |
| `NO_MATCHING_RECIPIENT`               | No recipient entry matches the provided KEK                                                                        | `restore()`, `rotateKey()`                                                      |
| `DEK_UNWRAP_FAILED`                   | Failed to unwrap DEK with the provided KEK                                                                         | `addRecipient()`, `rotateKey()`                                                 |
| `RECIPIENT_NOT_FOUND`                 | Recipient label not found in manifest                                                                              | `removeRecipient()`, `rotateKey()`                                              |
| `RECIPIENT_ALREADY_EXISTS`            | Recipient label already exists                                                                                     | `addRecipient()`                                                                |
| `CANNOT_REMOVE_LAST_RECIPIENT`        | Cannot remove the last recipient                                                                                   | `removeRecipient()`                                                             |
| `ROTATION_NOT_SUPPORTED`              | Key rotation requires envelope encryption (recipients)                                                             | `rotateKey()`                                                                   |

### Error Handling

**Example:**

```javascript
try {
  await cas.restore({ manifest, encryptionKey });
} catch (err) {
  if (err && typeof err === 'object' && 'code' in err) {
    console.error('CAS Error:', err.code);
    console.error('Message:', err.message);
    console.error('Meta:', err.meta);

    switch (err.code) {
      case 'MISSING_KEY':
        console.log('Content is encrypted - please provide a key');
        break;
      case 'INTEGRITY_ERROR':
        console.log('Content verification failed - may be corrupted');
        break;
      case 'INVALID_KEY_LENGTH':
        console.log('Key must be 32 bytes');
        break;
    }
  } else {
    throw err;
  }
}
```

### Error Metadata

Different error codes include different metadata:

**INVALID_KEY_LENGTH:**

```javascript
{
  expected: 32,
  actual: <number>
}
```

**INTEGRITY_ERROR (chunk verification):**

```javascript
{
  chunkIndex: <number>,
  expected: <string>,  // Expected SHA-256 digest
  actual: <string>     // Actual SHA-256 digest
}
```

**INTEGRITY_ERROR (decryption):**

```javascript
{
  originalError: <Error>
}
```

**STREAM_ERROR:**

```javascript
{
  chunksDispatched: <number>,
  orphanedBlobs: <string[]>,
  originalError: <Error>
}
```

**STORE_ERROR:**

```javascript
{
  chunksDispatched: <number>,
  orphanedBlobs: <string[]>,
  failedIndex: <number>,
  originalError: <Error>
}
```
