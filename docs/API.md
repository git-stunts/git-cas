# API Reference

This document provides the complete API reference for git-cas.

## Table of Contents

1. [ContentAddressableStore](#contentaddressablestore)
2. [CasService](#casservice)
3. [Events](#events)
4. [Value Objects](#value-objects)
5. [Ports](#ports)
6. [Codecs](#codecs)
7. [Error Codes](#error-codes)

## ContentAddressableStore

The main facade class providing high-level API for content-addressable storage.

### Constructor

```javascript
new ContentAddressableStore(options)
```

**Parameters:**

- `options.plumbing` (required): Plumbing instance from `@git-stunts/plumbing`
- `options.chunkSize` (optional): Chunk size in bytes (default: 262144 / 256 KiB)
- `options.codec` (optional): CodecPort implementation (default: JsonCodec)
- `options.crypto` (optional): CryptoPort implementation (default: auto-detected)
- `options.policy` (optional): Resilience policy from `@git-stunts/alfred` for Git I/O
- `options.merkleThreshold` (optional): Chunk count threshold for Merkle manifests (default: 1000)

**Example:**

```javascript
import ContentAddressableStore from 'git-cas';
import Plumbing from '@git-stunts/plumbing';

const plumbing = await Plumbing.create({ repoPath: '/path/to/repo' });
const cas = new ContentAddressableStore({ plumbing });
```

### Factory Methods

#### createJson

```javascript
ContentAddressableStore.createJson({ plumbing, chunkSize, policy })
```

Creates a CAS instance with JSON codec.

**Parameters:**

- `plumbing` (required): Plumbing instance
- `chunkSize` (optional): Chunk size in bytes
- `policy` (optional): Resilience policy

**Returns:** `ContentAddressableStore`

**Example:**

```javascript
const cas = ContentAddressableStore.createJson({ plumbing });
```

#### createCbor

```javascript
ContentAddressableStore.createCbor({ plumbing, chunkSize, policy })
```

Creates a CAS instance with CBOR codec.

**Parameters:**

- `plumbing` (required): Plumbing instance
- `chunkSize` (optional): Chunk size in bytes
- `policy` (optional): Resilience policy

**Returns:** `ContentAddressableStore`

**Example:**

```javascript
const cas = ContentAddressableStore.createCbor({ plumbing });
```

### Methods

#### getService

```javascript
await cas.getService()
```

Lazily initializes and returns the underlying CasService instance.

**Returns:** `Promise<CasService>`

**Example:**

```javascript
const service = await cas.getService();
```

#### store

```javascript
await cas.store({ source, slug, filename, encryptionKey, passphrase, kdfOptions, compression })
```

Stores content from an async iterable source.

**Parameters:**

- `source` (required): `AsyncIterable<Buffer>` - Content stream
- `slug` (required): `string` - Unique identifier for the asset
- `filename` (required): `string` - Original filename
- `encryptionKey` (optional): `Buffer` - 32-byte encryption key
- `passphrase` (optional): `string` - Derive encryption key from passphrase (alternative to `encryptionKey`)
- `kdfOptions` (optional): `Object` - KDF options when using `passphrase` (`{ algorithm, iterations, cost, ... }`)
- `compression` (optional): `{ algorithm: 'gzip' }` - Enable compression before encryption/chunking

**Returns:** `Promise<Manifest>`

**Throws:**

- `CasError` with code `INVALID_KEY_TYPE` if encryptionKey is not a Buffer
- `CasError` with code `INVALID_KEY_LENGTH` if encryptionKey is not 32 bytes
- `CasError` with code `STREAM_ERROR` if the source stream fails

**Example:**

```javascript
import { createReadStream } from 'node:fs';

const stream = createReadStream('/path/to/file.txt');
const manifest = await cas.store({
  source: stream,
  slug: 'my-asset',
  filename: 'file.txt'
});
```

#### storeFile

```javascript
await cas.storeFile({ filePath, slug, filename, encryptionKey })
```

Convenience method that opens a file and stores it.

**Parameters:**

- `filePath` (required): `string` - Path to file
- `slug` (required): `string` - Unique identifier for the asset
- `filename` (optional): `string` - Filename (defaults to basename of filePath)
- `encryptionKey` (optional): `Buffer` - 32-byte encryption key
- `passphrase` (optional): `string` - Derive encryption key from passphrase
- `kdfOptions` (optional): `Object` - KDF options when using `passphrase`
- `compression` (optional): `{ algorithm: 'gzip' }` - Enable compression

**Returns:** `Promise<Manifest>`

**Throws:** Same as `store()`

**Example:**

```javascript
const manifest = await cas.storeFile({
  filePath: '/path/to/file.txt',
  slug: 'my-asset'
});
```

#### restore

```javascript
await cas.restore({ manifest, encryptionKey, passphrase })
```

Restores content from a manifest and returns the buffer.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object
- `encryptionKey` (optional): `Buffer` - 32-byte encryption key (required if content is encrypted)
- `passphrase` (optional): `string` - Passphrase for KDF-based decryption (alternative to `encryptionKey`)

**Returns:** `Promise<{ buffer: Buffer, bytesWritten: number }>`

**Throws:**

- `CasError` with code `MISSING_KEY` if content is encrypted but no key provided
- `CasError` with code `INVALID_KEY_TYPE` if encryptionKey is not a Buffer
- `CasError` with code `INVALID_KEY_LENGTH` if encryptionKey is not 32 bytes
- `CasError` with code `INTEGRITY_ERROR` if chunk digest verification fails
- `CasError` with code `INTEGRITY_ERROR` if decryption fails

**Example:**

```javascript
const { buffer, bytesWritten } = await cas.restore({ manifest });
```

#### restoreFile

```javascript
await cas.restoreFile({ manifest, encryptionKey, outputPath })
```

Restores content from a manifest and writes it to a file.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object
- `encryptionKey` (optional): `Buffer` - 32-byte encryption key
- `passphrase` (optional): `string` - Passphrase for KDF-based decryption
- `outputPath` (required): `string` - Path to write the restored file

**Returns:** `Promise<{ bytesWritten: number }>`

**Throws:** Same as `restore()`

**Example:**

```javascript
await cas.restoreFile({
  manifest,
  outputPath: '/path/to/output.txt'
});
```

#### createTree

```javascript
await cas.createTree({ manifest })
```

Creates a Git tree object from a manifest.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object

**Returns:** `Promise<string>` - Git tree OID

**Example:**

```javascript
const treeOid = await cas.createTree({ manifest });
```

#### verifyIntegrity

```javascript
await cas.verifyIntegrity(manifest)
```

Verifies the integrity of stored content by re-hashing all chunks.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object

**Returns:** `Promise<boolean>` - True if all chunks pass verification

**Example:**

```javascript
const isValid = await cas.verifyIntegrity(manifest);
if (!isValid) {
  console.log('Integrity check failed');
}
```

#### readManifest

```javascript
await cas.readManifest({ treeOid })
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
console.log(manifest.slug);      // "photos/vacation"
console.log(manifest.chunks);    // array of Chunk objects
```

#### deleteAsset

```javascript
await cas.deleteAsset({ treeOid })
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
await cas.deriveKey(options)
```

Derives an encryption key from a passphrase using PBKDF2 or scrypt.

**Parameters:**

- `options.passphrase` (required): `string` - The passphrase
- `options.salt` (optional): `Buffer` - Salt (random if omitted)
- `options.algorithm` (optional): `'pbkdf2' | 'scrypt'` - KDF algorithm (default: `'pbkdf2'`)
- `options.iterations` (optional): `number` - PBKDF2 iterations (default: 100000)
- `options.cost` (optional): `number` - scrypt cost parameter N (default: 16384)
- `options.blockSize` (optional): `number` - scrypt block size r (default: 8)
- `options.parallelization` (optional): `number` - scrypt parallelization p (default: 1)
- `options.keyLength` (optional): `number` - Derived key length (default: 32)

**Returns:** `Promise<{ key: Buffer, salt: Buffer, params: Object }>`

- `key` — the derived 32-byte encryption key
- `salt` — the salt used (save this for re-derivation)
- `params` — full KDF parameters object (stored in manifest when using `passphrase` option)

**Example:**

```javascript
const { key, salt, params } = await cas.deriveKey({
  passphrase: 'my secret passphrase',
  algorithm: 'pbkdf2',
  iterations: 200000,
});

// Use the derived key for encryption
const manifest = await cas.storeFile({
  filePath: '/path/to/file.txt',
  slug: 'my-asset',
  encryptionKey: key,
});
```

#### findOrphanedChunks

```javascript
await cas.findOrphanedChunks({ treeOids })
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
  treeOids: [treeOid1, treeOid2, treeOid3]
});
console.log(`${referenced.size} unique blobs across ${total} total chunk references`);
```

#### encrypt

```javascript
await cas.encrypt({ buffer, key })
```

Encrypts a buffer using AES-256-GCM.

**Parameters:**

- `buffer` (required): `Buffer` - Data to encrypt
- `key` (required): `Buffer` - 32-byte encryption key

**Returns:** `Promise<{ buf: Buffer, meta: Object }>`

**Throws:**

- `CasError` with code `INVALID_KEY_TYPE` if key is not a Buffer
- `CasError` with code `INVALID_KEY_LENGTH` if key is not 32 bytes

**Example:**

```javascript
const { buf, meta } = await cas.encrypt({
  buffer: Buffer.from('secret data'),
  key: crypto.randomBytes(32)
});
```

#### decrypt

```javascript
await cas.decrypt({ buffer, key, meta })
```

Decrypts a buffer using AES-256-GCM.

**Parameters:**

- `buffer` (required): `Buffer` - Encrypted data
- `key` (required): `Buffer` - 32-byte encryption key
- `meta` (required): `Object` - Encryption metadata (from encrypt result)

**Returns:** `Promise<Buffer>` - Decrypted data

**Throws:**

- `CasError` with code `INTEGRITY_ERROR` if decryption fails

**Example:**

```javascript
const decrypted = await cas.decrypt({ buffer: buf, key, meta });
```

### Properties

#### chunkSize

```javascript
cas.chunkSize
```

Returns the configured chunk size in bytes.

**Type:** `number`

**Example:**

```javascript
console.log(cas.chunkSize); // 262144
```

## CasService

Core domain service implementing CAS operations. Usually accessed via ContentAddressableStore, but can be used directly for advanced scenarios.

### Constructor

```javascript
new CasService({ persistence, codec, crypto, chunkSize })
```

**Parameters:**

- `persistence` (required): `GitPersistencePort` implementation
- `codec` (required): `CodecPort` implementation
- `crypto` (required): `CryptoPort` implementation
- `chunkSize` (optional): `number` - Chunk size in bytes (default: 262144, minimum: 1024)
- `merkleThreshold` (optional): `number` - Chunk count threshold for Merkle manifests (default: 1000)

**Throws:** `Error` if chunkSize is less than 1024 bytes

**Example:**

```javascript
import CasService from 'git-cas/src/domain/services/CasService.js';
import GitPersistenceAdapter from 'git-cas/src/infrastructure/adapters/GitPersistenceAdapter.js';
import JsonCodec from 'git-cas/src/infrastructure/codecs/JsonCodec.js';
import NodeCryptoAdapter from 'git-cas/src/infrastructure/adapters/NodeCryptoAdapter.js';

const service = new CasService({
  persistence: new GitPersistenceAdapter({ plumbing }),
  codec: new JsonCodec(),
  crypto: new NodeCryptoAdapter(),
  chunkSize: 512 * 1024
});
```

### Methods

All methods from ContentAddressableStore delegate to CasService. See ContentAddressableStore documentation above for:

- `store({ source, slug, filename, encryptionKey })`
- `restore({ manifest, encryptionKey })`
- `createTree({ manifest })`
- `verifyIntegrity(manifest)`
- `readManifest({ treeOid })`
- `deleteAsset({ treeOid })`
- `findOrphanedChunks({ treeOids })`
- `encrypt({ buffer, key })`
- `decrypt({ buffer, key, meta })`

### EventEmitter

CasService extends Node.js EventEmitter. See [Events](#events) section for all emitted events.

## Events

CasService emits the following events. Listen using standard EventEmitter API:

```javascript
const service = await cas.getService();
service.on('chunk:stored', (payload) => {
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
  slug: string        // Asset slug
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
new Manifest(data)
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
      blob: 'abc123def456'
    }
  ]
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
manifest.toJSON()
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
new Chunk(data)
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
  blob: 'abc123def456'
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
await port.writeBlob(content)
```

Writes content as a Git blob.

**Parameters:**

- `content`: `Buffer | string` - Content to store

**Returns:** `Promise<string>` - Git blob OID

##### writeTree

```javascript
await port.writeTree(entries)
```

Creates a Git tree object.

**Parameters:**

- `entries`: `Array<string>` - Git mktree format lines (e.g., `"100644 blob <oid>\t<name>"`)

**Returns:** `Promise<string>` - Git tree OID

##### readBlob

```javascript
await port.readBlob(oid)
```

Reads a Git blob.

**Parameters:**

- `oid`: `string` - Git blob OID

**Returns:** `Promise<Buffer>` - Blob content

##### readTree

```javascript
await port.readTree(treeOid)
```

Reads a Git tree object.

**Parameters:**

- `treeOid`: `string` - Git tree OID

**Returns:** `Promise<Array<{ mode: string, type: string, oid: string, name: string }>>`

**Example Implementation:**

```javascript
import GitPersistencePort from 'git-cas/src/ports/GitPersistencePort.js';

class CustomGitAdapter extends GitPersistencePort {
  async writeBlob(content) {
    // Implementation
  }

  async writeTree(entries) {
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
port.encode(data)
```

Encodes data to Buffer or string.

**Parameters:**

- `data`: `Object` - Data to encode

**Returns:** `Buffer | string` - Encoded data

##### decode

```javascript
port.decode(buffer)
```

Decodes data from Buffer or string.

**Parameters:**

- `buffer`: `Buffer | string` - Encoded data

**Returns:** `Object` - Decoded data

#### Properties

##### extension

```javascript
port.extension
```

File extension for this codec (e.g., 'json', 'cbor').

**Returns:** `string`

**Example Implementation:**

```javascript
import CodecPort from 'git-cas/src/ports/CodecPort.js';

class XmlCodec extends CodecPort {
  encode(data) {
    return convertToXml(data);
  }

  decode(buffer) {
    return parseXml(buffer.toString('utf8'));
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
port.sha256(buf)
```

Computes SHA-256 hash.

**Parameters:**

- `buf`: `Buffer` - Data to hash

**Returns:** `string` - 64-character hex digest

##### randomBytes

```javascript
port.randomBytes(n)
```

Generates cryptographically random bytes.

**Parameters:**

- `n`: `number` - Number of bytes

**Returns:** `Buffer` - Random bytes

##### encryptBuffer

```javascript
port.encryptBuffer(buffer, key)
```

Encrypts a buffer using AES-256-GCM.

**Parameters:**

- `buffer`: `Buffer` - Data to encrypt
- `key`: `Buffer` - 32-byte encryption key

**Returns:** `{ buf: Buffer, meta: { algorithm: string, nonce: string, tag: string, encrypted: boolean } }`

##### decryptBuffer

```javascript
port.decryptBuffer(buffer, key, meta)
```

Decrypts a buffer using AES-256-GCM.

**Parameters:**

- `buffer`: `Buffer` - Encrypted data
- `key`: `Buffer` - 32-byte encryption key
- `meta`: `Object` - Encryption metadata with `algorithm`, `nonce`, `tag`, `encrypted`

**Returns:** `Buffer` - Decrypted data

**Throws:** On authentication failure

##### createEncryptionStream

```javascript
port.createEncryptionStream(key)
```

Creates a streaming encryption context.

**Parameters:**

- `key`: `Buffer` - 32-byte encryption key

**Returns:** `{ encrypt: Function, finalize: Function }`

- `encrypt`: `(source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>` - Transform function
- `finalize`: `() => { algorithm: string, nonce: string, tag: string, encrypted: boolean }` - Get metadata

##### deriveKey

```javascript
await port.deriveKey(options)
```

Derives an encryption key from a passphrase using PBKDF2 or scrypt.

**Parameters:**

- `options.passphrase`: `string` - The passphrase
- `options.salt` (optional): `Buffer` - Salt (random if omitted)
- `options.algorithm` (optional): `'pbkdf2' | 'scrypt'` - KDF algorithm (default: `'pbkdf2'`)
- `options.iterations` (optional): `number` - PBKDF2 iterations
- `options.cost` (optional): `number` - scrypt cost N
- `options.blockSize` (optional): `number` - scrypt block size r
- `options.parallelization` (optional): `number` - scrypt parallelization p
- `options.keyLength` (optional): `number` - Derived key length (default: 32)

**Returns:** `Promise<{ key: Buffer, salt: Buffer, params: Object }>`

**Example Implementation:**

```javascript
import CryptoPort from 'git-cas/src/ports/CryptoPort.js';

class CustomCryptoAdapter extends CryptoPort {
  sha256(buf) {
    // Implementation
  }

  randomBytes(n) {
    // Implementation
  }

  encryptBuffer(buffer, key) {
    // Implementation
  }

  decryptBuffer(buffer, key, meta) {
    // Implementation
  }

  createEncryptionStream(key) {
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
import { JsonCodec } from 'git-cas';

const codec = new JsonCodec();
const encoded = codec.encode({ key: 'value' });
const decoded = codec.decode(encoded);
console.log(codec.extension); // 'json'
```

### CborCodec

CBOR codec for compact binary serialization.

```javascript
import { CborCodec } from 'git-cas';

const codec = new CborCodec();
const encoded = codec.encode({ key: 'value' });
const decoded = codec.decode(encoded);
console.log(codec.extension); // 'cbor'
```

## Error Codes

All errors thrown by git-cas are instances of `CasError`.

### CasError

```javascript
import CasError from 'git-cas/src/domain/errors/CasError.js';
```

#### Constructor

```javascript
new CasError(message, code, meta)
```

**Parameters:**

- `message`: `string` - Error message
- `code`: `string` - Error code (see below)
- `meta`: `Object` - Additional error context (default: `{}`)

#### Fields

- `name`: `string` - Always "CasError"
- `message`: `string` - Error message
- `code`: `string` - Error code
- `meta`: `Object` - Additional context
- `stack`: `string` - Stack trace

### Error Codes

| Code | Description | Thrown By |
|------|-------------|-----------|
| `INVALID_KEY_TYPE` | Encryption key must be a Buffer or Uint8Array | `encrypt()`, `decrypt()`, `store()`, `restore()` |
| `INVALID_KEY_LENGTH` | Encryption key must be exactly 32 bytes | `encrypt()`, `decrypt()`, `store()`, `restore()` |
| `MISSING_KEY` | Encryption key required to restore encrypted content but none was provided | `restore()` |
| `INTEGRITY_ERROR` | Chunk digest verification failed or decryption authentication failed | `restore()`, `verifyIntegrity()`, `decrypt()` |
| `STREAM_ERROR` | Stream error occurred during store operation | `store()` |
| `MANIFEST_NOT_FOUND` | No manifest entry found in the Git tree | `readManifest()`, `deleteAsset()`, `findOrphanedChunks()` |
| `GIT_ERROR` | Underlying Git plumbing command failed | `readManifest()`, `deleteAsset()`, `findOrphanedChunks()` |

### Error Handling

**Example:**

```javascript
import CasError from 'git-cas/src/domain/errors/CasError.js';

try {
  await cas.restore({ manifest, encryptionKey });
} catch (err) {
  if (err instanceof CasError) {
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
  chunksWritten: <number>,
  originalError: <Error>
}
```
