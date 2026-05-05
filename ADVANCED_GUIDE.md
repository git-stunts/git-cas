# Advanced Guide -- git-cas

Deep-dive reference for advanced features, internals, and tuning. For
orientation and the productive-fast path, start with the [GUIDE.md](./GUIDE.md).

---

```insta-toc
---
title:
  name:
  level:
  center:
exclude:
style:
  listType:
omit:
levels:
  min:
  max:
---

# Table of Contents

- Advanced Guide -- git-cas
    - Content-Defined Chunking (CDC)
        - Algorithm Overview
        - Buzhash Rolling Hash
        - Mask Derivation
        - FastCDC Dual-Mask Normalization
        - Default Parameters
        - Encryption Penalty
    - Encryption Schemes
        - Legacy Scheme Rejection
        - whole
        - framed (default for fixed encrypted stores)
        - convergent
        - Why AAD Matters
        - Scheme Selection
        - Auto-Selection
    - Convergent Encryption
        - Key Derivation
        - Blob Format
        - Restore Verification
        - Trade-offs
    - KDF Policy
        - PBKDF2-SHA512
        - scrypt
        - Enforcement Points
    - Manifest Integrity Hash
        - Computation (store)
        - Verification (read)
        - What It Catches
        - Backward Compatibility
    - Format Version
    - Manifest Diffing
        - Return Value
        - Use Cases
        - Example
    - Parallel Chunk Restore
        - How It Works
        - Configuration
    - Merkle Manifests
        - Structure
        - Git Tree Layout
        - Validation
        - Limits
    - Vault Privacy Mode
        - How It Works
        - Requirements
        - Limitations
    - Envelope Encryption
        - Multi-Recipient Model
        - Trial Decryption
        - Key Rotation
        - Adding and Removing Recipients
    - Streaming Decompression
    - CompressionPort Architecture
        - Port Interface
        - NodeCompressionAdapter
        - Pluggability
    - Direct CasService and Custom Port Contracts
        - Minimal Direct Service
        - Required Port Shape
        - Runtime and Facade Split
    - Security Hardening Summary
    - Operational Tooling
        - Migration
        - Release Verification
        - Build Metadata
    - Performance Baselines
    - Configuration Reference
        - store() Options
        - CdcChunker Options
```

---

## Content-Defined Chunking (CDC)

`git-cas` ships two chunking strategies: **fixed** (default) and **CDC**
(content-defined chunking). CDC uses the Buzhash rolling hash algorithm to
find chunk boundaries that are determined by the content itself, not by byte
offset. Small edits to a file only affect nearby chunks, giving significantly
better deduplication across versions of the same asset.

### Algorithm Overview

CDC processing runs in three sequential phases per chunk:

1. **Fill window** -- the first 64 bytes of each new chunk populate a sliding
   ring buffer. The hash is seeded by XOR-ing in byte-table entries without
   removing an outgoing byte (the window is not yet full).

2. **Pre-min feed** -- bytes between position 64 and `minChunkSize` are
   bulk-copied into the chunk buffer while the rolling hash is updated
   (incoming byte XOR-ed in, outgoing byte XOR-ed out), but no boundary check
   is performed. This guarantees every emitted chunk is at least `minChunkSize`
   bytes.

3. **Boundary scan** -- from `minChunkSize` to `maxChunkSize`, each byte is
   fed into the hash and tested against a bitmask. When `(hash & mask) === 0`,
   a boundary is declared and the accumulated bytes are emitted as a chunk. If
   `maxChunkSize` is reached without a match, the chunk is emitted anyway.

A final partial chunk smaller than `minChunkSize` is allowed at EOF.

### Buzhash Rolling Hash

The hash function is Buzhash with a **64-byte sliding window**. The byte
table is a deterministic `Uint32Array[256]` generated from a seeded
**xorshift64 PRNG** (seed `0x6a09e667f3bcc908`). Because the table is
derived from a fixed seed, every runtime produces identical values without
needing `crypto.getRandomValues`.

The update step for a full window is:

```
hash = rotateLeft32(hash, 1) XOR table[outgoingByte] XOR table[incomingByte]
```

The window write position is tracked modulo 64 using a bitmask
(`winPos = (winPos + 1) & 63`).

### Mask Derivation

The boundary mask is derived from `targetChunkSize`:

```
bits = floor(log2(targetChunkSize))
mask = (1 << bits) - 1
```

For the default target of 262,144 bytes (2^18), `mask = 0x3FFFF`. On average
the hash matches once every `mask + 1` bytes, centering the distribution
around the target.

### FastCDC Dual-Mask Normalization

When `normalized: true` (the default), a dual-mask strategy from the FastCDC
paper is applied. Instead of a single mask, two masks control boundary
probability relative to the current chunk length:

