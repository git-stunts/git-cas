# API Reference

This document provides the complete API reference for git-cas.

For cryptographic design, nonce and KDF guidance, and security-relevant
implementation details, see [SECURITY.md](../SECURITY.md). For attacker models,
trust boundaries, exposed metadata, and explicit non-goals, see
[docs/THREAT_MODEL.md](./THREAT_MODEL.md).

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

### Constructor

```javascript
new ContentAddressableStore(options);
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
ContentAddressableStore.createJson({ plumbing, chunkSize, policy });
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
ContentAddressableStore.createCbor({ plumbing, chunkSize, policy });
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
await cas.getService();
```

Lazily initializes and returns the underlying CasService instance.

**Returns:** `Promise<CasService>`

**Example:**

```javascript
const service = await cas.getService();
```

#### store

```javascript
await cas.store({ source, slug, filename, encryptionKey, passphrase, encryption, kdfOptions, compression });
```

Stores content from an async iterable source.

**Parameters:**

- `source` (required): `AsyncIterable<Buffer>` - Content stream
- `slug` (required): `string` - Unique identifier for the asset
- `filename` (required): `string` - Original filename
- `encryptionKey` (optional): `Buffer` - 32-byte encryption key
- `passphrase` (optional): `string` - Derive encryption key from passphrase (alternative to `encryptionKey`)
- `encryption` (optional): `Object` - Explicit encryption mode selection for encrypted stores. If omitted, encrypted stores now default to `framed-v1`
- `encryption.scheme` (optional): `'whole-v1' | 'framed-v1'` - `whole-v1` is the explicit compatibility whole-object AES-GCM format; `framed-v1` stores independently authenticated frames so restore can stream verified plaintext incrementally and is now the default encrypted-write mode
- `encryption.frameBytes` (optional): `number` - Plaintext bytes per framed-v1 record (default `65536`)
- `kdfOptions` (optional): `Object` - KDF options when using `passphrase` (`{ algorithm, iterations, cost, ... }`). New passphrase stores default to PBKDF2 `600000` iterations or scrypt `N=131072`, and out-of-policy values fail with `KDF_POLICY_VIOLATION`
- `compression` (optional): `{ algorithm: 'gzip' }` - Enable compression before encryption/chunking

**Returns:** `Promise<Manifest>`

**Throws:**

- `CasError` with code `INVALID_KEY_TYPE` if encryptionKey is not a Buffer
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
});
```

Convenience method that opens a file and stores it.

**Parameters:**

- `filePath` (required): `string` - Path to file
- `slug` (required): `string` - Unique identifier for the asset
- `filename` (optional): `string` - Filename (defaults to basename of filePath)
- `encryptionKey` (optional): `Buffer` - 32-byte encryption key
- `passphrase` (optional): `string` - Derive encryption key from passphrase
- `encryption` (optional): `Object` - Explicit encryption mode selection for encrypted stores. If omitted, encrypted stores now default to `framed-v1`
- `encryption.scheme` (optional): `'whole-v1' | 'framed-v1'` - `whole-v1` is the explicit compatibility whole-object AES-GCM format; `framed-v1` stores independently authenticated frames so restore can stream verified plaintext incrementally and is now the default encrypted-write mode
- `encryption.frameBytes` (optional): `number` - Plaintext bytes per framed-v1 record (default `65536`)
- `kdfOptions` (optional): `Object` - KDF options when using `passphrase`. New passphrase stores default to PBKDF2 `600000` iterations or scrypt `N=131072`, and out-of-policy values fail with `KDF_POLICY_VIOLATION`
- `compression` (optional): `{ algorithm: 'gzip' }` - Enable compression

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

For encrypted content, `whole-v1` still buffers the full ciphertext before
authenticating and decrypting. `framed-v1` restores authenticated plaintext
frame-by-frame and only the final `restore()` collector buffers the result.

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
- `CasError` with code `INTEGRITY_ERROR` if decompression fails
- `CasError` with code `INVALID_OPTIONS` if both `passphrase` and `encryptionKey` are provided

**Example:**

```javascript
const { buffer, bytesWritten } = await cas.restore({ manifest });
```

#### restoreFile

```javascript
await cas.restoreFile({ manifest, encryptionKey, passphrase, outputPath });
```

Restores content from a manifest and writes it to a file.

For plaintext and `framed-v1`, this writes from the streaming restore path.
For `whole-v1` and compression-buffered modes, `restoreFile()` now uses a
bounded temp-file path: bytes are verified, decrypted, and optionally gunzipped
into a temporary sibling path, then renamed into place only after the pipeline
completes successfully. This improves file restores without changing the
contract of `restoreStream()`, which remains buffered for `whole-v1`.
On Web Crypto runtimes, the whole-object decrypt step is still internally
one-shot; the parity improvement is that this path now stays bounded by the
adapter's decryption buffer limit instead of collecting ciphertext without a
guard.

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
  outputPath: '/path/to/output.txt',
});
```

