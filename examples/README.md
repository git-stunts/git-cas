# git-cas Examples

This directory contains runnable examples demonstrating the core features of `@git-stunts/git-cas`.

The maintained non-TUI examples are covered by
`test/unit/docs/release-truth.test.js` so the public examples stay aligned with
the current API contract.

Audit status:

| File | Demonstrates | Notes |
| --- | --- | --- |
| `examples/store-and-restore.js` | Basic store/tree/read/restore/verify workflow | First example to run. Uses the public `readManifest()` helper for tree-to-manifest reads. |
| `examples/encrypted-workflow.js` | Raw-key AES-256-GCM store/restore failure modes | Uses current `framed` default encryption metadata unless you select another scheme in code. |
| `examples/progress-tracking.js` | `EventEmitterObserver` progress and integrity events | Shows the backward-compatible event bridge over the `ObservabilityPort`. |
| `examples/v6-blocks/dashboard-v6.js` | Bijou TUI dashboard mock-up | Visual prototype for the v6 cockpit-style vault dashboard. |
| `examples/v6-blocks/health-v6.js` | Bijou TUI health panel mock-up | Visual prototype for doctor/health reporting blocks. |
| `examples/v6-blocks/merkle-v6.js` | Bijou TUI Merkle explorer mock-up | Visual prototype for table/tree/DAG Merkle manifest exploration. |

## Prerequisites

- Node.js 22 or later
- Git installed and available in PATH
- `@git-stunts/git-cas` installed

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
node v6-blocks/dashboard-v6.js
node v6-blocks/health-v6.js
node v6-blocks/merkle-v6.js
```

## Examples Overview

### store-and-restore.js

**Demonstrates:** Basic CAS workflow with verification

This example shows the complete lifecycle of storing and restoring a file:

1. Creates a temporary Git bare repository
2. Stores a file in the content-addressable store
3. Creates a Git tree to persist the manifest
4. Reads the manifest back from the tree with the public `readManifest()` helper
5. Restores the file to disk
6. Verifies the restored content matches the original
7. Runs integrity verification on the stored chunks

**Key concepts:**

- `ContentAddressableStore.open({ cwd })` factory
- `storeFile()` to store files
- `createTree()` to persist manifests in Git
- `readManifest()` to reconstruct manifests from Git trees
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

This example shows how to track storage and restore operations using `EventEmitterObserver`:

1. Creates an `EventEmitterObserver`
2. Passes it into `ContentAddressableStore` via the `observability` option
3. Attaches event listeners to the observer
4. Builds a progress logger that tracks:
   - Chunk storage progress
   - File storage completion
   - Chunk restoration progress
   - File restoration completion
   - Integrity verification results

**Key concepts:**

- `EventEmitterObserver` as the backward-compatible event bridge
- Event types: `chunk:stored`, `file:stored`, `chunk:restored`, `file:restored`, `integrity:pass`, `integrity:fail`, `error`
- Building real-time progress indicators
- Calculating percentages based on chunk counts

### v6-blocks/dashboard-v6.js

**Demonstrates:** Interactive TUI layout for the v6 vault cockpit

This mock-up shows a keyboard-driven asset ledger and manifest inspector using
the Bijou TUI stack. It is a visual example rather than a live vault reader.

**Key concepts:**

- Bijou surfaces and boxed panels
- Keyboard focus movement
- Asset metadata badges for scheme and manifest shape

### v6-blocks/health-v6.js

**Demonstrates:** Interactive TUI health reporting block

This mock-up shows how vault health, reachability, encryption posture, and
history events can be rendered as a compact operator panel.

**Key concepts:**

- Timeline rendering
- Health and status badges
- Help overlay behavior

### v6-blocks/merkle-v6.js

**Demonstrates:** Merkle manifest visualization concepts

This mock-up shows table, tree, and DAG views for a Merkle manifest. It is a
visual companion to the Merkle manifest docs, not a live Git object reader.

**Key concepts:**

- Segmented view modes
- Sub-manifest hierarchy
- DAG-style chunk reference display

## API Reference

### Factory Methods

```javascript
// JSON codec (default)
const cas = ContentAddressableStore.open({ cwd: '/path/to/repo' });

// CBOR codec (binary, with an explicit Git plumbing instance)
const cas = ContentAddressableStore.createCbor({ plumbing });
```

### Storage Operations

```javascript
// Store a file
const manifest = await cas.storeFile({
  filePath: '/path/to/file',
  slug: 'unique-identifier',
  filename: 'optional-name.txt',
  encryptionKey: optionalKeyBytes, // 32-byte Uint8Array
});

// Create a Git tree
const treeOid = await cas.createTree({ manifest });
```

### Restore Operations

```javascript
// Restore to disk
await cas.restoreFile({
  manifest,
  encryptionKey: optionalKeyBytes,
  outputPath: '/path/to/output',
});

// Restore to memory (returns Uint8Array)
const { buffer, bytesWritten } = await cas.restore({
  manifest,
  encryptionKey: optionalKeyBytes,
});
```

### Verification

```javascript
// Plaintext manifests: verify chunk integrity
const isValid = await cas.verifyIntegrity(manifest);

// Encrypted manifests: authenticate chunks with restore credentials
const encryptedIsValid = await cas.verifyIntegrity(manifest, { encryptionKey: optionalKeyBytes });
```

Encrypted manifests require the same credentials used for restore; without
them, `verifyIntegrity()` returns `false` after authentication fails.

### Reading Manifests from Trees

```javascript
const manifest = await cas.readManifest({ treeOid });
```

## Encryption Keys

Encryption keys must be 32-byte `Uint8Array` values for AES-256-GCM. Node
`Buffer` values also work because `Buffer` extends `Uint8Array`.

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
- Relative file paths are fine; these examples happen to use temporary absolute paths
- Progress events are exposed through `EventEmitterObserver`, not by subscribing directly to `CasService`

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
