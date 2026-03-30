# Architecture: `git-cas`

This document is the high-level map of the shipped `git-cas` system.

It is intentionally not a full API reference. For command and method details,
see [docs/API.md](./docs/API.md). For crypto and security guidance, see
[SECURITY.md](./SECURITY.md).

## System Model

`git-cas` uses Git as the storage substrate, not as a user-facing abstraction.

At a high level, the system does four things:

1. turns input bytes into chunk blobs stored in Git
2. records how to rebuild those bytes in a manifest
3. emits a Git tree that keeps the manifest and chunk blobs reachable
4. optionally indexes trees by slug through a GC-safe vault ref

The same core supports:

- a library facade in [index.js](./index.js)
- a human CLI and TUI under `bin/`
- a machine-facing agent CLI under `bin/agent/`

Those surfaces are different contracts over one shared core.

## Layer Model

### Facade

The public entrypoint is [index.js](./index.js).

`ContentAddressableStore` is a high-level facade that:

- lazily initializes the underlying services
- selects the appropriate crypto adapter for the current runtime
- resolves chunking strategy configuration
- wires persistence, ref, codec, crypto, chunking, and observability adapters
- exposes convenience methods like `storeFile()` and `restoreFile()`

The facade is orchestration glue. It is not the storage engine itself.

### Domain

The domain lives under `src/domain/`.

Current key domain pieces:

- `Manifest` and `Chunk`
  - value objects that describe stored content and chunk metadata
- `CasService`
  - the main content orchestration service
  - handles store, restore, tree creation, manifest reads, inspection, and
    recipient/key operations
- `KeyResolver`
  - resolves key sources, passphrase-derived keys, and envelope recipient DEK
    wrapping and unwrapping
- `VaultService`
  - manages the GC-safe vault ref and its commit-backed slug index
- `rotateVaultPassphrase`
  - coordinates vault-wide passphrase rotation across existing entries
- `CasError`
  - the canonical domain error type with stable codes and metadata

Public API boundary:

- the package entry re-exports `Manifest`, `Chunk`, `CasService`, and
  `VaultService`
- `KeyResolver`, `rotateVaultPassphrase`, and `CasError` are internal domain
  implementation details, even though they are important architectural pieces

`CasService` is still the central orchestration unit for content flows. That is
current architecture truth, not a future-state claim.

### Ports

The ports live under `src/ports/`.

They define the seams the domain depends on:

- `GitPersistencePort`
  - blob and tree read/write operations
- `GitRefPort`
  - ref resolution, commit creation, and compare-and-swap ref updates
- `CodecPort`
  - manifest encoding and decoding
- `CryptoPort`
  - hashing, encryption, decryption, random bytes, and KDF operations
- `ChunkingPort`
  - strategy interface for fixed-size and content-defined chunking
- `ObservabilityPort`
  - metrics, logs, and spans without binding the domain to Node event APIs

### Infrastructure

The infrastructure layer lives under `src/infrastructure/`.

Current shipped adapters include:

- `GitPersistenceAdapter`
- `GitRefAdapter`
- `NodeCryptoAdapter`
- `BunCryptoAdapter`
- `WebCryptoAdapter`
- `JsonCodec`
- `CborCodec`
- `FixedChunker`
- `CdcChunker`
- `SilentObserver`
- `EventEmitterObserver`
- `StatsCollector`

There are also small adapter helpers such as:

- `createCryptoAdapter`
  - runtime-adaptive crypto selection
- `resolveChunker`
  - chunker construction from config
- `FileIOHelper`
  - file-backed convenience helpers for the facade

## Storage Model

### Chunks

Stored content is broken into chunks and written as Git blobs.

The manifest records the authoritative ordered chunk list, including:

- chunk index
- chunk size
- SHA-256 digest
- backing blob OID

The manifest, not the tree layout, is the source of truth for reconstruction
order and repeated chunk occurrences.

### Manifests

Manifests are encoded through the configured codec:

- JSON by default
- CBOR when configured

Small and medium assets use a single manifest blob.