#### createTree

```javascript
await cas.createTree({ manifest });
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
await cas.verifyIntegrity(manifest);
```

Verifies the integrity of stored content by re-hashing all chunks. For
encrypted manifests, pass the same decryption credentials you would use for
`restore()` so the ciphertext is also authenticated. `whole-v1` authenticates
the full ciphertext as one unit; `framed-v1` authenticates every stored frame.

**Parameters:**

- `manifest` (required): `Manifest` - Manifest object
- `options` (optional): `object`
- `options.encryptionKey` (optional): `Buffer` - 32-byte key for encrypted manifests
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

#### deleteAsset

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

Derives an encryption key from a passphrase using PBKDF2 or scrypt.

**Parameters:**

- `options.passphrase` (required): `string` - The passphrase
- `options.salt` (optional): `Buffer` - Salt (random if omitted)
- `options.algorithm` (optional): `'pbkdf2' | 'scrypt'` - KDF algorithm (default: `'pbkdf2'`)
- `options.iterations` (optional): `number` - PBKDF2 iterations (default: 600000)
- `options.cost` (optional): `number` - scrypt cost parameter N (default: 131072)
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
  key: crypto.randomBytes(32),
});
```

#### decrypt

```javascript
await cas.decrypt({ buffer, key, meta });
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

#### rotateKey

```javascript
await cas.rotateKey({ manifest, oldKey, newKey, label });
```

Rotates a recipient's encryption key without re-encrypting data blobs. Unwraps the DEK with `oldKey`, re-wraps with `newKey`, and increments `keyVersion` counters.

**Parameters:**

- `manifest` (required): `Manifest` - Envelope-encrypted manifest
- `oldKey` (required): `Buffer` - Current 32-byte KEK
- `newKey` (required): `Buffer` - New 32-byte KEK
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
  };
}
```

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
`--vault-passphrase`, `--vault-passphrase-file`, or `--os-keychain-target`
during store and restore:

```javascript
// Initialize vault with encryption
await cas.initVault({ passphrase: 'secret' });

// Store with vault-configured passphrase derivation (human CLI convenience)
// git-cas store file.txt --slug demo/hello --tree --vault-passphrase secret

// Restore with vault-configured passphrase derivation
// git-cas restore --slug demo/hello --out file.txt --vault-passphrase secret

// Or resolve the vault passphrase from the OS keychain
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
git cas vault init --vault-passphrase "secret"   # With encryption
git cas vault init --os-keychain-target demo/passphrase
git cas vault list                               # List all entries
git cas vault info <slug>                        # Show slug + tree OID
git cas vault remove <slug>                      # Remove an entry
git cas vault history                            # Show commit history
git cas vault history -n 10                      # Last N commits
git cas vault rotate --old-passphrase "old" --new-passphrase "new"
git cas vault rotate --old-passphrase "old" --new-passphrase "new" --algorithm scrypt
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