| Region | Mask | Bits | Effect |
| :--- | :--- | :--- | :--- |
| Below target (`chunkLen < targetSize`) | `hardMask` | `bits + 1` | More bits required to match -- boundaries are **less likely**, pushing chunks larger |
| At or above target (`chunkLen >= targetSize`) | `easyMask` | `bits - 1` | Fewer bits required -- boundaries are **more likely**, pulling chunks back toward the target |

Concrete formulas:

```
hardMask = (1 << min(bits + 1, 31)) - 1
easyMask = (1 << max(bits - 1,  1)) - 1
```

The effect is a tighter distribution of chunk sizes around the target, lower
variance, and better deduplication efficiency compared to a single-mask
approach.

To disable normalization:

```js
const chunker = new CdcChunker({ targetChunkSize: 262144, normalized: false });
```

### Default Parameters

| Parameter | Default | Bounds |
| :--- | :--- | :--- |
| `targetChunkSize` | 262,144 (256 KiB) | Must be in `[minChunkSize, maxChunkSize]` |
| `minChunkSize` | 65,536 (64 KiB) | Must not exceed `maxChunkSize` |
| `maxChunkSize` | 1,048,576 (1 MiB) | Hard cap at 100 MiB |
| `normalized` | `true` | Boolean |

### Encryption Penalty

