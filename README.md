<div align="center">
  <img src="https://raw.githubusercontent.com/git-stunts/git-cas/2b0111bb5001123eb13b01e793bd63c338f86534/docs/git-cas.svg" />
  <h3><i>Git, freebased: pure CAS that’ll knock your SHAs off. LFS hates this repo.</i></h3>
</div>

<hr />

<img width="420" alt="git-cas" src="https://github.com/user-attachments/assets/e7cb63b9-25b7-4369-b053-4a35962ccee4" align="right" />

### JESSIE, STOP—

> Hold on. He’s turning Git into a blob store. Let him cook.

**Most potent clone available on GitHub (legally).**

### 

`git-cas` uses Git's object database as a storage layer for large, awkward, or
security-sensitive files.

It stores content as chunk blobs, records how to rebuild that content in a
manifest, can emit a real Git tree for reachability, and can keep named assets
reachable through a GC-safe vault ref.

This repo ships three surfaces over the same core:

- a JavaScript library for Node-first applications
- a human CLI/TUI (`git-cas`, and `git cas` when installed as a Git subcommand)
- a machine-facing agent CLI for structured automation flows

Primary runtime support is Node.js 22+. The project also maintains a Bun and
Deno test matrix.

## What It Is Good At

- storing binary assets, artifacts, bundles, and other files directly in Git
- chunk-level deduplication using fixed-size or content-defined chunking (CDC)
- optional gzip compression before storage
- optional AES-256-GCM encryption
- passphrase-derived keys via PBKDF2 or scrypt
- multi-recipient envelope encryption and recipient mutation
- key rotation without re-encrypting underlying data blobs
- manifest serialization in JSON or CBOR
- large-asset support through Merkle-style sub-manifests
- a GC-safe vault index under `refs/cas/vault`
- integrity verification, vault diagnostics, and an interactive inspector

## What It Is Not

`git-cas` is not:

- a hosted blob service
- a secret-management platform
- an access-control system
- metadata-oblivious storage
- secure deletion