| Flag                      | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `--old-passphrase <pass>` | Current vault passphrase (required)                     |
| `--new-passphrase <pass>` | New vault passphrase (required)                         |
| `--algorithm <alg>`       | KDF algorithm for new passphrase (`pbkdf2` or `scrypt`) |
| `--cwd <dir>`             | Git working directory (default: `.`)                    |

### Vault History

The vault maintains a full commit history via `refs/cas/vault`. Each mutation (add, remove, init) creates a new commit. Use `vault history` (or `git log refs/cas/vault`) to inspect the audit trail.

## VaultService

Domain service for vault operations. Requires three ports:

- `persistence` (`GitPersistencePort`) — blob/tree read/write
- `ref` (`GitRefPort`) — ref resolution, commits, atomic updates
- `crypto` (`CryptoPort`) — KDF for vault-level encryption

```javascript
import { VaultService } from '@git-stunts/cas'; // or via facade
const vault = await cas.getVaultService();
```

## CasService

Core domain service implementing CAS operations. Usually accessed via ContentAddressableStore, but can be used directly for advanced scenarios.

### Constructor

```javascript
new CasService({ persistence, codec, crypto, chunkSize, merkleThreshold });
```

**Parameters:**

- `persistence` (required): `GitPersistencePort` implementation
- `codec` (required): `CodecPort` implementation
- `crypto` (required): `CryptoPort` implementation
- `chunkSize` (optional): `number` - Chunk size in bytes (default: 262144, minimum: 1024)
- `merkleThreshold` (optional): `number` - Chunk count threshold for Merkle manifests (default: 1000)

**Throws:**

- `Error` if chunkSize is less than 1024 bytes
- `Error` if merkleThreshold is not a positive integer

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
  chunkSize: 512 * 1024,
});
```

### Methods

All methods from ContentAddressableStore delegate to CasService. See ContentAddressableStore documentation above for:

- `store({ source, slug, filename, encryptionKey, passphrase, kdfOptions, compression })`
- `restore({ manifest, encryptionKey, passphrase })`
- `createTree({ manifest })`
- `verifyIntegrity(manifest, { encryptionKey, passphrase })`
- `readManifest({ treeOid })`
- `deleteAsset({ treeOid })`
- `findOrphanedChunks({ treeOids })`
- `encrypt({ buffer, key })`
- `decrypt({ buffer, key, meta })`
- `deriveKey(options)`

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

- `content`: `Buffer | string` - Content to store

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

**Returns:** `Promise<Buffer>` - Blob content

##### readBlobStream

```javascript
await port.readBlobStream(oid);
```

Reads a Git blob as an async stream of `Buffer` chunks.

**Parameters:**

- `oid`: `string` - Git blob OID

**Returns:** `Promise<AsyncIterable<Buffer>>` - Blob byte stream

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
import GitPersistencePort from 'git-cas/src/ports/GitPersistencePort.js';

class CustomGitAdapter extends GitPersistencePort {
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

Encodes data to Buffer or string.

**Parameters:**

- `data`: `Object` - Data to encode

**Returns:** `Buffer | string` - Encoded data

##### decode

```javascript
port.decode(buffer);
```

Decodes data from Buffer or string.

**Parameters:**

- `buffer`: `Buffer | string` - Encoded data

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
port.sha256(buf);
```

Computes SHA-256 hash.

**Parameters:**

- `buf`: `Buffer` - Data to hash

**Returns:** `string` - 64-character hex digest

##### randomBytes

```javascript
port.randomBytes(n);
```

Generates cryptographically random bytes.

**Parameters:**

- `n`: `number` - Number of bytes

**Returns:** `Buffer` - Random bytes

##### encryptBuffer

```javascript
port.encryptBuffer(buffer, key);
```

Encrypts a buffer using AES-256-GCM.

**Parameters:**

- `buffer`: `Buffer` - Data to encrypt
- `key`: `Buffer` - 32-byte encryption key

**Returns:** `{ buf: Buffer, meta: { algorithm: string, nonce: string, tag: string, encrypted: boolean } }`

##### decryptBuffer

