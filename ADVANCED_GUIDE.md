# Advanced Guide -- git-cas

Deep-dive reference for advanced features, internals, and tuning. For
orientation and the productive-fast path, start with the [GUIDE.md](./GUIDE.md).

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

CDC deduplication is **ineffective** when encryption is enabled. Ciphertext is
pseudorandom, so there are no structural byte patterns for the rolling hash to
latch onto. `CasService` emits a warning when CDC is combined with encryption.
If you need both encryption and efficient storage of versioned assets, encrypt
at the application layer and use fixed-size chunking, or accept that each
encrypted version is stored independently.

---

## Encryption Schemes

`git-cas` supports four AES-256-GCM encryption schemes. All use 256-bit keys,
96-bit random nonces, and 128-bit authentication tags.

### whole-v1 (legacy)

Single AES-256-GCM envelope over the entire chunked ciphertext stream. The
nonce and authentication tag are stored in the manifest's `encryption` object.

- Store: plaintext source -> streaming encrypt -> chunk -> store blobs
- Restore: read blobs -> concatenate -> single-shot decrypt -> verify tag
- Manifest fields: `scheme: "whole-v1"`, `nonce`, `tag`

Limitations: the full ciphertext must fit in memory during restore (bounded by
`maxRestoreBufferSize`, default 512 MiB). No incremental authentication.

### whole-v2

Same as `whole-v1`, plus **AAD binding**: the UTF-8 bytes of the manifest slug
are passed as Additional Authenticated Data during encryption. Decryption
fails if the slug is altered after encryption, preventing cross-manifest blob
substitution attacks where an attacker swaps ciphertext between manifests
with different slugs.

- AAD: `Buffer.from(slug, 'utf8')`
- Manifest fields: `scheme: "whole-v2"`, `nonce`, `tag`

### framed-v1

Per-frame authenticated encryption with independently verifiable records.
Plaintext is split into fixed-size frames (default 64 KiB, max 64 MiB),
each encrypted separately. Restore can authenticate and emit plaintext
incrementally without buffering the full payload.

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

- Manifest fields: `scheme: "framed-v1"`, `frameBytes` (no top-level nonce/tag)

### framed-v2 (default for new encrypted stores)

Same binary layout as `framed-v1`, plus **per-frame AAD binding**:

```
AAD = slug (UTF-8) + NUL byte (0x00) + frame index (4 bytes, big-endian)
```

This prevents both slug tampering (same as `whole-v2`) and frame reordering
or deletion attacks. Each frame's authentication tag commits to its position
within the stream.

- Manifest fields: `scheme: "framed-v2"`, `frameBytes`

### Why AAD Matters

Without AAD, an attacker with write access to the repository can:

1. Copy encrypted blob OIDs from manifest A into manifest B (cross-manifest
   blob substitution). Decryption succeeds if both manifests share the same
   key, but the restored content is wrong.
2. For framed schemes, reorder or remove individual frame records within the
   ciphertext stream.

AAD binds the encryption to the manifest identity and (for framed-v2) the
frame sequence, so any such tampering causes GCM authentication failure.

### Scheme Selection

| Scenario | Recommended Scheme |
| :--- | :--- |
| New encrypted stores | `framed-v2` (default) |
| Large assets needing streaming restore | `framed-v1` or `framed-v2` |
| Legacy compatibility | `whole-v1` (explicit opt-in) |
| Slug-bound whole-object auth | `whole-v2` |

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

## CompressionPort Architecture

Compression in `git-cas` is fully abstracted behind the `CompressionPort`
interface. `CasService` has **zero platform-specific compression imports**.

### Port Interface

```
CompressionPort (abstract)
  compressBuffer(buffer)        -> Promise<Buffer>
  decompressBuffer(buffer)      -> Promise<Buffer>
  compressStream(source)        -> AsyncGenerator<Buffer>
  decompressStream(source)      -> AsyncGenerator<Buffer>
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
const cas = new CasService({
  persistence, codec, crypto, observability,
  compressionAdapter: new MyBrotliAdapter(),
});
```

The only currently supported compression algorithm at the schema level is
`gzip`. The port abstraction exists to support future Bun-native, Deno-native,
or browser compression adapters without changing `CasService`.

---

## Security Hardening Summary

The following security fixes have been applied across the `v5.x` release line.
Each row describes the fix, what it prevents, and the version that introduced
it.

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
| 11 | AAD binding (`whole-v2`, `framed-v2`) | Cross-manifest blob substitution and frame reordering attacks |

---

## Performance Baselines

The following baselines are published for the current release line (`v5.3.x`).

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
- Encryption adds per-chunk (framed) or per-stream (whole) AES-GCM overhead.
  On hardware with AES-NI, the throughput impact is typically < 10%.
- Compression (gzip) can significantly reduce stored size but adds CPU cost
  proportional to the data volume. Streaming compression/decompression avoids
  full-payload buffering for framed-encrypted or unencrypted paths.

---

## Configuration Reference

All `CasService` constructor options with types, defaults, and bounds.

| Option | Type | Default | Bounds | Description |
| :--- | :--- | :--- | :--- | :--- |
| `persistence` | `GitPersistencePort` | *required* | -- | Git blob/tree read/write adapter |
| `codec` | `CodecPort` | *required* | -- | Manifest serialization (JSON or CBOR) |
| `crypto` | `CryptoPort` | *required* | -- | Encryption, hashing, KDF adapter |
| `observability` | `ObservabilityPort` | *required* | Must implement `metric()`, `log()`, `span()` | Metrics, logging, tracing |
| `chunkSize` | `number` | `262144` (256 KiB) | Integer in `[1024, 104857600]` (1 KiB -- 100 MiB) | Chunk size for fixed chunking; warning above 10 MiB |
| `merkleThreshold` | `number` | `1000` | Integer >= 1 | Chunk count above which Merkle manifests are used |
| `concurrency` | `number` | `1` | Integer in `[1, 64]` | Max parallel chunk I/O operations |
| `chunker` | `ChunkingPort` | `FixedChunker` | -- | Chunking strategy instance (`FixedChunker` or `CdcChunker`) |
| `maxRestoreBufferSize` | `number` | `536870912` (512 MiB) | Integer >= 1024 | Max bytes for buffered restore (encrypted/compressed) |
| `compressionAdapter` | `CompressionPort` | `NodeCompressionAdapter` | -- | Compression implementation |

### store() Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `source` | `AsyncIterable<Buffer>` | *required* | Input byte stream |
| `slug` | `string` | *required* | Asset identifier |
| `filename` | `string` | *required* | Original filename |
| `encryptionKey` | `Buffer` | -- | 32-byte key (mutually exclusive with `passphrase` and `recipients`) |
| `passphrase` | `string` | -- | Derive key via KDF (mutually exclusive with `encryptionKey` and `recipients`) |
| `encryption` | `object` | -- | `{ scheme?, frameBytes? }` |
| `encryption.scheme` | `string` | `'framed-v2'` | `'whole-v1'`, `'whole-v2'`, `'framed-v1'`, or `'framed-v2'` |
| `encryption.frameBytes` | `number` | `65536` (64 KiB) | Frame size for framed schemes; max 64 MiB |
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