Large assets already use Merkle-style manifests. When chunk count exceeds
`merkleThreshold`, `createTree()` writes:

- a root manifest with `version: 2`
- an empty top-level `chunks` array
- `subManifests` references pointing at additional manifest blobs

`readManifest()` resolves those sub-manifests transparently and reconstructs the
flat logical chunk list for callers.

Merkle manifests are shipped behavior, not future work.

### Trees

`createTree()` emits a Git tree that keeps the asset reachable.

For non-Merkle assets the tree contains:

- `manifest.<ext>`
- one blob entry per unique chunk digest, in first-seen order

For Merkle assets the tree contains:

- `manifest.<ext>`
- `sub-manifest-<n>.<ext>` blobs
- one blob entry per unique chunk digest, in first-seen order

Chunk blobs are deduplicated at the tree-entry level by digest. The manifest
still remains authoritative for repeated-chunk order and multiplicity.

### Vault

The vault is a GC-safe slug index rooted at `refs/cas/vault`.

It is implemented as a commit chain. Each vault commit points to a tree
containing:

- one tree entry per stored slug, mapped to that asset's tree OID
- `.vault.json` metadata for vault configuration

`VaultService` owns:

- slug validation
- vault initialization
- add, update, list, resolve, remove, and history-oriented state reads
- compare-and-swap ref updates with retry on conflict
- vault metadata validation

Vault metadata can include passphrase-derived encryption configuration and
related counters, but the vault still fundamentally acts as the durable
slug-to-tree index for stored assets.

## Core Flows

### Store

The store path looks like this:

1. resolve key source or recipient envelope settings
2. optionally gzip the input stream
3. choose a chunking strategy
4. optionally encrypt the processed stream
5. write chunk blobs to Git
6. build a manifest
7. optionally emit a Git tree and add it to the vault

Important current behavior:

- encryption and recipient envelope setup are mutually exclusive
- CDC is supported, but encryption removes CDC dedupe benefits because
  ciphertext is pseudorandom
- observability ports receive metrics and warnings throughout the flow

### Restore

The restore path:

1. reads a manifest from a tree or receives one directly
2. resolves decryption key material if needed
3. reads and verifies chunk blobs by SHA-256 digest
4. either streams plaintext chunks directly or buffers for decrypt/decompress
5. returns bytes or writes them to disk through the facade helper

For unencrypted and uncompressed assets, restore can operate as true chunk
streaming. Encrypted or compressed restores currently use a buffered path with
explicit size guards.

### Vault Mutation

Vault mutation is separate from the core chunk store.

`VaultService` updates `refs/cas/vault` through compare-and-swap semantics,
creating a new commit for each successful mutation and retrying on conflicts.

That keeps slug resolution durable across `git gc` while leaving the content
store itself in ordinary Git objects.

## Runtime Model

`git-cas` targets multiple JavaScript runtimes.

The core architecture is designed so the domain does not care whether it is
running on Node, Bun, or a Web Crypto-capable environment. Runtime differences
are isolated in the infrastructure adapters and selected by the facade or CLI
bootstrapping code.

The repo enforces this with a real Node, Bun, and Deno test matrix.

## Honest Pressure Points

The main architectural pressure point today is `CasService`.

It already benefits from some meaningful extractions:

- `KeyResolver`
- `VaultService`
- `rotateVaultPassphrase`
- chunker and crypto adapter factories
- file I/O helpers

But it still owns a broad content-orchestration surface:

- store and restore
- manifest and tree handling
- lifecycle inspection helpers
- recipient mutation and key rotation

That is good candidate pressure for future decomposition work, but it is not yet
a completed architectural split.

## Reading This With Other Docs

Use this document for the current system shape.

Use these docs for adjacent truth:

- [README.md](./README.md)
  - positioning, feature overview, and release highlights
- [docs/API.md](./docs/API.md)
  - library and CLI reference
- [SECURITY.md](./SECURITY.md)
  - crypto and security guidance
- [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md)
  - threat model, assets, and trust boundaries
- [WORKFLOW.md](./WORKFLOW.md)
  - current planning and delivery model
