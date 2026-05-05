# Store And Restore Pipeline State Machines

This document is the maintainer map for the `CasService` store and restore
paths. It explains the behavioral states that must remain stable while
`CasService.js` is being decomposed into smaller services.

The public facade (`ContentAddressableStore`) wires adapters and convenience
file helpers. The domain service owns byte validation, chunk dispatch,
encryption routing, manifest construction, integrity checks, and restore plan
selection. Git tree publication and vault mutation are adjacent workflows, not
part of the core byte pipeline.

## Store State Machine

The store pipeline begins at `CasService.store()` and ends with a `Manifest`
value object. It does not publish a Git tree or update the vault by itself.

### State: Validate Input

Inputs are validated before any Git object is written. The service verifies that
the source is async-iterable, the slug and filename are usable manifest values,
compression options are supported, and encryption key sources are mutually
exclusive. This state must remain side-effect free.

Exit conditions:

- Invalid source, slug, filename, compression, or credential combinations fail
  before chunk writes begin.
- Valid inputs advance to key and scheme resolution.

### State: Resolve Encryption

The key resolver converts store credentials into either no key, a direct key, a
passphrase-derived key, or envelope recipient metadata. The encryption scheme is
then selected.

Scheme rules:

- No key means plaintext storage.
- Fixed chunking plus encryption defaults to `framed`.
- CDC chunking plus encryption defaults to deterministic `convergent`.
- Explicit `whole`, `framed`, or `convergent` scheme selections win.
- `encryption.convergent: false` opts CDC callers out of convergent mode and
  uses `framed`.

Required warnings:

- CDC plus implicit `convergent` emits a warning because deterministic
  ciphertext can reveal content equality.
- CDC plus non-convergent encryption emits a warning because ciphertext defeats
  CDC deduplication.

### State: Prepare Source

The source remains streaming unless compression or encryption requires a
specific transform. Compression wraps the source before encryption selection is
dispatched. This keeps the manifest model consistent: manifests describe the
stored byte shape, not just the caller's original input bytes.

Exit conditions:

- Plain and convergent stores pass the prepared source into chunk dispatch.
- Framed stores transform the source into authenticated frame records before
  chunk dispatch.
- Whole encryption buffers the prepared source before writing encrypted bytes.

### State: Dispatch Chunks

The chunk dispatcher is responsible for concurrency, chunk indexing, digest
calculation, blob writes, orphan tracking, and `chunk:stored` metrics. It is the
shared path for plaintext, convergent, framed, compressed, and most transformed
stores.

Invariants:

- Manifest chunk order follows source order even when blob writes run with
  concurrency.
- `STORE_ERROR` includes failed-index and orphaned-blob metadata when writes
  fail after earlier chunks were persisted.
- Convergent mode encrypts each plaintext chunk after calculating its plaintext
  digest, then writes the ciphertext plus authentication tag.
- Plain and framed modes write the bytes they receive from their upstream
  source transform.

### State: Finalize Manifest

The manifest is finalized only after chunk dispatch succeeds. Store metadata is
assembled from the chosen chunker, compression settings, encryption metadata,
format version, size totals, and chunk references.

Exit conditions:

- A successful store returns a `Manifest`.
- `file:stored` is emitted after the manifest is constructed.
- No tree or vault state is changed by `store()`.

## Restore State Machine

The restore pipeline begins with a manifest and produces either an async byte
stream, an in-memory `Uint8Array`, or a verified file on disk.

### State: Validate Manifest

Restore first validates encryption metadata, compression metadata, and key
requirements. Invalid or legacy scheme metadata fails before chunk reads begin.

Exit conditions:

- Plain manifests can restore without credentials.
- Encrypted manifests require a matching direct key, passphrase-derived key, or
  recipient-unwrapped key.
- Legacy scheme identifiers fail in normal mode and require migration.

### State: Select Restore Plan

Restore selects one of the named restore plans based on encryption,
compression, and available adapter capabilities.

Plan families:

- `streaming`: plaintext uncompressed data streams chunk-by-chunk.
- `compressed-streaming`: plaintext compressed data streams through the
  compression adapter.
- `framed`: framed encrypted data authenticates each frame while streaming.
- `framed-compressed`: framed encrypted compressed data authenticates frames,
  then decompresses.
- `convergent`: convergent encrypted chunks decrypt and verify independently.
- `convergent-compressed`: convergent decrypts chunk-by-chunk, then
  decompresses.
- `buffered`: whole-object encrypted or compression-buffered data enforces
  `maxRestoreBufferSize`.

### State: Verify And Emit Bytes

Every restore plan verifies chunk digests or authentication before exposing the
corresponding plaintext bytes to the caller. `restoreStream()` emits verified
chunks as they become available. `restore()` materializes those bytes into a
single `Uint8Array`. `restoreFile()` writes tentative output and only renames it
into place after verification succeeds.

Invariants:

- Wrong keys fail with integrity errors.
- Oversized buffered restore paths fail before unbounded memory growth.
- `chunk:restored`, `file:restored`, `integrity:pass`, `integrity:fail`, and
  `error` events remain observable at the same semantic points.
- Callers never receive unauthenticated encrypted plaintext as final output.

## Tree And Vault Publication Boundaries

`createTree()` publishes a manifest and chunk references as a Git tree. It is a
separate state machine from `store()` because callers may inspect, diff, or
discard a manifest before publication.

Tree publication states:

- Encode manifest data with the selected codec.
- Add manifest integrity hash before writing manifest bytes.
- Write flat trees when the chunk count is below `merkleThreshold`.
- Write sub-manifests and a root Merkle manifest when the chunk count exceeds
  `merkleThreshold`.
- Write chunk entries using Git tree-entry formatting.

Vault publication states:

- `initVault()` creates or reuses the vault ref.
- `addToVault()` records a slug-to-tree mapping and commits it under
  `refs/cas/vault`.
- `removeFromVault()` deletes a mapping.
- Encrypted or privacy-enabled vaults require credential-derived metadata and
  must maintain nonce accounting.
- Vault mutations use optimistic retry and must not be folded into store or
  restore byte-processing services.

## Extraction Guidance

Future decomposition should preserve the state-machine boundaries above.

Recommended service boundaries:

- Store coordinator: validation, key resolution, scheme resolution, and
  manifest finalization.
- Chunk writer: chunk dispatch, concurrency, digesting, blob writes, and orphan
  metadata.
- Restore planner: plan selection and capability checks.
- Restore executors: streaming, framed, convergent, compressed, and buffered
  execution paths.
- Tree publisher: manifest hashing, manifest blob writes, Merkle sub-manifest
  layout, and Git tree-entry construction.

The most important rule is that extraction must not change the sequence of
validation, warning emission, writes, authentication, or observer events.