Even when encryption is enabled, repository readers can still see metadata such
as slugs, filenames, chunk counts, object relationships, recipient labels, and
vault metadata. See
[SECURITY.md](https://github.com/git-stunts/git-cas/blob/main/SECURITY.md)
and
[docs/THREAT_MODEL.md](https://github.com/git-stunts/git-cas/blob/main/docs/THREAT_MODEL.md)
for the exact boundary.

## Honest Operational Notes

- Plaintext, uncompressed restore can stream chunk-by-chunk.
- Encrypted or compressed restore currently uses a buffered path guarded by
  `maxRestoreBufferSize` (default `512 MiB`).
- Encryption removes most of the dedupe advantage of CDC because ciphertext is
  pseudorandom.
- Git will happily retain a large number of blobs for you, but that does not
  mean storage management disappears. You still need to think about repository
  size, reachability, and maintenance.
- The manifest is the authoritative description of asset order and repeated
  chunks. The emitted tree is a reachability artifact, not the reconstruction
  source of truth.

## Install

For the library:

```bash
npm install @git-stunts/git-cas @git-stunts/plumbing
```

For the CLI:

```bash
npm install -g @git-stunts/git-cas
```

## CLI Quick Start

This is the shortest practical path from an empty repo to a stored and restored
asset.

```bash
mkdir demo-cas
cd demo-cas
git init

git-cas vault init

printf 'hello from git-cas\n' > hello.txt

git-cas store hello.txt --slug demo/hello --tree
git-cas inspect --slug demo/hello
git-cas verify --slug demo/hello
git-cas restore --slug demo/hello --out hello.restored.txt
```

If `git-cas` is installed on your `PATH`, Git can also invoke it as `git cas`.

Useful first commands:

- `git-cas store <file> --slug <slug> --tree`
- `git-cas restore --slug <slug> --out <path>`
- `git-cas inspect --slug <slug>`
- `git-cas verify --slug <slug>`
- `git-cas vault list`
- `git-cas vault stats`
- `git-cas doctor`

## Library Quick Start

```js
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '@git-stunts/git-cas';

const plumbing = new GitPlumbing({ cwd: './demo-cas' });
const cas = ContentAddressableStore.createJson({ plumbing });

const manifest = await cas.storeFile({
  filePath: './hello.txt',
  slug: 'demo/hello',
});

const treeOid = await cas.createTree({ manifest });
const reread = await cas.readManifest({ treeOid });

await cas.restoreFile({
  manifest: reread,
  outputPath: './hello.restored.txt',
});

const ok = await cas.verifyIntegrity(reread);
console.log({ treeOid, ok });
```

Common library entry points:

- `storeFile()`
- `createTree()`
- `readManifest()`
- `restoreFile()`
- `verifyIntegrity()`
- `inspectAsset()`
- `collectReferencedChunks()`
- `initVault()`, `addToVault()`, `listVault()`, `resolveVaultEntry()`
- `addRecipient()`, `removeRecipient()`, `listRecipients()`, `rotateKey()`
- `rotateVaultPassphrase()`

## Feature Overview

### Chunking

`git-cas` supports both fixed-size chunking and content-defined chunking.
Fixed-size chunking is simpler and predictable. CDC is more resilient to
insertions and shifting edits. See
[docs/BENCHMARKS.md](https://github.com/git-stunts/git-cas/blob/main/docs/BENCHMARKS.md)
for current published baselines.

### Trees And Reachability

Stored chunks live as ordinary Git blobs. `createTree()` writes a manifest blob
plus the referenced chunk blobs into a Git tree so the asset becomes reachable
like any other Git object.

### Vault

The vault is a commit-backed slug index rooted at `refs/cas/vault`. It exists
to keep named assets reachable across normal Git garbage collection and to make
slug-based workflows practical.

### Encryption

The project supports:

- raw 32-byte encryption keys
- passphrase-derived keys
- recipient-based envelope encryption
- recipient mutation and key rotation
- vault passphrase rotation for envelope-encrypted vault entries

The cryptography is useful, but it is not invisible. Metadata remains visible.
Read
[SECURITY.md](https://github.com/git-stunts/git-cas/blob/main/SECURITY.md)
and
[docs/THREAT_MODEL.md](https://github.com/git-stunts/git-cas/blob/main/docs/THREAT_MODEL.md)
before treating this as a secrets solution.

### Observability

The core domain is wired through an observability port rather than Node's event
system directly. The repo ships:

- `SilentObserver`
- `EventEmitterObserver`
- `StatsCollector`

## Documentation Map

If you want depth instead of a front page:

- [docs/GUIDE.md](https://github.com/git-stunts/git-cas/blob/main/docs/GUIDE.md)
  - long-form walkthrough
- [docs/API.md](https://github.com/git-stunts/git-cas/blob/main/docs/API.md)
  - command and API reference
- [ARCHITECTURE.md](https://github.com/git-stunts/git-cas/blob/main/ARCHITECTURE.md)
  - high-level system map
- [SECURITY.md](https://github.com/git-stunts/git-cas/blob/main/SECURITY.md)
  - crypto and security-relevant implementation notes
- [docs/THREAT_MODEL.md](https://github.com/git-stunts/git-cas/blob/main/docs/THREAT_MODEL.md)
  - attacker model, trust boundaries, exposed metadata, non-goals
- [docs/BENCHMARKS.md](https://github.com/git-stunts/git-cas/blob/main/docs/BENCHMARKS.md)
  - published chunking baselines
- [examples/README.md](https://github.com/git-stunts/git-cas/blob/main/examples/README.md)
  - runnable examples
- [CHANGELOG.md](./CHANGELOG.md)
  - release history

## When To Use It

Use `git-cas` when you want:

- artifacts to stay inside Git instead of moving to a separate blob service
- explicit chunk-level storage and verification
- Git-native reachability via trees and refs
- encryption on top of Git's object database without inventing a second storage
  system

Do not use `git-cas` when you actually need:

- per-user authorization
- opaque metadata
- remote multi-tenant storage management
- secret recovery or escrow
- transparent large-file ergonomics with no Git tradeoffs

## Examples

Runnable examples live in
[examples/](https://github.com/git-stunts/git-cas/tree/main/examples):

- [examples/store-and-restore.js](https://github.com/git-stunts/git-cas/blob/main/examples/store-and-restore.js)
- [examples/encrypted-workflow.js](https://github.com/git-stunts/git-cas/blob/main/examples/encrypted-workflow.js)
- [examples/progress-tracking.js](https://github.com/git-stunts/git-cas/blob/main/examples/progress-tracking.js)

## Project Status

This is an active project with a real multi-runtime test matrix and an evolving
docs/planning surface. The public front door should be treated as:

- README for orientation
- API/guide docs for detail
- changelog for release-by-release history

If you are evaluating the system seriously, read the security and threat-model
docs before designing around encrypted storage behavior.