```javascript
port.decryptBuffer(buffer, key, meta);
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
port.createEncryptionStream(key);
```

Creates a streaming encryption context.

**Parameters:**

- `key`: `Buffer` - 32-byte encryption key

**Returns:** `{ encrypt: Function, finalize: Function }`

- `encrypt`: `(source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>` - Transform function
- `finalize`: `() => { algorithm: string, nonce: string, tag: string, encrypted: boolean }` - Get metadata

##### deriveKey

```javascript
await port.deriveKey(options);
```

Derives an encryption key from a passphrase using PBKDF2 or scrypt.

**Parameters:**

- `options.passphrase`: `string` - The passphrase
- `options.salt` (optional): `Buffer` - Salt (random if omitted)
- `options.algorithm` (optional): `'pbkdf2' | 'scrypt'` - KDF algorithm (default: `'pbkdf2'`)
- `options.iterations` (optional): `number` - PBKDF2 iterations (default: `600000`)
- `options.cost` (optional): `number` - scrypt cost N (default: `131072`)
- `options.blockSize` (optional): `number` - scrypt block size r
- `options.parallelization` (optional): `number` - scrypt parallelization p
- `options.keyLength` (optional): `number` - Derived key length (default: 32)

`deriveKey()` is the raw derivation primitive. Policy enforcement for persisted
KDF metadata happens in `store()`, `restore()`, `initVault()`, and
`rotateVaultPassphrase()`.

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
new CasError(message, code, meta);
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

| Code                                  | Description                                                                | Thrown By                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `INVALID_KEY_TYPE`                    | Encryption key must be a Buffer or Uint8Array                              | `encrypt()`, `decrypt()`, `store()`, `restore()`                              |
| `INVALID_KEY_LENGTH`                  | Encryption key must be exactly 32 bytes                                    | `encrypt()`, `decrypt()`, `store()`, `restore()`                              |
| `MISSING_KEY`                         | Encryption key required to restore encrypted content but none was provided | `restore()`                                                                   |
| `INTEGRITY_ERROR`                     | Chunk digest verification failed or decryption authentication failed       | `restore()`, `verifyIntegrity()`, `decrypt()`                                 |
| `DECRYPTION_BUFFER_EXCEEDED`          | Web Crypto whole-object decrypt exceeded the configured buffer limit       | `createDecryptionStream()` via Web Crypto restore paths                       |
| `KDF_POLICY_VIOLATION`               | KDF parameters fell outside the accepted policy window                     | `store()`, `restore()`, `initVault()`, `rotateVaultPassphrase()`, `readState()` |
| `STREAM_ERROR`                        | Stream error occurred during store operation                               | `store()`                                                                     |
| `MANIFEST_NOT_FOUND`                  | No manifest entry found in the Git tree                                    | `readManifest()`, `deleteAsset()`, `findOrphanedChunks()`                     |
| `GIT_ERROR`                           | Underlying Git plumbing command failed                                     | `readManifest()`, `deleteAsset()`, `findOrphanedChunks()`                     |
| `INVALID_OPTIONS`                     | Mutually exclusive options provided or unsupported option value            | `store()`, `restore()`                                                        |
| `INVALID_SLUG`                        | Slug fails validation (empty, control chars, `..` segments, etc.)          | `addToVault()`                                                                |
| `VAULT_ENTRY_NOT_FOUND`               | Slug does not exist in vault                                               | `removeFromVault()`, `resolveVaultEntry()`                                    |
| `VAULT_ENTRY_EXISTS`                  | Slug already exists (use `force` to overwrite)                             | `addToVault()`                                                                |
| `VAULT_CONFLICT`                      | Concurrent vault update detected (CAS failure after retries)               | `addToVault()`, `removeFromVault()`, `initVault()`, `rotateVaultPassphrase()` |
| `VAULT_METADATA_INVALID`              | `.vault.json` malformed, unknown version, or missing required fields       | `readState()`, `rotateVaultPassphrase()`                                      |
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