CDC deduplication is **ineffective** when using `whole` or `framed` encryption.
Ciphertext is pseudorandom, so there are no structural byte patterns for the
rolling hash to latch onto. `CasService` emits a warning when CDC is combined
with these schemes. Use **convergent encryption** (`convergent` scheme) to
preserve deduplication across encrypted versions -- see the
[Convergent Encryption](#convergent-encryption) section below.

---

## Encryption Schemes

`git-cas` supports three AES-256-GCM encryption schemes. All use 256-bit keys,
96-bit random nonces, and 128-bit authentication tags. AAD (Additional
Authenticated Data) binding is always active -- there are no non-AAD variants.

The single source of truth for scheme identifiers is
`src/domain/encryption/schemes.js`.

### Legacy Scheme Rejection

The v1/v2 suffixed schemes (`whole-v1`, `whole-v2`, `framed-v1`, `framed-v2`,
`convergent-v1`) are no longer accepted. Any manifest referencing a legacy
scheme is rejected at runtime with a `LEGACY_SCHEME` error that directs the
user to the migration script:

```
scripts/migrate-encryption.js
```

The migration script migrates manifests to current scheme identifiers — renaming
v2 schemes directly and re-encrypting v1 schemes with AAD binding.

### whole

Single AES-256-GCM envelope over the entire chunked ciphertext stream. The
nonce and authentication tag are stored in the manifest's `encryption` object.

- Store: plaintext source -> streaming encrypt -> chunk -> store blobs
- Restore: read blobs -> concatenate -> single-shot decrypt -> verify tag
- AAD: UTF-8 encoded slug bytes -- prevents cross-manifest blob
  substitution by binding the ciphertext to the manifest slug
- Manifest fields: `scheme: "whole"`, `nonce`, `tag`

Limitations: the full ciphertext must fit in memory during restore (bounded by
`maxRestoreBufferSize`, default 512 MiB). No incremental authentication.

### framed (default for fixed encrypted stores)

Per-frame authenticated encryption with independently verifiable records.
Plaintext is split into fixed-size frames (default 64 KiB, max 64 MiB),
each encrypted separately. Restore can authenticate and emit plaintext
incrementally without buffering the full payload.

**Per-frame AAD binding**:

```
AAD = slug (UTF-8) + NUL byte (0x00) + frame index (4 bytes, big-endian)
```

This prevents both slug tampering and frame reordering or deletion attacks.
Each frame's authentication tag commits to its position within the stream.

**Binary record layout** (one record per frame):

```
 0                   4                  16                 32
 +-------------------+------------------+------------------+
 | ciphertext length | nonce (12 bytes) | tag (16 bytes)   |
 | (4 bytes, BE)     |                  |                  |
 +-------------------+------------------+------------------+
 |                   ciphertext ...                        |
 +--------------------------------------------------------+
```

- Byte 0-3: `uint32be` ciphertext length
- Byte 4-15: 12-byte AES-GCM nonce
- Byte 16-31: 16-byte authentication tag
- Byte 32+: ciphertext (length given by bytes 0-3)

Total header overhead per frame: **32 bytes**.

- Manifest fields: `scheme: "framed"`, `frameBytes`

### convergent

Per-chunk deterministic encryption that preserves deduplication. Identical
plaintext chunks always produce identical ciphertext, so CDC deduplication
works even when encryption is enabled. See the dedicated
[Convergent Encryption](#convergent-encryption) section below.

- Manifest fields: `scheme: "convergent"`

### Why AAD Matters

Without AAD, an attacker with write access to the repository can:

1. Copy encrypted blob OIDs from manifest A into manifest B (cross-manifest
   blob substitution). Decryption succeeds if both manifests share the same
   key, but the restored content is wrong.
2. For framed schemes, reorder or remove individual frame records within the
   ciphertext stream.

AAD binds the encryption to the manifest identity and (for framed) the
frame sequence, so any such tampering causes GCM authentication failure.

### Scheme Selection

| Scenario | Recommended Scheme |
| :--- | :--- |
| Fixed chunking + encryption | `framed` (default) |
| Large assets needing streaming restore | `framed` |
| CDC with encryption (dedup-preserving) | `convergent` |
| Single-envelope simplicity | `whole` |

### Auto-Selection

When an encryption key is provided without an explicit scheme, `CasService`
selects the scheme automatically:

- If the chunker strategy is `cdc`, the `convergent` scheme is selected
  (preserving dedup).
- Otherwise, `framed` is selected.

This can be overridden by passing `encryption.convergent: false` or by
setting an explicit `encryption.scheme`.

---

## Convergent Encryption

Convergent encryption is extracted as its own service
(`src/domain/services/ConvergentEncryption.js`) and encapsulates per-chunk
deterministic encryption where the key and nonce are derived from the
plaintext content hash.

### Key Derivation

For each chunk, the master encryption key and the chunk's SHA-256 digest are
used to derive a unique key and nonce:

```
chunkKey   = HMAC-SHA256(masterKey, "git-cas-convergent-key:<digest>")[0..31]
chunkNonce = HMAC-SHA256(masterKey, "git-cas-convergent-nonce:<digest>")[0..11]
```

Because the derivation is deterministic, identical plaintext chunks (same
digest) always produce the same ciphertext, preserving content-addressed
deduplication.

### Blob Format

Each encrypted chunk blob is stored as:

```
ciphertext || 16-byte GCM authentication tag
```

### Restore Verification

On restore, each chunk is decrypted and its plaintext SHA-256 is recomputed.
If the recomputed digest does not match the expected digest from the manifest,
an `INTEGRITY_ERROR` is thrown. This catches both decryption failures and
post-decryption corruption.

### Trade-offs

- Deduplication is preserved across encrypted versions of the same asset.
- Deterministic encryption means identical plaintext always yields identical
  ciphertext, which leaks equality information. If this is a concern, use
  `framed` or `whole` instead.
- Convergent encryption operates post-chunk (after CDC or fixed chunking),
  unlike `whole` and `framed` which encrypt pre-chunk.

---

## KDF Policy

When passphrase-based encryption is used, `git-cas` derives 256-bit keys
using PBKDF2-SHA512 or scrypt. A strict policy enforces parameter bounds
at both store time and restore time.

### PBKDF2-SHA512

| Parameter | Default | Min | Max |
| :--- | ---: | ---: | ---: |
| `iterations` | 600,000 | 100,000 | 2,000,000 |
| `keyLength` | 32 | -- | -- (locked) |

### scrypt

| Parameter | Default | Min | Max |
| :--- | ---: | ---: | ---: |
| `cost` (N) | 131,072 (2^17) | 16,384 (2^14) | 1,048,576 (2^20) |
| `blockSize` (r) | 8 | 8 | 32 |
| `parallelization` (p) | 1 | 1 | 16 |
| `keyLength` | 32 | -- | -- (locked) |

Additional constraints:
- `cost` must be a power of two.
- Combined scrypt memory budget `128 * N * r` is capped at **1 GiB**.
- Salt must be at least **16 bytes** (128 bits), per NIST SP 800-132.
- Salt must be canonical base64.
- `keyLength` is locked at exactly 32 bytes; any other value is rejected.
- Runtime support: Node and Bun adapters support scrypt. Web Crypto runtimes,
  including the Deno adapter, report an explicit capability error for scrypt.

### Enforcement Points

Policy is checked in four places:

1. **`store()` with passphrase** -- new write defaults are applied and
   validated before derivation.
2. **`restore()` with passphrase** -- stored manifest KDF metadata is
   validated against the policy window before derivation begins. Hostile or
   out-of-policy parameters fail with `KDF_POLICY_VIOLATION`.
3. **`initVault()` with passphrase** -- vault-level KDF parameters are
   validated at initialization.
4. **`rotateVaultPassphrase()`** -- both old and new KDF parameters are
   validated.

---

## Manifest Integrity Hash

Every manifest written by `createTree()` includes a `manifestHash` field:
a SHA-256 hex digest of the codec-encoded manifest data (with the
`manifestHash` field itself excluded, and `undefined` values stripped to
match codec round-trip behavior).

### Computation (store)

```
1. Serialize manifest data to JSON/CBOR (minus manifestHash and undefined keys)
2. SHA-256 the resulting bytes
3. Store the 64-char hex digest as manifestHash in the manifest
4. Serialize the complete manifest (including manifestHash) for the blob
```

### Verification (read)

On `readManifest()`, if the decoded manifest contains a `manifestHash` field:

1. Re-encode the manifest (minus `manifestHash` and undefined keys)
2. SHA-256 the bytes
3. Compare against the stored `manifestHash`
4. If mismatch, throw `MANIFEST_INTEGRITY_ERROR`

### What It Catches

- Git object store corruption (bit-rot, truncation)
- Codec round-trip bugs (JSON/CBOR encoding asymmetry)
- Manual manifest editing errors

### Backward Compatibility

Old manifests without a `manifestHash` field skip verification silently. The
field is optional in the schema and only enforced when present.

---

## Format Version

Manifests may carry a `formatVersion` field -- a semver string (e.g.,
`"1.0.0"`) stamped by `CasService` when the instance is constructed with a
`formatVersion` option. This is distinct from the structural `version: 1|2`
field that distinguishes flat manifests from Merkle manifests.

```js
import { FixedChunker, NodeCompressionAdapter } from '@git-stunts/git-cas';
import CasService from '@git-stunts/git-cas/service';

const cas = new CasService({
  persistence, codec, crypto, observability,
  chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
  compressionAdapter: new NodeCompressionAdapter(),
  formatVersion: '6.0.0',
});
```

When present, `formatVersion` records which release of `git-cas` produced
the manifest. It is validated against the regex `/^\d+\.\d+\.\d+$/` by the
manifest schema. The facade sets this from package metadata automatically;
direct `CasService` callers provide it themselves when they want the stamp.

---

## Manifest Diffing

`CasService.diffManifests(oldManifest, newManifest)` is a static method that
compares two manifests by chunk digest. It is a pure domain function with no
I/O, no ports, and no state -- just set algebra over chunk arrays.

### Return Value

```js
{
  added,      // Chunks in newManifest not in oldManifest
  removed,    // Chunks in oldManifest not in newManifest
  unchanged,  // Chunks in both (by digest), taken from newManifest
  summary: {
    addedCount, removedCount, unchangedCount,
    addedBytes, removedBytes, unchangedBytes,
  },
}
```

### Use Cases

- **Incremental sync**: determine which chunks need to be transferred when
  updating a previously stored asset.
- **Storage audit**: measure how much deduplication CDC achieves across
  versions by inspecting `unchangedBytes / totalBytes`.
- **Garbage collection**: identify chunks that are no longer referenced after
  an asset is updated.

### Example

```js
import CasService from '@git-stunts/git-cas/service';

const oldManifest = await cas.readManifest({ treeOid: oldOid });
const newManifest = await cas.readManifest({ treeOid: newOid });
const diff = CasService.diffManifests(oldManifest, newManifest);

console.log(diff.summary);
// { addedCount: 3, removedCount: 1, unchangedCount: 397, ... }
```

---

## Parallel Chunk Restore

`git-cas` uses a **PrefetchWindow** sliding window to restore chunks in
parallel with bounded concurrency while preserving strict output ordering.

### How It Works

The `prefetchChunks` async generator maintains a ring buffer of
`concurrency` in-flight fetch promises:

1. **Initial fill**: the first `concurrency` chunks are fetched immediately,
   populating the ring buffer.
2. **Yield in order**: the yield cursor advances through the ring buffer
   sequentially. Each slot is `await`-ed before yielding.
3. **Slide forward**: after a slot is yielded, it is immediately refilled
   with the next chunk fetch (if any remain), keeping the pipeline saturated.

This guarantees that:

- At most `concurrency` fetches are in-flight at any time (bounded memory).
- Output order matches manifest order (no reordering).
- Throughput scales with concurrency when I/O is the bottleneck.

### Configuration

Set `concurrency` on the `CasService` constructor:

```js
import { FixedChunker, NodeCompressionAdapter } from '@git-stunts/git-cas';
import CasService from '@git-stunts/git-cas/service';

const cas = new CasService({
  persistence, codec, crypto, observability,
  chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
  compressionAdapter: new NodeCompressionAdapter(),
  concurrency: 8,  // up to 8 parallel chunk reads
});
```

The `concurrency` option accepts an integer in `[1, 64]`. The default is `1`
(sequential reads). Higher values benefit network-backed or high-latency
persistence adapters.

---

## Merkle Manifests

When a stored asset produces more than `merkleThreshold` chunks (default
1,000), `git-cas` automatically transitions to a two-level Merkle-style
manifest structure.

### Structure

```
Root manifest (version: 2)
  +-- subManifests: [
  |     { oid: <sub-0>, chunkCount: 1000, startIndex: 0 },
  |     { oid: <sub-1>, chunkCount: 1000, startIndex: 1000 },
  |     { oid: <sub-2>, chunkCount: 423,  startIndex: 2000 },
  |   ]
  +-- chunks: []  (empty in root)
  +-- ...standard manifest fields...
```

Each sub-manifest blob contains a `{ chunks: [...] }` array of chunk entries.

### Git Tree Layout

```
manifest.json          -- root manifest blob (version 2)
sub-manifest-0.json    -- first sub-manifest blob
sub-manifest-1.json    -- second sub-manifest blob
sub-manifest-2.json    -- third sub-manifest blob
<chunk-digest-hex>     -- chunk blob entries (deduplicated by digest)
...
```

### Validation

On `readManifest()`, sub-manifests are resolved transparently:

1. Root manifest is decoded and its `manifestHash` verified.
2. Each `subManifests[i].oid` blob is read and decoded.
3. Each chunk entry in each sub-manifest is validated through `ChunkSchema`.
4. `chunkCount` declared in the root is compared against the actual decoded
   count. Mismatch throws `MANIFEST_INTEGRITY_ERROR`.
5. The flattened chunk array is returned as if it were a flat manifest.

### Limits

- `subManifests` array capped at **10,000 entries** (schema enforced).
- With 1,000 chunks per sub-manifest, that supports up to 10 million chunks
  per asset.

---

## Vault Privacy Mode

By default, vault tree entries use percent-encoded slug names, which are
visible to anyone with repository read access. Privacy mode replaces slugs
with opaque HMAC digests.

### How It Works

1. **Privacy key derivation**:
   ```
   privacyKey = HMAC-SHA256(vaultEncryptionKey, "git-cas-privacy-v1")
   ```
   The 32-byte privacy key is derived deterministically from the vault
   encryption key using a fixed label.

2. **Tree entry masking**: each slug is replaced with its HMAC:
   ```
   treeName = hex(HMAC-SHA256(privacyKey, slug))   // 64-char lowercase hex
   ```

3. **Encrypted privacy index**: a `.privacy-index` blob is written to the
   vault tree, containing an AES-256-GCM encrypted JSON mapping of
   `{ slug: hmacHex, ... }`. This allows `listVault()` and
   `resolveVaultEntry()` to reverse the mapping.

### Requirements

- Privacy mode requires vault encryption (`initVault({ passphrase, privacy: true })`).
- All vault read/write operations on a privacy-enabled vault require an
  `encryptionKey` parameter.

### Limitations

- Privacy mode does **not** scrub git history. Older commits created before
  privacy was enabled may still contain plain-text slug names.
- The `.privacy-index` blob is re-encrypted on every vault write. Its size
  grows linearly with the number of vault entries.
- HMAC is deterministic: the same slug always produces the same tree entry
  name (given the same key), which allows correlation across vault commits.

---

## Envelope Encryption

Envelope encryption uses a two-tier key model:

- **DEK** (Data Encryption Key): a random 32-byte key that encrypts the
  actual content. Generated once per `store()` call.
- **KEK** (Key Encryption Key): a per-recipient 32-byte key that wraps the
  DEK. Each recipient gets their own wrapped copy.

### Multi-Recipient Model

When storing with `recipients`:

```js
await cas.store({
  source,
  slug: 'asset/photo.raw',
  filename: 'photo.raw',
  recipients: [
    { label: 'alice', key: aliceKek },
    { label: 'bob',   key: bobKek },
  ],
});
```

1. A random 32-byte DEK is generated via `crypto.randomBytes(32)`.
2. Content is encrypted with the DEK using the configured scheme.
3. For each recipient, the DEK is AES-256-GCM wrapped with their KEK.
4. The manifest stores an array of `{ label, wrappedDek, nonce, tag }` entries.

### Trial Decryption

On restore, `KeyResolver.resolveKeyForRecipients()` iterates **all** recipient
entries and attempts to unwrap each one. The first successful unwrap provides
the DEK. All entries are always tried -- there is no early exit, no index
leak, and no timing oracle that reveals which recipient matched.

```
for each recipient entry:
    try unwrapDek(entry, providedKey)
    if success and no prior match: save result
    if DEK_UNWRAP_FAILED: continue
if no match found: throw NO_MATCHING_RECIPIENT
```

### Key Rotation

`rotateKey()` re-wraps the DEK with a new KEK without touching data blobs:

1. Unwrap DEK using `oldKey`.
2. Wrap DEK with `newKey`.
3. Replace the matched recipient entry.
4. Increment `keyVersion` at both manifest and recipient level.

The old ciphertext blobs are never read. Rotation is a manifest-only mutation.

**Caveat**: rotation does not invalidate old ciphertext. An attacker with
both the old wrapped DEK (from a prior manifest commit) and the old KEK can
still decrypt. To fully revoke access, the old manifest commits must become
unreachable (e.g., via history rewrite + `git gc`).

### Adding and Removing Recipients

- `addRecipient()`: unwraps the DEK with an existing KEK, wraps it with the
  new recipient's KEK, and returns a new Manifest with the appended entry.
- `removeRecipient()`: removes the label from the recipients array. Cannot
  remove the last recipient. Does not require a key (manifest-only mutation).

---

## Streaming Decompression

Plaintext+gzip, framed+gzip, and convergent+gzip restores use **streaming
decompression**. Compressed data is piped through the compression adapter's
`decompressStream()` method, which processes data incrementally without
buffering the full decompressed payload in memory. This applies to:

- Plain compressed restores (no encryption)
- Framed-encrypted + compressed restores
- Convergent-encrypted + compressed restores

The streaming approach keeps memory usage proportional to the chunk/frame size
rather than the total asset size. `whole` encrypted restores preserve the
whole-object authentication boundary and still use the bounded buffered path
for `restoreStream()` / `restore()`; `restoreFile()` uses a bounded temp-file
plan.

---

## CompressionPort Architecture

Compression in `git-cas` is fully abstracted behind the `CompressionPort`
interface. `CasService` has **zero platform-specific compression imports**.

### Port Interface

```
CompressionPort (abstract)
  compressBuffer(buffer)        -> Promise<Uint8Array>
  decompressBuffer(buffer)      -> Promise<Uint8Array>
  compressStream(source)        -> AsyncGenerator<Uint8Array>
  decompressStream(source)      -> AsyncGenerator<Uint8Array>
```

### NodeCompressionAdapter

The default adapter uses `node:zlib`:

- `compressBuffer` / `decompressBuffer`: promisified `gzip` / `gunzip`
- `compressStream`: `Readable.from(source).pipe(createGzip())`
- `decompressStream`: `Readable.from(source).pipe(createGunzip())` with
  error forwarding from the input stream to the gunzip transform

### Pluggability

Pass a custom adapter via the `compressionAdapter` constructor option:

```js
import { FixedChunker } from '@git-stunts/git-cas';
import CasService from '@git-stunts/git-cas/service';

const cas = new CasService({
  persistence, codec, crypto, observability,
  chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
  compressionAdapter: new MyBrotliAdapter(),
});
```

The only currently supported compression algorithm at the schema level is
`gzip`. The port abstraction exists to support future Bun-native, Deno-native,
or browser compression adapters without changing `CasService`.

---

## Direct CasService and Custom Port Contracts

Most applications should use the `ContentAddressableStore` facade. It supplies
Git persistence, runtime crypto, a JSON codec, a silent observer, fixed
chunking, gzip compression, and package-version manifest stamping by default.
Direct `CasService` construction is for tests, non-Git persistence experiments,
or applications that own every adapter boundary.

### Minimal Direct Service

Direct `CasService` construction requires all domain ports, including the
chunker and compression adapter. Those two are optional only on the facade.

```js
import {
  FixedChunker,
  JsonCodec,
  NodeCompressionAdapter,
  NodeCryptoAdapter,
  SilentObserver,
} from '@git-stunts/git-cas';
import CasService from '@git-stunts/git-cas/service';

const service = new CasService({
  persistence,
  codec: new JsonCodec(),
  crypto: new NodeCryptoAdapter(),
  observability: new SilentObserver(),
  chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
  compressionAdapter: new NodeCompressionAdapter(),
  formatVersion: '6.0.0',
});
```

### Required Port Shape

| Port | Required Surface | Notes |
| :--- | :--- | :--- |
| `GitPersistencePort` | `writeBlob`, `writeTree`, `readBlob`, `readBlobStream`, `readTree` | Return and consume `Uint8Array` streams; `readBlobStream()` is required for bounded restore paths. |
| `CodecPort` | `encode`, `decode`, `extension` | `encode()` must return `Uint8Array`; JSON and CBOR are built in. |
| `CryptoPort` | SHA-256, random bytes, AES-GCM buffer/stream methods, nonce/tag helpers, HMAC, KDF | `scrypt` support is runtime-dependent; Web Crypto adapters report capability errors where unsupported. |
| `ObservabilityPort` | `metric`, `log`, `span` | Use `SilentObserver`, `EventEmitterObserver`, or `StatsCollector` unless you need custom telemetry. |
| `ChunkingPort` | `chunk(source)`, `strategy`, `params` | Use `FixedChunker` or `CdcChunker`; direct service callers must inject one. |
| `CompressionPort` | `compressBuffer`, `decompressBuffer`, `compressStream`, `decompressStream` | Direct service callers must inject one even if stores do not request compression. |

The public byte contract is `Uint8Array`. Node `Buffer` values work at Node
boundaries because `Buffer` extends `Uint8Array`, but custom adapters should
not expose Buffer-only APIs in their portable contracts.

### Runtime and Facade Split

The facade owns infrastructure defaults:

- `GitPersistenceAdapter` and `GitRefAdapter` wrap `@git-stunts/plumbing`.
- `createCryptoAdapter()` chooses Node, Bun-compatible, or Web Crypto support.
- `resolveChunker()` maps declarative `{ strategy: 'fixed' | 'cdc' }` config
  into `FixedChunker` or `CdcChunker` instances.
- `NodeCompressionAdapter` is the default compression adapter.
- `formatVersion` is stamped from package metadata.

The domain service owns behavior after the ports are injected. It validates
constructor numeric ranges, rejects missing `chunker` and `compressionAdapter`,
and keeps runtime-specific imports out of the domain.

---

## Security Hardening Summary

The following security fixes have been applied across the release line. Each
row describes the fix and what it prevents.

| # | Fix | Prevents |
| :--- | :--- | :--- |
| 1 | Encrypted manifest metadata downgrade rejection | Attacker strips `encrypted: true` to bypass decryption |
| 2 | Algorithm allowlist (`aes-256-gcm` only) | Attacker substitutes a weaker or non-existent algorithm |
| 3 | Nonce/tag format validation (canonical base64, correct byte length) | Malformed metadata crashes the runtime or produces garbage |
| 4 | Framed record parse hardening (`ciphertextLength <= frameBytes`) | Oversized length field causes unbounded allocation |
| 5 | `maxRestoreBufferSize` enforcement (pre-decrypt and post-decompress) | Unbounded memory allocation on large encrypted/compressed restores |
| 6 | `maxEncryptionBufferSize` / `maxDecryptionBufferSize` for Web Crypto | One-shot Web Crypto API exhausts memory on large payloads |
| 7 | KDF policy enforcement (bounded iterations, cost, salt, keyLength) | Attacker-controlled manifest requests extreme KDF work or weak params |
| 8 | Manifest integrity hash (`manifestHash` field) | Silent manifest corruption or codec round-trip bugs |
| 9 | CDC + encryption dedup warning | False confidence in dedup savings when ciphertext is pseudorandom |
| 10 | Orphaned blob tracking on `STREAM_ERROR` / `STORE_ERROR` | Lost blob OIDs after partial store failures |
| 11 | AAD binding (always active on all schemes) | Cross-manifest blob substitution and frame reordering attacks |
| 12 | Legacy scheme rejection at runtime | Downgrade to weaker v1/v2 scheme variants |
| 13 | Convergent encryption post-decrypt digest verification | Chunk substitution or corruption after decryption |

---

## Operational Tooling

The release and migration scripts are part of the supported operator surface.
They are intentionally separate from the runtime library so production callers
do not inherit release-time dependencies.

### Migration

```sh
npm run upgrade
node scripts/migrate-encryption.js --execute --passphrase my-secret
node scripts/migrate-encryption.js --execute --key-file ./asset.key
```

The migration script is dry-run by default. It maps legacy v2 scheme names to
current names when safe, and re-encrypts legacy v1 content when AAD must be
added. Privacy-enabled vaults accept vault-specific passphrase/key options
when the vault credential differs from the content credential.

### Release Verification

```sh
npm test
npx eslint .
npm run release:verify -- --skip-jsr
```

`release:verify` checks package metadata, exports, docs, tests, pack contents,
Docker runtime suites, and release-state invariants. Use `--skip-jsr` when JSR
publication is intentionally deferred or unavailable.

### Build Metadata

```sh
npm run stamp
npm pack --dry-run
```

`npm run stamp` writes `build-info.json` from the current Git state. The file
is included in the npm package and is regenerated by `prepublishOnly`; it
should not be treated as source truth when the working tree has moved.

---

## Performance Baselines

The following baselines are published for the current release line.

| Strategy | Asset Size | Total Chunks | Store (ms) | Restore (ms) | Dedupe (%) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Fixed (256K)** | 100 MiB | 400 | ~450 | ~300 | 0% |
| **CDC (256K avg)** | 100 MiB | ~390 | ~1200 | ~350 | 98%+ |

**Notes:**

- CDC store time includes Buzhash rolling hash overhead. Restore time is
  comparable to fixed-size chunking because restore reads blobs by OID
  regardless of how boundaries were chosen.
- CDC **normalization** (dual-mask) tightens the chunk size distribution but
  does not materially affect throughput. The hash computation cost is the same;
  only the mask comparison changes. The dedup benefit comes from more
  predictable chunk sizes across versions.
- Encryption adds per-chunk (framed/convergent) or per-stream (whole)
  AES-GCM overhead. On hardware with AES-NI, the throughput impact is
  typically < 10%.
- Compression (gzip) can significantly reduce stored size but adds CPU cost
  proportional to the data volume. Streaming decompression avoids
  full-payload buffering for all restore paths.
- Parallel chunk restore (`concurrency > 1`) reduces wall-clock restore time
  when the persistence adapter has I/O latency. Throughput scales linearly
  up to the point where the adapter saturates.

---

## Configuration Reference

Direct `CasService` constructor options with types, defaults, and bounds. The
high-level `ContentAddressableStore` facade supplies defaults for `chunker`,
`compressionAdapter`, runtime crypto, and `formatVersion`.

| Option | Type | Default | Bounds | Description |
| :--- | :--- | :--- | :--- | :--- |
| `persistence` | `GitPersistencePort` | *required* | -- | Git blob/tree read/write adapter |
| `codec` | `CodecPort` | *required* | -- | Manifest serialization (JSON or CBOR) |
| `crypto` | `CryptoPort` | *required* | -- | Encryption, hashing, KDF adapter |
| `observability` | `ObservabilityPort` | *required* | Must implement `metric()`, `log()`, `span()` | Metrics, logging, tracing |
| `chunkSize` | `number` | `262144` (256 KiB) | Integer in `[1024, 104857600]` (1 KiB -- 100 MiB) | Chunk size for fixed chunking; warning above 10 MiB |
| `merkleThreshold` | `number` | `1000` | Integer >= 1 | Chunk count above which Merkle manifests are used |
| `concurrency` | `number` | `1` | Integer in `[1, 64]` | Max parallel chunk I/O operations (PrefetchWindow size) |
| `chunker` | `ChunkingPort` | *required* | -- | Chunking strategy instance (`FixedChunker` or `CdcChunker`) |
| `maxRestoreBufferSize` | `number` | `536870912` (512 MiB) | Integer >= 1024 | Max bytes for buffered restore (encrypted/compressed) |
| `compressionAdapter` | `CompressionPort` | *required* | -- | Compression implementation |
| `formatVersion` | `string` | -- | Semver (`/^\d+\.\d+\.\d+$/`) | Version stamp for new manifests (distinct from structural `version`) |

### store() Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `source` | `AsyncIterable<Uint8Array>` | *required* | Input byte stream |
| `slug` | `string` | *required* | Asset identifier |
| `filename` | `string` | *required* | Original filename |
| `encryptionKey` | `Uint8Array` | -- | 32-byte key (mutually exclusive with `passphrase` and `recipients`) |
| `passphrase` | `string` | -- | Derive key via KDF (mutually exclusive with `encryptionKey` and `recipients`) |
| `encryption` | `object` | -- | `{ scheme?, frameBytes?, convergent? }` |
| `encryption.scheme` | `string` | Auto: `convergent` for CDC, `framed` otherwise | `'whole'`, `'framed'`, or `'convergent'` |
| `encryption.frameBytes` | `number` | `65536` (64 KiB) | Frame size for the `framed` scheme; max 64 MiB |
| `encryption.convergent` | `boolean` | -- | Explicit convergent opt-in/opt-out (auto-selected for CDC chunkers) |
| `kdfOptions` | `object` | -- | `{ algorithm?, iterations?, cost?, blockSize?, parallelization? }` |
| `compression` | `object` | -- | `{ algorithm: 'gzip' }` |
| `recipients` | `Array<{label, key}>` | -- | Envelope recipients (mutually exclusive with key/passphrase) |

### CdcChunker Options

| Option | Type | Default | Bounds | Description |
| :--- | :--- | :--- | :--- | :--- |
| `targetChunkSize` | `number` | `262144` | Must be in `[min, max]` | Target average chunk size |
| `minChunkSize` | `number` | `65536` | Must not exceed `maxChunkSize` | Minimum chunk size |
| `maxChunkSize` | `number` | `1048576` | Hard cap at 100 MiB | Maximum chunk size |
| `normalized` | `boolean` | `true` | -- | Enable FastCDC dual-mask normalization |

---

For orientation, quick starts, and common usage patterns, see [GUIDE.md](./GUIDE.md).

For the security model and threat analysis, see [SECURITY.md](./SECURITY.md)
and [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md).
