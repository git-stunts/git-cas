# Security Model

This document describes the security architecture, cryptographic design, and limitations of git-cas's content-addressable storage system with optional encryption.

## Table of Contents

1. [Threat Model](#threat-model)
2. [Cryptographic Design](#cryptographic-design)
3. [Key Handling](#key-handling)
4. [Encryption Flow](#encryption-flow)
5. [Decryption Flow](#decryption-flow)
6. [Chunk Digest Verification](#chunk-digest-verification)
7. [Limitations](#limitations)
8. [Git Object Immutability](#git-object-immutability)
9. [Error Codes for Security Operations](#error-codes-for-security-operations)

---

## Threat Model

### What git-cas Protects Against

git-cas provides defense against the following threat scenarios:

1. **At-rest confidentiality**: When encryption is enabled, stored content is protected from unauthorized reading by anyone who gains access to the Git object database without the encryption key.

2. **Data integrity**: All stored content (encrypted or not) is protected by SHA-256 digests per chunk. Any corruption, tampering, or bit-rot is detected during restore or integrity verification.

3. **Authentication of ciphertext**: AES-256-GCM's built-in authentication tag ensures that encrypted data has not been modified or tampered with. Any modification to ciphertext will cause decryption to fail.

### What git-cas Does NOT Protect Against

git-cas does NOT provide protection in the following scenarios:

1. **Key management**: git-cas does not store, manage, or rotate encryption keys. Key storage and lifecycle management are entirely the caller's responsibility.

2. **Access control**: git-cas does not implement access control lists or authorization policies. If an attacker can access the Git repository and has the encryption key, they can read all content.

3. **Side-channel attacks**: No protection against timing attacks, power analysis, or other side-channel attacks on the cryptographic operations.

4. **Memory safety**: Decryption of encrypted content loads the entire ciphertext into memory. No protection against memory dumps or swap file exposure.

5. **Key recovery**: If an encryption key is lost, there is no key recovery mechanism. Encrypted data becomes permanently inaccessible.

6. **Metadata privacy**: The following metadata is NOT encrypted:
   - Manifest structure (slug, filename, chunk count)
   - Chunk sizes and indices
   - SHA-256 digests of encrypted chunks
   - Git tree and blob object IDs

7. **Deletion guarantees**: Logical deletion from the manifest does not physically remove data from Git's object database. See [Git Object Immutability](#git-object-immutability).

8. **Concurrent key rotation**: There is no support for re-encrypting content with a different key while maintaining availability.

---

## Cryptographic Design

### AES-256-GCM

git-cas uses **AES-256-GCM** (Galois/Counter Mode) for authenticated encryption:

- **Algorithm**: `aes-256-gcm` via runtime-specific adapters (Node.js `node:crypto`, Bun `CryptoHasher` + `node:crypto`, Deno/Web `crypto.subtle`)
- **Key size**: 256 bits (32 bytes)
- **Nonce size**: 96 bits (12 bytes), cryptographically random
- **Authentication tag**: 128 bits (16 bytes)

### Why AES-256-GCM?

AES-256-GCM was chosen because:

1. **Authenticated Encryption with Associated Data (AEAD)**: Provides both confidentiality and integrity/authenticity in a single operation.
2. **Nonce-based**: Does not require unique per-message keys, only unique nonces.
3. **Industry standard**: Widely deployed, well-studied, and supported by hardware acceleration on modern CPUs.
4. **Streaming-friendly**: GCM mode allows incremental encryption without padding requirements.

### Nonce Generation

Each encryption operation generates a fresh 96-bit (12-byte) nonce using `crypto.randomBytes(12)`:

- **Uniqueness requirement**: The same key must NEVER be used with the same nonce twice.
- **Random generation**: git-cas uses cryptographically secure random number generation from Node.js's `crypto.randomBytes()`, which sources from the OS entropy pool.
- **Collision probability**: With 96-bit random nonces, the probability of collision is negligible for practical use cases (< 2^48 encryptions with the same key).

**CRITICAL**: Callers must NOT reuse encryption keys across a large number of operations (approaching 2^32 encryptions with a single key). While collision is unlikely, best practice is to rotate keys periodically.

### Authentication Tag

After encryption completes, AES-256-GCM produces a 128-bit authentication tag:

- The tag is stored in the manifest's `encryption.tag` field (base64-encoded).
- During decryption, the tag is verified by `createDecipheriv()` via `setAuthTag()`.
- If the ciphertext or tag has been modified, `decipher.final()` will throw an error.

### Encryption Wraps Around Chunked Storage

The encryption layer wraps the chunking layer:

```
[Plain source stream] → [Encrypt stream] → [Chunk into 256KB blocks] → [Store as Git blobs]
```

This means:

- **Encrypted chunks are not individually authenticated**: The entire ciphertext is authenticated as a single unit by the GCM tag.
- **Chunk digests are computed on ciphertext**: The SHA-256 digest stored in each chunk entry is the hash of the encrypted data, not the plaintext.
- **Chunking is deterministic**: Given the same plaintext and key/nonce, the encrypted chunks will be identical (because nonce is fixed at encryption time).

---

## Key Handling

### Caller Responsibility

git-cas **does not store encryption keys**. All key management responsibilities fall on the caller:

1. **Key generation**: The caller must generate cryptographically secure 256-bit (32-byte) keys.
2. **Key storage**: The caller must securely store keys (e.g., in environment variables, key management systems, hardware security modules).
3. **Key distribution**: If keys need to be shared across systems, the caller must implement secure key distribution.
4. **Key rotation**: The caller must implement key rotation policies. git-cas does not support re-encrypting content with a new key.

### Key Validation

git-cas validates keys before use:

```javascript
_validateKey(key) {
  if (!Buffer.isBuffer(key) && !(key instanceof Uint8Array)) {
    throw new CasError(
      'Encryption key must be a Buffer or Uint8Array',
      'INVALID_KEY_TYPE',
    );
  }
  if (key.length !== 32) {
    throw new CasError(
      `Encryption key must be 32 bytes, got ${key.length}`,
      'INVALID_KEY_LENGTH',
      { expected: 32, actual: key.length },
    );
  }
}
```

**Accepted types**: `Buffer` or `Uint8Array`
**Required length**: Exactly 32 bytes (256 bits)

If validation fails:
- **INVALID_KEY_TYPE**: Key is not a Buffer or Uint8Array
- **INVALID_KEY_LENGTH**: Key is not 32 bytes

### Key Best Practices

1. **Generate keys using a CSPRNG**: Use `crypto.randomBytes(32)` or equivalent.
2. **Never hardcode keys**: Store keys in secure configuration, not in source code.
3. **Use unique keys per project/environment**: Do not reuse the same key across different repositories or environments.
4. **Rotate keys periodically**: Establish a key rotation policy (e.g., every 90 days).
5. **Secure key backups**: If keys are backed up, encrypt the backup with a separate master key.

---

## Encryption Flow

### High-Level Overview

When storing content with encryption enabled:

1. Caller provides `source` (async iterable of Buffers), `slug`, `filename`, and `encryptionKey`.
2. git-cas validates the key.
3. git-cas creates a streaming encryption context with a random nonce.
4. The source stream is encrypted incrementally.
5. Encrypted chunks are buffered to 256KB boundaries.
6. Each 256KB encrypted chunk is hashed (SHA-256) and written as a Git blob.
7. After encryption completes, the GCM authentication tag is retrieved.
8. Encryption metadata (algorithm, nonce, tag) is stored in the manifest.

### Step-by-Step: `store({ source, slug, filename, encryptionKey })`

**Step 1: Key Validation**
```javascript
if (encryptionKey) {
  this._validateKey(encryptionKey);
}
```
- If `encryptionKey` is provided, validate it is a 32-byte Buffer/Uint8Array.
- If validation fails, throw `CasError` with code `INVALID_KEY_TYPE` or `INVALID_KEY_LENGTH`.

**Step 2: Initialize Manifest Data**
```javascript
const manifestData = {
  slug,
  filename,
  size: 0,
  chunks: [],
};
```

**Step 3: Create Encryption Stream**
```javascript
const { encrypt, finalize } = this.crypto.createEncryptionStream(encryptionKey);
```
- `createEncryptionStream()` generates a 12-byte random nonce.
- Creates an `aes-256-gcm` cipher with the key and nonce.
- Returns:
  - `encrypt`: an async generator function that yields encrypted chunks
  - `finalize`: a function that returns encryption metadata after encryption completes

**Step 4: Chunk and Store Encrypted Stream**
```javascript
await this._chunkAndStore(encrypt(source), manifestData);
```
- The `encrypt(source)` async generator reads from the source, encrypts data incrementally, and yields encrypted buffers.
- `_chunkAndStore()` buffers encrypted data to 256KB boundaries.
- Each 256KB chunk is SHA-256 hashed and written as a Git blob.
- Chunk metadata (index, size, digest, blob OID) is appended to `manifestData.chunks`.

**Step 5: Finalize Encryption Metadata**
```javascript
manifestData.encryption = finalize();
```
- `finalize()` retrieves the GCM authentication tag.
- Returns an object:
  ```javascript
  {
    algorithm: 'aes-256-gcm',
    nonce: '<base64-encoded-nonce>',
    tag: '<base64-encoded-tag>',
    encrypted: true,
  }
  ```
- This metadata is stored in the manifest's `encryption` field.

**Step 6: Create Manifest**
```javascript
const manifest = new Manifest(manifestData);
```

### Important Properties

- **Streaming encryption**: Data is encrypted incrementally. The entire plaintext does NOT need to fit in memory during encryption.
- **Deterministic chunking**: For the same plaintext and key/nonce, the chunk boundaries and digests are deterministic.
- **No plaintext leakage**: The plaintext source is never written to disk. Only encrypted chunks are persisted.

---

## Decryption Flow

### High-Level Overview

When restoring content with encryption:

1. Caller provides `manifest` and `encryptionKey`.
2. git-cas validates the key.
3. git-cas reads all chunk blobs from Git.
4. Each chunk's SHA-256 digest is verified against the stored digest in the manifest.
5. All encrypted chunks are concatenated into a single ciphertext buffer.
6. The ciphertext is decrypted using AES-256-GCM with the stored nonce and tag.
7. If the tag verification fails, decryption throws an integrity error.
8. The plaintext buffer is returned to the caller.

### Step-by-Step: `restore({ manifest, encryptionKey })`

**Step 1: Key Validation**
```javascript
if (encryptionKey) {
  this._validateKey(encryptionKey);
}
```

**Step 2: Check if Key is Required**
```javascript
if (manifest.encryption?.encrypted && !encryptionKey) {
  throw new CasError(
    'Encryption key required to restore encrypted content',
    'MISSING_KEY',
  );
}
```
- If the manifest indicates content is encrypted but no key is provided, throw `MISSING_KEY`.

**Step 3: Read and Verify Chunks**
```javascript
const chunks = await this._readAndVerifyChunks(manifest.chunks);
```
- For each chunk in the manifest:
  1. Read the Git blob by OID.
  2. Compute SHA-256 digest of the blob.
  3. Compare computed digest with stored digest in manifest.
  4. If mismatch, throw `CasError` with code `INTEGRITY_ERROR`.
  5. If match, append blob to `buffers` array.

**Step 4: Concatenate Encrypted Chunks**
```javascript
let buffer = Buffer.concat(chunks);
```
- All encrypted chunk buffers are concatenated into a single ciphertext buffer.

**CRITICAL**: This operation loads the entire ciphertext into memory. For large files, this may cause memory exhaustion. See [Limitations](#limitations).

**Step 5: Decrypt Buffer**
```javascript
if (manifest.encryption?.encrypted) {
  buffer = await this.decrypt({
    buffer,
    key: encryptionKey,
    meta: manifest.encryption,
  });
}
```
- Extract nonce and tag from `manifest.encryption`.
- Create `aes-256-gcm` decipher with key and nonce.
- Set authentication tag via `setAuthTag()`.
- Decrypt the ciphertext:
  ```javascript
  const nonce = Buffer.from(meta.nonce, 'base64');
  const tag = Buffer.from(meta.tag, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
  ```
- If `decipher.final()` throws (due to tag mismatch or corrupted ciphertext), catch and re-throw as `CasError` with code `INTEGRITY_ERROR`.

**Step 6: Return Plaintext**
```javascript
return { buffer, bytesWritten: buffer.length };
```

### Important Properties

- **No streaming decryption**: The entire ciphertext must be loaded into memory before decryption. This is a limitation of the current implementation.
- **Authentication before decryption**: GCM mode ensures that ciphertext integrity is verified before any plaintext is returned. If the tag check fails, no plaintext is leaked.
- **Chunk integrity before decryption**: SHA-256 verification of encrypted chunks occurs before decryption. This detects corruption at the chunk level.

---

## Chunk Digest Verification

### SHA-256 Per Chunk

Every chunk (encrypted or unencrypted) is protected by a SHA-256 digest:

- **Digest computation**: When a chunk is stored, `crypto.createHash('sha256').update(buf).digest('hex')` is computed and stored in the manifest.
- **Digest verification**: When a chunk is read during `restore()` or `verifyIntegrity()`, the digest is recomputed and compared.

### When Digests Are Verified

1. **During restore** (`restore()` method):
   - Every chunk is read from Git and its SHA-256 digest is verified.
   - If any digest mismatch is detected, `restore()` throws `CasError` with code `INTEGRITY_ERROR`.

2. **During integrity verification** (`verifyIntegrity()` method):
   - All chunks are read and their SHA-256 digests are verified.
   - If any digest mismatch is detected, `verifyIntegrity()` returns `false` and emits an `integrity:fail` event.

### What Digests Protect Against

- **Bit-rot**: Silent corruption of Git objects on disk.
- **Storage errors**: Corruption during disk writes or reads.
- **Tampering**: Intentional modification of chunk blobs.
- **Incomplete writes**: Partial writes during storage failures.

### What Digests Do NOT Protect Against

- **Manifest tampering**: If an attacker modifies the manifest to point to different blobs with matching digests, the chunk verification will pass. However:
  - For unencrypted content, this results in incorrect data being restored.
  - For encrypted content, GCM tag verification will fail unless the attacker also forges the authentication tag (which is computationally infeasible).

- **Rollback attacks**: If an attacker replaces a newer manifest with an older one, chunk digests will still verify. Application-level versioning or commit signing is required to prevent rollback.

---

## Limitations

### 1. Encrypted Restore Loads Full Ciphertext into Memory

**Issue**: The `restore()` method concatenates all encrypted chunks into a single buffer before decryption:

```javascript
let buffer = Buffer.concat(chunks);
```

**Impact**:
- For large encrypted files (e.g., 1GB+), this can cause memory exhaustion.
- Node.js has a maximum buffer size of ~2GB (depending on architecture).

**Workaround**:
- Avoid encrypting extremely large files with git-cas.
- If large encrypted files are required, implement application-level chunking (e.g., split a 10GB file into 10 separate 1GB files before storing).

**Future improvement**: Implement streaming decryption to process ciphertext in chunks without full concatenation.

### 2. No Streaming Decryption

**Issue**: AES-256-GCM decryption is currently performed on the entire ciphertext as a single operation. The authentication tag is verified only at the end of decryption.

**Impact**:
- Cannot stream decrypted plaintext to the caller incrementally.
- Cannot detect tampering until the entire ciphertext is processed.

**Future improvement**: Investigate chunked AEAD modes or encrypt-then-MAC schemes that allow incremental authentication.

### 3. No Key Rotation

**Issue**: git-cas does not support re-encrypting content with a new key while maintaining the same manifest structure.

**Impact**:
- If a key is compromised, all content encrypted with that key must be manually re-encrypted by:
  1. Restoring content with the old key.
  2. Storing content again with the new key.
  3. Updating all references to the old manifest tree to the new manifest tree.

**Workaround**:
- Implement application-level key rotation by maintaining a key version identifier alongside each manifest.

**Future improvement**: Add a `reencrypt()` method that re-encrypts content with a new key without requiring full restore.

### 4. Nonce Collision Risk After 2^32 Operations

**Issue**: While 96-bit nonces have negligible collision probability for practical use cases, the GCM security proof degrades after ~2^32 encryptions with the same key.

**Impact**:
- If the same key is used to encrypt more than 2^32 files, nonce reuse becomes more likely.
- Nonce reuse with AES-GCM is catastrophic: it allows attackers to recover the plaintext and authentication key.

**Mitigation**:
- Rotate encryption keys after a reasonable number of operations (e.g., every 1 million encryptions, or every 90 days, whichever comes first).

### 5. Metadata Not Encrypted

**Issue**: The following metadata is stored in plaintext in the manifest:
- `slug` (file identifier)
- `filename`
- `size` (total size of encrypted content)
- `chunks` array (chunk indices, sizes, digests, blob OIDs)

**Impact**:
- An attacker with access to the repository can infer file structure, sizes, and access patterns.
- Chunk digests may leak information about plaintext content if chunks are small or predictable.

**Mitigation**:
- If metadata privacy is required, implement application-level encryption of the entire manifest before storing it as a Git blob.

### 6. No Protection Against Replay or Rollback Attacks

**Issue**: git-cas does not include versioning or timestamps in the encryption metadata.

**Impact**:
- An attacker can replace a newer manifest tree with an older one (rollback attack).
- An attacker can duplicate encrypted content across different slugs (replay attack).

**Mitigation**:
- Use Git commit signing to authenticate manifest trees.
- Implement application-level versioning or monotonic counters.

---

## Git Object Immutability

### Objects Are Immutable in Git's Object Database

Git's object database (ODB) is **append-only** and **content-addressed**:

- Once a blob, tree, or commit is written, its content is immutable.
- Objects are stored in `.git/objects/` and referenced by their SHA-1 (or SHA-256) hash.

### Logical vs. Physical Deletion

git-cas does NOT provide a `delete()` method because:

1. **Logical deletion** is trivial: Remove the reference to a manifest tree from your application's index.
2. **Physical deletion** is a Git-level operation: Unreferenced objects remain in `.git/objects/` until garbage collection.

### Garbage Collection via `git gc`

To physically remove unreferenced objects:

```bash
git gc --aggressive --prune=now
```

**Important**:
- `git gc` only removes objects that are not reachable from any ref (branch, tag, commit).
- If a manifest tree is still referenced (e.g., in a commit or reflog), its chunks will NOT be pruned.

### Security Implications

1. **Deleted content may persist**: If you "delete" a file by removing its manifest reference, the encrypted chunks remain in `.git/objects/` until `git gc` prunes them.

2. **Reflog prevents immediate pruning**: Git's reflog keeps references to old commits for 90 days by default. To prune immediately:
   ```bash
   git reflog expire --expire=now --all
   git gc --prune=now
   ```

3. **Shallow clones do not remove history**: Even if you force-push to remove a commit, the objects remain in the local repository until pruned.

### Best Practices

- **Do not rely on logical deletion for security**: If sensitive content was encrypted and stored, assume the ciphertext remains in the repository until `git gc` prunes it.
- **Prune after sensitive operations**: After removing sensitive content, run:
  ```bash
  git reflog expire --expire=now --all
  git gc --aggressive --prune=now
  ```
- **Consider repository rotation**: For highly sensitive data, periodically create a new repository and migrate only non-sensitive content.

---

## Error Codes for Security Operations

git-cas defines the following error codes for security-related operations:

### `INTEGRITY_ERROR`

**Thrown when**:
- A chunk's SHA-256 digest does not match the stored digest in the manifest.
- AES-256-GCM authentication tag verification fails during decryption.

**Example**:
```javascript
throw new CasError(
  'Chunk 2 integrity check failed',
  'INTEGRITY_ERROR',
  { chunkIndex: 2, expected: 'abc123...', actual: 'def456...' },
);
```

**Possible causes**:
- Corruption of Git objects on disk.
- Tampering with chunk blobs.
- Wrong encryption key used for decryption (GCM tag mismatch).
- Incomplete or interrupted writes.

**Recommended action**:
- If this occurs during `restore()`, the file is corrupted and cannot be recovered without a backup.
- If this occurs during `verifyIntegrity()`, investigate storage hardware or Git repository health.

### `INVALID_KEY_LENGTH`

**Thrown when**:
- An encryption key is provided but is not exactly 32 bytes (256 bits).

**Example**:
```javascript
throw new CasError(
  'Encryption key must be 32 bytes, got 16',
  'INVALID_KEY_LENGTH',
  { expected: 32, actual: 16 },
);
```

**Possible causes**:
- Incorrect key generation (e.g., using 128-bit AES key instead of 256-bit).
- Key truncation during storage or transmission.
- Encoding issues (e.g., base64 decoding resulting in wrong length).

**Recommended action**:
- Verify key generation logic uses `crypto.randomBytes(32)` or equivalent.
- Check key storage/retrieval does not corrupt or truncate the key.

### `INVALID_KEY_TYPE`

**Thrown when**:
- An encryption key is provided but is not a `Buffer` or `Uint8Array`.

**Example**:
```javascript
throw new CasError(
  'Encryption key must be a Buffer or Uint8Array',
  'INVALID_KEY_TYPE',
);
```

**Possible causes**:
- Passing a string instead of a Buffer (e.g., `"my-secret-key"` instead of `Buffer.from("my-secret-key")`).
- Passing a base64-encoded string without decoding it first.

**Recommended action**:
- Ensure keys are stored as `Buffer` or `Uint8Array`.
- If keys are stored as hex/base64 strings, decode them before passing to git-cas:
  ```javascript
  const key = Buffer.from(keyBase64, 'base64');
  ```

### `MISSING_KEY`

**Thrown when**:
- A manifest indicates content is encrypted (`manifest.encryption.encrypted === true`) but no `encryptionKey` is provided to `restore()`.

**Example**:
```javascript
throw new CasError(
  'Encryption key required to restore encrypted content',
  'MISSING_KEY',
);
```

**Possible causes**:
- Application logic error: Forgot to pass key to `restore()`.
- Key was lost or not available in the current environment.

**Recommended action**:
- Verify the encryption key is available and passed to `restore()`.
- If the key is lost, the content is permanently inaccessible.

---

## Conclusion

git-cas provides strong at-rest encryption and integrity guarantees through AES-256-GCM and SHA-256 chunk verification. However, it is critical to understand the limitations and caller responsibilities:

- **Key management is entirely your responsibility**. git-cas does not store or manage keys.
- **Encrypted restore is not streaming**. Large encrypted files may cause memory issues.
- **No key rotation support**. Re-encrypting content requires manual restore/store cycles.
- **Metadata is not encrypted**. File structure and sizes are visible to anyone with repository access.
- **Logical deletion does not physically remove data**. Use `git gc` to prune unreferenced objects.

For questions or security concerns, please review the [ROADMAP](../ROADMAP.md) or file an issue.
