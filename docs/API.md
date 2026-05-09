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
2. [Vault](#vault)
3. [CasService](#casservice)
4. [Events](#events)
5. [Value Objects](#value-objects)
6. [Ports](#ports)
7. [Codecs](#codecs)
8. [Error Codes](#error-codes)

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
- `options.maxBlobSize` (optional): Max bytes for manifest and sub-manifest blob reads (default: 10485760 / 10 MiB)
- `options.compressionAdapter` (optional): CompressionPort implementation (default: NodeCompressionAdapter)

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
await cas.store({ source, slug, filename, encryptionKey, passphrase, encryption, kdfOptions, compression, recipients, merkleThreshold });
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
`SECURITY_BOUNDARY_VIOLATION` if the resolved path escapes the base directory.

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

| Flag                          | Description                                             |
| ----------------------------- | ------------------------------------------------------- |
| `--old-passphrase <pass>`     | Current inline passphrase (warns; prefer file)          |
| `--new-passphrase <pass>`     | New inline passphrase (warns; prefer file)              |
| `--old-passphrase-file <path>` | Read current passphrase from file (`-` for stdin)      |
| `--new-passphrase-file <path>` | Read new passphrase from file (`-` for stdin)          |
| `--algorithm <alg>`           | KDF algorithm for new passphrase (`pbkdf2` or `scrypt`) |
| `--cwd <dir>`                 | Git working directory (default: `.`)                    |

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
new CasService({ persistence, codec, crypto, observability, chunkSize, merkleThreshold, concurrency, chunker, compressionAdapter, maxRestoreBufferSize, maxBlobSize, formatVersion, legacyMode });
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

- `store({ source, slug, filename, encryptionKey, passphrase, encryption, kdfOptions, compression, recipients })`
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
await port.readBlob(oid);
```

Reads a Git blob.

**Parameters:**

- `oid`: `string` - Git blob OID

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
}
```

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

| Code                                  | Description                                                                | Thrown By                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `INVALID_KEY_TYPE`                    | Encryption key must be a Uint8Array                              | `encrypt()`, `decrypt()`, `store()`, `restore()`                              |
| `INVALID_KEY_LENGTH`                  | Encryption key must be exactly 32 bytes                                    | `encrypt()`, `decrypt()`, `store()`, `restore()`                              |
| `MISSING_KEY`                         | Encryption key required to restore encrypted content but none was provided | `restore()`                                                                   |
| `INTEGRITY_ERROR`                     | Chunk digest verification failed or decryption authentication failed       | `restore()`, `verifyIntegrity()`, `decrypt()`                                 |
| `PERSISTENCE_CAPABILITY_REQUIRED`     | Buffered restore mode requires `readBlobStream()` so `maxRestoreBufferSize` can be enforced with memory-safe reads | `restore()`, `restoreStream()`                                              |
| `DECRYPTION_BUFFER_EXCEEDED`          | Web Crypto whole-object decrypt exceeded the configured buffer limit       | `createDecryptionStream()` via Web Crypto restore paths                       |
| `KDF_POLICY_VIOLATION`               | KDF parameters fell outside the accepted policy window                     | `store()`, `restore()`, `initVault()`, `rotateVaultPassphrase()`, `readState()` |
| `STREAM_ERROR`                        | Stream error occurred during store operation                               | `store()`                                                                     |
| `STORE_ERROR`                         | Chunk write failed during store after dispatch                             | `store()`                                                                     |
| `MANIFEST_NOT_FOUND`                  | No manifest entry found in the Git tree                                    | `readManifest()`, `inspectAsset()`, `collectReferencedChunks()`               |
| `GIT_ERROR`                           | Underlying Git plumbing command failed                                     | `readManifest()`, `inspectAsset()`, `collectReferencedChunks()`               |
| `INVALID_OPTIONS`                     | Mutually exclusive options provided or unsupported option value            | `store()`, `restore()`                                                        |
| `INVALID_SLUG`                        | Slug fails validation (empty, control chars, `..` segments, etc.)          | `addToVault()`                                                                |
| `VAULT_ENTRY_NOT_FOUND`               | Slug does not exist in vault                                               | `removeFromVault()`, `resolveVaultEntry()`                                    |
| `VAULT_ENTRY_EXISTS`                  | Slug already exists (use `force` to overwrite)                             | `addToVault()`                                                                |
| `VAULT_CONFLICT`                      | Concurrent vault update detected (CAS failure after retries)               | `addToVault()`, `removeFromVault()`, `initVault()`, `rotateVaultPassphrase()` |
| `VAULT_REF_MISSING`                   | Vault ref is absent during diagnostics                                     | `git cas doctor`                                                              |
| `VAULT_HEAD_INVALID`                  | Vault ref exists but cannot be resolved to a readable commit tree          | `readState()`, `getVaultMetadata()`, `git cas doctor`                         |
| `VAULT_METADATA_INVALID`              | `.vault.json` malformed, unknown version, unsupported cipher, or missing required fields | `readState()`, `rotateVaultPassphrase()`, `git cas doctor`                  |
| `VAULT_PRIVACY_INDEX_INVALID`         | Privacy index does not cover every raw HMAC tree entry                     | `readState()`, `listVault()`, `git cas doctor`                                |
| `VAULT_PRIVACY_INDEX_MISSING`         | Privacy mode is enabled but `.privacy-index` is missing                    | `readState()`, `listVault()`, `git cas doctor`                                |
| `VAULT_PRIVACY_KEY_REQUIRED`          | Privacy mode requires a vault encryption key for state reads               | `readState()`, `listVault()`, `resolveVaultEntry()`                           |
| `VAULT_ENCRYPTION_ALREADY_CONFIGURED` | Cannot reconfigure encryption without key rotation                         | `initVault()`                                                                 |
| `NO_MATCHING_RECIPIENT`               | No recipient entry matches the provided KEK                                | `restore()`, `rotateKey()`                                                    |
| `DEK_UNWRAP_FAILED`                   | Failed to unwrap DEK with the provided KEK                                 | `addRecipient()`, `rotateKey()`                                               |
| `RECIPIENT_NOT_FOUND`                 | Recipient label not found in manifest                                      | `removeRecipient()`, `rotateKey()`                                            |
| `RECIPIENT_ALREADY_EXISTS`            | Recipient label already exists                                             | `addRecipient()`                                                              |
| `CANNOT_REMOVE_LAST_RECIPIENT`        | Cannot remove the last recipient                                           | `removeRecipient()`                                                           |
| `ROTATION_NOT_SUPPORTED`              | Key rotation requires envelope encryption (recipients)                     | `rotateKey()`                                                                 |

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
