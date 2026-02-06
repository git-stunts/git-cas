# git-cas Examples

This directory contains runnable examples demonstrating the core features of `@git-stunts/git-cas`.

## Prerequisites

- Node.js 22 or later
- Git installed and available in PATH
- `@git-stunts/git-cas` and `@git-stunts/plumbing` installed

## Setup

Before running the examples, ensure you have a Git repository initialized. The examples will create a temporary bare repository for demonstration purposes.

```bash
# Install dependencies (from the repository root)
npm install

# Navigate to the examples directory
cd examples
```

## Running the Examples

Each example is a standalone Node.js script that can be run directly:

```bash
node store-and-restore.js
node encrypted-workflow.js
node progress-tracking.js
```

## Examples Overview

### store-and-restore.js

**Demonstrates:** Basic CAS workflow with verification

This example shows the complete lifecycle of storing and restoring a file:
1. Creates a temporary Git bare repository
2. Stores a file in the content-addressable store
3. Creates a Git tree to persist the manifest
4. Reads the manifest back from the tree
5. Restores the file to disk
6. Verifies the restored content matches the original
7. Runs integrity verification on the stored chunks

**Key concepts:**
- `ContentAddressableStore.createJson()` factory
- `storeFile()` to store files
- `createTree()` to persist manifests in Git
- Reading manifests from Git trees
- `restoreFile()` to write files back to disk
- `verifyIntegrity()` to check chunk digests

### encrypted-workflow.js

**Demonstrates:** Encryption and decryption with AES-256-GCM

This example shows how to work with encrypted content:
1. Generates a secure 32-byte encryption key
2. Stores a file with encryption enabled
3. Restores the file using the correct key
4. Demonstrates that using the wrong key causes an integrity error
5. Shows the encryption metadata stored in the manifest

**Key concepts:**
- Generating encryption keys with `crypto.randomBytes(32)`
- Storing encrypted files with `encryptionKey` parameter
- Encryption metadata in manifests
- Decryption during restore
- Handling wrong key errors (INTEGRITY_ERROR)

### progress-tracking.js

**Demonstrates:** Event-driven progress monitoring

This example shows how to track storage and restore operations using Node.js EventEmitter:
1. Accesses the CasService via `cas.getService()`
2. Attaches event listeners for various operations
3. Builds a progress logger that tracks:
   - Chunk storage progress
   - File storage completion
   - Chunk restoration progress
   - File restoration completion
   - Integrity verification results

**Key concepts:**
- Accessing the underlying CasService
- Event types: `chunk:stored`, `file:stored`, `chunk:restored`, `file:restored`, `integrity:pass`, `integrity:fail`, `error`
- Building real-time progress indicators
- Calculating percentages based on chunk counts

## API Reference

### Factory Methods

```javascript
// JSON codec (default)
const cas = ContentAddressableStore.createJson({ plumbing });

// CBOR codec (binary)
const cas = ContentAddressableStore.createCbor({ plumbing });
```

### Storage Operations

```javascript
// Store a file
const manifest = await cas.storeFile({
  filePath: '/path/to/file',
  slug: 'unique-identifier',
  filename: 'optional-name.txt',
  encryptionKey: optionalKeyBuffer  // 32-byte Buffer
});

// Create a Git tree
const treeOid = await cas.createTree({ manifest });
```

### Restore Operations

```javascript
// Restore to disk
await cas.restoreFile({
  manifest,
  encryptionKey: optionalKeyBuffer,
  outputPath: '/path/to/output'
});

// Restore to memory (returns Buffer)
const { buffer, bytesWritten } = await cas.restore({
  manifest,
  encryptionKey: optionalKeyBuffer
});
```

### Verification

```javascript
// Verify chunk integrity
const isValid = await cas.verifyIntegrity(manifest);
```

### Reading Manifests from Trees

```javascript
// Get the service
const service = await cas.getService();

// Read tree entries
const entries = await service.persistence.readTree(treeOid);

// Find manifest entry
const manifestEntry = entries.find(e => e.name === 'manifest.json');

// Read and decode manifest blob
const manifestBlob = await service.persistence.readBlob(manifestEntry.oid);
const manifestData = service.codec.decode(manifestBlob);
const manifest = new Manifest(manifestData);
```

## Encryption Keys

Encryption keys must be 32-byte Buffers for AES-256-GCM:

```javascript
import { randomBytes } from 'node:crypto';

// Generate a secure random key
const key = randomBytes(32);

// Or use a key derived from a password
// (use a proper KDF like PBKDF2 or scrypt in production)
```

## Notes

- All examples clean up temporary files and directories
- The examples use temporary Git bare repositories to avoid polluting your working directory
- Chunk size defaults to 256 KiB (262,144 bytes)
- File paths must be absolute paths, not relative paths
- The CAS service extends EventEmitter for progress tracking

## Troubleshooting

**Error: "Encryption key must be 32 bytes"**
- Ensure your encryption key is exactly 32 bytes
- Use `crypto.randomBytes(32)` or equivalent

**Error: "INTEGRITY_ERROR"**
- Using wrong decryption key
- Chunk corruption in Git object database
- Run `verifyIntegrity()` to identify corrupted chunks

**Error: "MISSING_KEY"**
- Attempting to restore encrypted content without providing the key
- Check if `manifest.encryption.encrypted === true`
