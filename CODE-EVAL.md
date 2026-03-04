# Forensic Architectural Audit: `@git-stunts/git-cas`

**Audit Date:** 2026-03-03
**Repository State:** `0f7f8e658e6cd094176541ac68d33b2a6ec75a91` (HEAD, `main`)
**Auditor:** Claude Opus 4.6, operating under zero-knowledge forensic protocol
**Version Under Audit:** 5.2.4

---

## Activity Log — Discovery Narrative

The exploration began at the repository root with a simultaneous five-pronged dive: core domain services, infrastructure adapters, ports/codecs/chunkers, test structure, and type definitions. The first thing that jumped out — before reading a single line of code — was the file tree. Thirty-one source files, twelve bin files, sixty-one test files. A 3.1:1 test-to-source ratio. That alone telegraphs intent: someone cares about correctness here.

The ports directory was my Rosetta Stone. Six abstract base classes — `CryptoPort`, `CodecPort`, `GitPersistencePort`, `GitRefPort`, `ObservabilityPort`, `ChunkingPort` — each throwing `'Not implemented'`. Textbook hexagonal architecture. I already knew this was a ports-and-adapters system before reading a single service file.

`CasService.js` at 911 lines is the gravitational center. It imports no infrastructure directly — only ports. Good. `KeyResolver.js` (220 lines) handles all cryptographic key orchestration, recently extracted from CasService (the M15 Prism task card confirmed this). `VaultService.js` (467 lines) operates on a separate Git ref (`refs/cas/vault`) with compare-and-swap concurrency control.

The three crypto adapters (`NodeCryptoAdapter`, `WebCryptoAdapter`, `BunCryptoAdapter`) are where I started changing my initial opinions. I expected copy-paste sloppiness — instead I found runtime-specific optimizations (Bun's native `CryptoHasher`, Web Crypto's `subtle` API) all converging on identical cryptographic parameters: AES-256-GCM, 12-byte nonce, 16-byte tag, SHA-256 content hashing. But the behavioral discrepancies between adapters (see Phase 2) tell a more nuanced story.

The CDC chunker (`CdcChunker.js`) surprised me. A hand-rolled buzhash rolling hash with a 64-byte sliding window, xorshift64-seeded lookup table, and three-phase processing pipeline (fill window, feed pre-minimum, scan boundary). This is not commodity code — it's a bespoke content-defined chunking engine.

The test suite confirmed the architecture: 833+ unit tests, crypto is never mocked (always real adapters), persistence is always mocked (in-memory maps), integration tests gate on Docker (`GIT_STUNTS_DOCKER=1`). The fuzz testing coverage is noteworthy — 50-iteration fuzz rounds for crypto, chunking, and store/restore.

The CLI (`bin/git-cas.js`, 657 lines) implements a full TEA (The Elm Architecture) interactive dashboard. That's architecturally ambitious for a storage utility.

My opinion shifted most dramatically on the vault system. I initially expected a simple key-value store backed by a file. Instead, it's a full commit chain on `refs/cas/vault` with optimistic concurrency control, exponential backoff retries, percent-encoded slug names, and atomic compare-and-swap ref updates. This is distributed-systems thinking applied to a local Git repo.

---

## Phase 1: Zero-Knowledge Code Extraction

### Deduced Value Proposition

This system is a **content-addressed storage engine that uses Git's object database as its persistence layer**, with optional AES-256-GCM encryption, gzip compression, content-defined chunking, and a vault-based indexing system backed by Git refs.

The core problem it solves: **storing, encrypting, versioning, and retrieving binary blobs entirely within Git's native object model** — no external servers, no sidecar databases, no LFS endpoints. Everything lives in `.git/objects` and is transportable via standard Git push/pull/clone.

### Comprehensive Feature Set (Implemented)

1. **Store**: Chunk a byte stream (fixed-size or CDC), optionally compress (gzip), optionally encrypt (AES-256-GCM), write chunks as Git blobs, produce a manifest.
2. **Restore**: Read chunks from Git blobs, verify SHA-256 integrity, decrypt, decompress, reassemble.
3. **Streaming Restore**: `restoreStream()` yields chunks as an async iterable — O(chunk_size) memory for unencrypted data.
4. **Content-Defined Chunking (CDC)**: Buzhash rolling hash with configurable min/max/target sizes. Deduplication-friendly.
5. **Fixed-Size Chunking**: Default 256 KiB, configurable.
6. **Merkle Tree Manifests**: Automatic manifest splitting when chunk count exceeds threshold (default 1000). Sub-manifest references with startIndex/chunkCount.
7. **Envelope Encryption**: DEK/KEK model. Random 32-byte DEK encrypts data; each recipient's KEK wraps the DEK independently.
8. **Multi-Recipient Management**: Add/remove recipients without re-encrypting data.
9. **Key Rotation**: Re-wrap DEK with new KEK. No data re-encryption — O(1) key rotation.
10. **Passphrase-Based Encryption**: PBKDF2 or scrypt KDF with configurable parameters.
11. **Vault System**: Git-ref-backed (`refs/cas/vault`) content registry with CAS (compare-and-swap) concurrency control.
12. **Vault Passphrase Rotation**: Re-wrap all envelope-encrypted vault entries with a new passphrase-derived KEK.
13. **Integrity Verification**: Per-chunk SHA-256 + GCM auth tag for encrypted data.
14. **Orphan Detection**: `findOrphanedChunks()` — reference-counting analysis across vault entries.
15. **Codec Pluggability**: JSON (human-readable) or CBOR (compact binary) manifests.
16. **Multi-Runtime Support**: Node.js 22, Bun, Deno — with runtime-specific crypto adapters.
17. **Observability**: Structured metrics (`chunk:stored`, `file:stored`, `integrity:pass/fail`), log levels, span tracing.
18. **CLI**: 18 commands including store, restore, verify, inspect, rotate, vault management, and an interactive TEA dashboard.
19. **Parallel I/O**: Semaphore-bounded concurrent blob writes (store) and read-ahead window (restore).
20. **File I/O Helpers**: `storeFile()` / `restoreFile()` for file-to-file convenience.

### API Surface & Boundary

**Public entrypoints** (as defined by package.json/jsr.json exports):

| Entrypoint | Module | Primary Export |
|---|---|---|
| `.` (root) | `index.js` | `ContentAddressableStore` facade class |
| `./service` | `src/domain/services/CasService.js` | `CasService` (direct domain access) |
| `./schema` | `src/domain/schemas/ManifestSchema.js` | Zod schemas (ManifestSchema, ChunkSchema, etc.) |

**Facade API** (`ContentAddressableStore`):

| Method | Return |
|---|---|
| `store(options)` | `Promise<Manifest>` |
| `restore(options)` | `Promise<{ buffer, bytesWritten }>` |
| `restoreStream(options)` | `AsyncIterable<Buffer>` |
| `createTree(options)` | `Promise<string>` (tree OID) |
| `readManifest(options)` | `Promise<Manifest>` |
| `verifyIntegrity(options)` | `Promise<boolean>` |
| `deleteAsset(options)` | `Promise<{ slug, chunksOrphaned }>` |
| `findOrphanedChunks(options)` | `Promise<{ referenced, total }>` |
| `rotateKey(options)` | `Promise<Manifest>` |
| `addRecipient(options)` | `Promise<Manifest>` |
| `removeRecipient(options)` | `Promise<Manifest>` |
| `listRecipients(manifest)` | `string[]` |
| `deriveKey(options)` | `Promise<{ key, salt, params }>` |
| `getVaultService()` | `VaultService` |
| `rotateVaultPassphrase(options)` | `Promise<{ commitOid, rotatedSlugs, skippedSlugs }>` |

**External system interface:**
- **Ingress**: File paths, byte streams (`AsyncIterable<Buffer>`), encryption keys (32-byte `Buffer`), passphrases (strings), vault slugs (strings).
- **Egress**: Git blob/tree OIDs (40-char hex strings), `Manifest` value objects, byte buffers, vault entries.
- **Infrastructure boundary**: All Git operations flow through `@git-stunts/plumbing` → `git` CLI subprocess.

### Internal Architecture & Components

```
┌─────────────────────────────────────────────────────────┐
│  ContentAddressableStore (index.js) — Facade            │
│  Wires ports, exposes unified API                       │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────┼──────────────┐
         │             │              │
┌────────▼──────┐ ┌────▼─────┐ ┌─────▼──────────────────┐
│  CasService   │ │  Vault   │ │ rotateVaultPassphrase  │
│  (911 lines)  │ │ Service  │ │ (standalone function)  │
│               │ │(467 lines│ └────────────────────────┘
│ ┌───────────┐ │ └──────────┘
│ │KeyResolver│ │
│ │(220 lines)│ │
│ └───────────┘ │
└───────┬───────┘
        │ depends on (ports only)
  ┌─────┼──────┬──────────┬────────────┐
  │     │      │          │            │
┌─▼─┐ ┌▼──┐ ┌─▼──┐ ┌────▼────┐ ┌─────▼─────┐
│Git│ │Git│ │Cry-│ │Observ-  │ │Chunking   │
│Per│ │Ref│ │pto │ │ability  │ │Port       │
│sis│ │Port│ │Port│ │Port     │ │           │
│ten│ │   │ │    │ │         │ │           │
│ce │ │   │ │    │ │         │ │           │
└─┬─┘ └─┬─┘ └──┬─┘ └────┬───┘ └─────┬─────┘
  │      │      │         │           │
  ▼      ▼      ▼         ▼           ▼
┌───────────────────────────────────────────────┐
│           Infrastructure Adapters             │
│                                               │
│  GitPersistenceAdapter  NodeCryptoAdapter      │
│  GitRefAdapter          WebCryptoAdapter       │
│  FileIOHelper           BunCryptoAdapter       │
│                         EventEmitterObserver   │
│  JsonCodec / CborCodec  SilentObserver         │
│  FixedChunker           StatsCollector         │
│  CdcChunker                                   │
└───────────────────────────────────────────────┘
```

The dependency direction is strictly inward: domain depends on ports (interfaces), infrastructure depends on ports (implements). The facade wires them together. No domain module imports any infrastructure module.

### Mechanics & Internals

#### Algorithms

**Content-Defined Chunking (Buzhash):**
- Rolling hash over a 64-byte sliding window.
- Lookup table: 256-entry `Uint32Array` generated via xorshift64 PRNG seeded with `0x6a09e667f3bcc908` (SHA-256's first fractional prime constant — a nice touch).
- Hash update: `hash = (rotl32(hash, 1) ^ table[outgoing] ^ table[incoming]) >>> 0`.
- Boundary detection: `(hash & mask) === 0` where `mask = (1 << floor(log2(targetChunkSize))) - 1`.
- Three-phase pipeline: fill window (first 64 bytes), feed pre-minimum (accumulate until min chunk size), scan boundary (check on each byte until boundary or max).
- **Complexity**: O(n) where n = input bytes. Each byte requires one table lookup, one XOR, one rotate. The mask test is O(1).

**Encryption:**
- AES-256-GCM with 12-byte random nonce and 16-byte authentication tag.
- Streaming encryption wraps the chunk pipeline (encrypt-then-chunk: the ciphertext is chunked, not the plaintext).
- DEK wrapping uses the same AES-256-GCM as data encryption — the DEK is treated as a 32-byte plaintext.

**Key Derivation:**
- PBKDF2-HMAC-SHA-512 (default 100,000 iterations) or scrypt (default N=16384, r=8, p=1).
- Salt: 32 bytes random, stored in manifest.

**Integrity:**
- SHA-256 digest per chunk (computed at store time, verified at restore time).
- GCM authentication tag for encrypted data (verified during decryption).
- Manifests validated by Zod schemas at construction time.

#### Storage & Data Structures

**Git Object Database:**
- Chunks stored as Git blobs via `git hash-object -w --stdin`.
- Manifests stored as Git blobs (JSON or CBOR encoded).
- Trees constructed via `git mktree` with mode `100644 blob` entries.
- Vault state stored as a commit chain on `refs/cas/vault`:
  - Each commit points to a tree containing: `.vault.json` metadata blob + one `040000 tree` entry per vault slug.

**In-Memory:**
- `Manifest` and `Chunk` are frozen value objects (immutable after construction).
- `Semaphore` uses a FIFO queue of promise resolvers.
- `StatsCollector` accumulates metrics in private fields.
- CDC chunker allocates a `Buffer.allocUnsafe(maxChunkSize)` working buffer per `chunk()` invocation.

#### Memory Management

**Store path:**
- Semaphore-bounded: at most `concurrency` chunk buffers in flight simultaneously.
- CDC chunker holds one `maxChunkSize` working buffer (~1 MiB default) plus the 64-byte sliding window.
- After chunking, the working buffer is copied via `Buffer.from(subarray)` — no aliasing.

**Restore path (streaming, unencrypted):**
- Read-ahead window: up to `concurrency` chunk-sized buffers in memory.
- Chunks are yielded and become eligible for GC immediately after consumption.

**Restore path (buffered, encrypted/compressed):**
- **All chunks are concatenated into a single buffer before decryption.** This is the documented memory amplification concern (Roadmap C1). A 1 GB encrypted file requires ~1 GB in memory for decryption, plus the decrypted result.

**Web Crypto streaming encryption:**
- The `createEncryptionStream` on `WebCryptoAdapter` **buffers the entire stream** internally because Web Crypto's AES-GCM is a one-shot API. This silently converts O(chunk_size) memory to O(total_file_size) memory on Deno (Roadmap C4).

#### Performance Characteristics

| Operation | Time Complexity | Space Complexity | Blocking? |
|---|---|---|---|
| Store (fixed chunking) | O(n) | O(concurrency × chunkSize) | Git subprocess I/O |
| Store (CDC chunking) | O(n) | O(maxChunkSize + concurrency × chunkSize) | Git subprocess I/O |
| Restore (streaming, plain) | O(n) | O(concurrency × chunkSize) | Git subprocess I/O |
| Restore (buffered, encrypted) | O(n) | **O(n)** — full file in memory | Git subprocess I/O + decrypt |
| createTree (v1, < threshold) | O(k) where k = chunks | O(k) for tree entries | Git subprocess |
| createTree (v2, Merkle) | O(k) | O(k / threshold) sub-manifests | Git subprocess |
| readManifest (v2) | O(k) | O(sub-manifest count) reads | Git subprocess × sub-manifests |
| Key rotation | O(1) | O(1) — only re-wraps DEK | Constant |
| Vault CAS update | O(entries) | O(entries) for tree rebuild | Git subprocess |
| CDC boundary scan | O(n) per byte | O(1) per byte (table lookup + XOR) | CPU-bound |

**Critical bottleneck:** Git subprocess spawning. Every `writeBlob`, `readBlob`, `writeTree`, `readTree` operation spawns a `git` child process. For a file with 1000 chunks at concurrency 4, that's ~1000 `git hash-object` invocations + ~1000 `git cat-file` invocations on restore. The `@git-stunts/plumbing` layer mitigates this somewhat but cannot eliminate the per-operation process overhead.

---

## Phase 2: The Critical Assessment

### Use Cases & Fitness

**Optimized for:**
- Single-file binary asset storage (firmware images, data bundles, encrypted archives) in the 1 KB to ~500 MB range.
- Git monorepos where binary assets must travel with the code.
- Air-gapped or offline environments where external services are unavailable.
- Multi-recipient access control without re-encrypting data.

**Where it will break:**
- **Files > 1 GB encrypted**: The `_restoreBuffered` path requires the entire file in memory for decryption. A 4 GB file on a machine with 8 GB RAM will OOM.
- **High-frequency writes**: Each chunk write spawns a Git subprocess. At 1000 writes/second with process spawn overhead (~5ms each), you hit a ceiling of ~200 chunks/second single-threaded.
- **Large repositories (>10 GB)**: Git's own performance degrades with ODB size. `git gc` becomes slow, pack files grow.
- **Web Crypto runtime (Deno) with large files**: The streaming encryption adapter silently buffers the entire file due to Web Crypto API limitations.
- **Concurrent vault mutations from multiple processes**: The CAS retry mechanism (3 attempts, 50-200ms backoff) handles light contention but will fail under sustained concurrent writes.

### Design Trade-offs

**1. Git subprocess for every blob operation vs. libgit2/in-process Git**

- **Evidence:**

  - **Claim:** Every blob read/write spawns a `git` child process via `@git-stunts/plumbing`.
  - **Primary Evidence:** `src/infrastructure/adapters/GitPersistenceAdapter.js:11-17` (`writeBlob` calls `plumbing.execute`)
  - **Supporting Context:** `plumbing.execute()` and `plumbing.executeStream()` spawn `git` subprocesses.
  - **Discovery Path:** `index.js` → `GitPersistenceAdapter` → `plumbing.execute` → `git hash-object`
  - **Cryptographic Proof:** `git hash-object src/infrastructure/adapters/GitPersistenceAdapter.js` = `797be53113174ff8e86104fa97afda0748dd3fce`

- **Systemic effect:** Process spawn overhead (~2-10ms per invocation) dominates I/O for small chunks. A 100 MB file with 256 KiB chunks = ~400 subprocess invocations for store + ~400 for restore. The `Policy.timeout(30_000)` wrapper adds resilience but not performance.
- **Trade-off rationale:** Using the `git` CLI ensures correctness across all Git configurations (bare repos, worktrees, custom object stores, alternates) without reimplementing Git's object database. It also means zero native dependencies — critical for multi-runtime support.

**2. Encrypt-then-chunk vs. chunk-then-encrypt**

- **Evidence:**

  - **Claim:** Encryption wraps the source stream before chunking, meaning ciphertext is what gets chunked — not plaintext.
  - **Primary Evidence:** `src/domain/services/CasService.js:store()` — encryption stream wraps source before passing to `_chunkAndStore`.
  - **Supporting Context:** The encryption stream is created first (`crypto.createEncryptionStream(key)`), then the encrypted output is piped through the chunker.
  - **Cryptographic Proof:** `git hash-object src/domain/services/CasService.js` = `9d1370ca88697992847c131bba7d74f726a2cd8c`

- **Systemic effect:** CDC deduplication is **completely defeated** for encrypted data because AES-GCM ciphertext is pseudorandom — identical plaintext produces different ciphertext (random nonce). This means encrypted CDC-chunked files get zero deduplication benefit. The chunking metadata is still recorded in the manifest, but it serves no dedup purpose.
- **Trade-off rationale:** The alternative (chunk-then-encrypt) would require per-chunk nonces and auth tags, significantly complicating the manifest schema and increasing metadata overhead. The current design keeps crypto simple (one nonce, one tag, one DEK for the whole file).

**3. Full-buffer decrypt vs. streaming decrypt**

- **Evidence:**

  - **Claim:** Encrypted/compressed restores buffer the entire file before decryption.
  - **Primary Evidence:** `src/domain/services/CasService.js:_restoreBuffered()` — concatenates all chunk buffers then calls `decrypt()`.
  - **Cryptographic Proof:** `git hash-object src/domain/services/CasService.js` = `9d1370ca88697992847c131bba7d74f726a2cd8c`

- **Systemic effect:** Memory usage is O(file_size) for encrypted restores. The `restoreStream()` API exists and is O(chunk_size) for plaintext, but encrypted paths silently degrade to O(n).
- **Trade-off rationale:** AES-256-GCM produces a single authentication tag for the entire ciphertext. Verifying the tag requires processing all ciphertext. Streaming authenticated decryption would require a different AEAD construction (e.g., STREAM from libsodium, or chunked AES-GCM with per-chunk tags).

**4. Vault as Git commit chain vs. flat file**

- **Evidence:**

  - **Claim:** The vault uses Git commits on `refs/cas/vault` with CAS (compare-and-swap) updates.
  - **Primary Evidence:** `src/domain/services/VaultService.js:VAULT_REF`, `#casUpdateRef`, `#retryMutation`
  - **Cryptographic Proof:** `git hash-object src/domain/services/VaultService.js` = `d5a1ac2b1a771e9a3a7ac1652c6f40e0f0cbffaa`

- **Systemic effect:** Every vault mutation (add, remove, init) creates a new Git commit. This provides full audit history but grows the commit graph linearly. Over thousands of vault mutations, `git log refs/cas/vault` becomes slow. The CAS semantics handle concurrent writes gracefully but are limited to 3 retries with short backoff — insufficient for high-contention scenarios.
- **Trade-off rationale:** Using Git's native commit/ref mechanism means the vault is automatically included in `git push/pull/clone`. No separate sync mechanism needed. The audit trail is a natural consequence.

**5. Semaphore-based concurrency vs. worker pool**

- **Evidence:**

  - **Claim:** Parallel blob I/O uses a counting semaphore, not a proper worker/thread pool.
  - **Primary Evidence:** `src/domain/services/Semaphore.js` — FIFO counting semaphore; `CasService.js:_chunkAndStore` — semaphore-guarded fan-out.
  - **Cryptographic Proof:** `git hash-object src/domain/services/Semaphore.js` = `507ed14668364491797a68ed906b346b01ddd488`

- **Systemic effect:** All concurrency is async I/O multiplexing on the event loop. There's no CPU parallelism for hashing or encryption. SHA-256 and AES-GCM run on the main thread (in Node.js). For CPU-bound workloads this is a bottleneck, but since the dominant cost is Git subprocess I/O, async concurrency is the correct choice.

### Flaws & Limitations

#### Flaw 1: Crypto Adapter Behavioral Inconsistencies

- **Evidence:**

  - **Claim:** The three crypto adapters have inconsistent validation and error-handling behavior.
  - **Primary Evidence:** `NodeCryptoAdapter.js:26-36`, `BunCryptoAdapter.js:25-44`, `WebCryptoAdapter.js:28-44`
  - **Supporting Context:**
    - `NodeCryptoAdapter.encryptBuffer` is synchronous; `BunCryptoAdapter.encryptBuffer` and `WebCryptoAdapter.encryptBuffer` are async.
    - `BunCryptoAdapter.decryptBuffer` calls `_validateKey(key)`; `NodeCryptoAdapter.decryptBuffer` and `WebCryptoAdapter.decryptBuffer` do not.
    - `NodeCryptoAdapter.createEncryptionStream` has no premature-finalize guard; Bun and Web adapters throw `CasError('STREAM_NOT_CONSUMED')`.
  - **Cryptographic Proof:**
    - `git hash-object src/infrastructure/adapters/NodeCryptoAdapter.js` = `f89898c5ec1892dd965e6ed69ac5373883ed1650`
    - `git hash-object src/infrastructure/adapters/BunCryptoAdapter.js` = `1d8b8ce4def9cd8be885e5065041dbe0a0b6d0ac`
    - `git hash-object src/infrastructure/adapters/WebCryptoAdapter.js` = `5a70733d945387a8a8101013157811aa654958c6`

- **Impact:** Liskov Substitution violation. Code that works correctly on Bun (where `decryptBuffer` validates the key type early) may fail with a cryptic `node:crypto` error on Node.js (where the key is passed directly to `createDecipheriv`). The missing premature-finalize guard on Node means a bug in stream consumption produces undefined behavior on Node but a clear error on Bun/Deno.
- **Severity:** Medium. The callers generally `await` all results (which papers over sync-vs-async), and CasService always calls `_validateKey` before encrypting. But the asymmetry is a maintenance hazard.

#### Flaw 2: Memory Amplification on Encrypted Restore

- **Evidence:**

  - **Claim:** Encrypted restores load the entire file into memory.
  - **Primary Evidence:** `src/domain/services/CasService.js:_restoreBuffered()` — `Buffer.concat(chunkBuffers)` before `this.decrypt()`.
  - **Cryptographic Proof:** `git hash-object src/domain/services/CasService.js` = `9d1370ca88697992847c131bba7d74f726a2cd8c`

- **Impact:** Restoring a 1 GB encrypted file requires ~2 GB of heap (ciphertext buffer + plaintext output). No guard, no warning, no configurable limit.
- **Severity:** High for large files. The roadmap acknowledges this as concern C1 and estimates ~20 LoC to add a `maxRestoreBufferSize` guard.

#### Flaw 3: Web Crypto Stream Buffering

- **Evidence:**

  - **Claim:** `WebCryptoAdapter.createEncryptionStream` silently buffers the entire stream.
  - **Primary Evidence:** `src/infrastructure/adapters/WebCryptoAdapter.js:64-84` — `const chunks = []; for await (const chunk of source) { chunks.push(chunk); } const buffer = Buffer.concat(chunks);`
  - **Cryptographic Proof:** `git hash-object src/infrastructure/adapters/WebCryptoAdapter.js` = `5a70733d945387a8a8101013157811aa654958c6`

- **Impact:** On Deno, `createEncryptionStream` provides a streaming API but has O(n) memory behavior. Users expect O(chunk_size) memory from a streaming API. This is deceptive.
- **Severity:** Medium. Deno is a secondary runtime, and the roadmap flags this as concern C4.

#### Flaw 4: FixedChunker Quadratic Buffer Allocation

- **Evidence:**

  - **Claim:** `FixedChunker.chunk()` uses `Buffer.concat()` in a loop, creating a new buffer allocation per input chunk.
  - **Primary Evidence:** `src/infrastructure/chunkers/FixedChunker.js:20` — `buffer = Buffer.concat([buffer, data]);`
  - **Cryptographic Proof:** `git hash-object src/infrastructure/chunkers/FixedChunker.js` = `1477e185f16730ad13028454cecb1fb2ac785889`

- **Impact:** For a source that yields many small buffers (e.g., 4 KB network reads), `Buffer.concat([buffer, data])` is called for each read. This copies the accumulated buffer each time, yielding O(n^2/chunkSize) total memory copies where n is file size. In contrast, `CdcChunker` uses a pre-allocated working buffer with zero intermediate copies.
- **Severity:** Low in practice (the source is typically a file stream with 64 KiB reads), but architecturally inconsistent with the CDC chunker's careful buffer management.

#### Flaw 5: CDC Deduplication Defeated by Encrypt-Then-Chunk

- **Evidence:**

  - **Claim:** Encryption is applied before chunking, destroying content-addressable deduplication.
  - **Primary Evidence:** `src/domain/services/CasService.js:store()` — encryption wraps source before `_chunkAndStore`.
  - **Cryptographic Proof:** `git hash-object src/domain/services/CasService.js` = `9d1370ca88697992847c131bba7d74f726a2cd8c`

- **Impact:** The primary value proposition of CDC is sub-file deduplication. For encrypted files, CDC provides zero dedup benefit over fixed chunking. Users who enable both encryption and CDC chunking get CDC's overhead (rolling hash computation) without its benefit.
- **Severity:** Medium. This is an inherent limitation of the encrypt-then-chunk design. Fixing it would require per-chunk encryption (chunk-then-encrypt), which is a significant architectural change.

#### Flaw 6: No Upper Bound on Chunk Size

- **Evidence:**

  - **Claim:** `FixedChunker` accepts any positive `chunkSize` value without an upper bound.
  - **Primary Evidence:** `src/infrastructure/chunkers/FixedChunker.js:9` — no validation beyond ChunkingPort base.
  - **Supporting Context:** `CdcChunker` has configurable `maxChunkSize` (default 1 MiB) but no hard upper limit either. `resolveChunker` validates `chunkSize > 0` for fixed but has no ceiling.
  - **Cryptographic Proof:** `git hash-object src/infrastructure/chunkers/FixedChunker.js` = `1477e185f16730ad13028454cecb1fb2ac785889`

- **Impact:** A user could set `chunkSize: 10 * 1024 * 1024 * 1024` (10 GB) and the system would attempt to buffer a 10 GB chunk. The roadmap flags this as concern C3.
- **Severity:** Low (user misconfiguration, not a bug in normal usage).

#### Flaw 7: `deleteAsset` Is Misleadingly Named

- **Evidence:**

  - **Claim:** `deleteAsset()` does not delete anything — it only reads metadata.
  - **Primary Evidence:** `src/domain/services/CasService.js:deleteAsset()` — reads manifest and returns `{ slug, chunksOrphaned }`.
  - **Cryptographic Proof:** `git hash-object src/domain/services/CasService.js` = `9d1370ca88697992847c131bba7d74f726a2cd8c`

- **Impact:** API confusion. Similarly, `findOrphanedChunks()` doesn't find orphans — it finds referenced chunks. Both methods are analysis tools masquerading as lifecycle operations.
- **Severity:** Low (naming issue, not a functional defect).

#### Flaw 8: Error.captureStackTrace Portability

- **Evidence:**

  - **Claim:** `CasError` uses `Error.captureStackTrace` which is V8-specific.
  - **Primary Evidence:** `src/domain/errors/CasError.js:5` — `Error.captureStackTrace(this, this.constructor);`
  - **Cryptographic Proof:** `git hash-object src/domain/errors/CasError.js` = `6acc1da7e28ed698571f861900081d8b044cde57`

- **Impact:** This is a no-op on non-V8 engines. Since the project targets Node (V8), Bun (JSC), and Deno (V8), it's a no-op on Bun's JavaScriptCore. Not a crash risk (it degrades gracefully), but indicates incomplete multi-runtime awareness.
- **Severity:** Negligible.

#### Flaw 9: Missing pre-commit Hook

- **Evidence:**

  - **Claim:** The project has a pre-push hook but no pre-commit hook.
  - **Primary Evidence:** `scripts/git-hooks/pre-push` exists; `scripts/git-hooks/pre-commit` does not.
  - **Supporting Context:** The CLAUDE.md global instructions specify that pre-commit should run lint. The hooks directory is also named `git-hooks` rather than the conventional `hooks` specified in CLAUDE.md.

- **Impact:** Lint failures are not caught until push time. A developer can accumulate many unlinted commits before discovering issues.
- **Severity:** Low (process issue, not a code defect).

### Innovation vs. Commodity

**Novel or distinctive:**
1. **Git ODB as a CAS backend** — No other library treats Git's native object store as a general-purpose content-addressed storage layer with this level of sophistication (Merkle manifests, codec pluggability, vault indexing).
2. **Buzhash CDC implementation** — Hand-rolled, well-optimized, with a clever xorshift64 seeded table. Not copy-pasted from a library.
3. **DEK/KEK envelope encryption with zero-cost key rotation** — The key rotation model (re-wrap DEK, don't re-encrypt data) is architecturally elegant and matches the patterns used by KMS systems like AWS KMS.
4. **Vault as a Git commit chain** — Using Git refs for an atomic, auditable key-value store is creative.
5. **Multi-runtime JS with runtime-specific crypto** — Three crypto adapters targeting three JS runtimes is uncommon in the Node ecosystem.

**Commodity:**
1. **AES-256-GCM encryption** — Standard AEAD construction, correctly implemented.
2. **PBKDF2/scrypt KDF** — Standard KDF choices with standard parameters.
3. **Zod schema validation** — Standard validation library, standard usage.
4. **Hexagonal architecture** — Well-known pattern, well-executed.
5. **Commander.js CLI** — Standard CLI framework, standard usage.

**Assessment:** This codebase introduces genuinely novel abstractions (Git ODB as CAS, vault commit chain, zero-cost key rotation) while building on commodity cryptographic primitives. The combination is the innovation — not any individual component.

---

## Phase 3: The Reality Check

### Roadmap Reconciliation

The roadmap lists 9 milestones (M7–M15). **All 9 are marked CLOSED.** There are zero open milestones.

| Milestone | Roadmap Status | Verified in Code | Reconciliation |
|---|---|---|---|
| M7 Horizon | CLOSED (v2.0.0) | Yes — Merkle manifests (v2), compression, sub-manifests all implemented | Accurate |
| M8 Spit Shine | CLOSED (v4.0.1) | Yes — CryptoPort refactor, verify command, error handler all present | Accurate |
| M9 Cockpit | CLOSED (v4.0.1) | Yes — 18 CLI commands, --json flag, hints system all present | Accurate |
| M10 Hydra | CLOSED (v5.0.0) | Yes — CdcChunker with buzhash, resolveChunker, CDC params in manifest | Accurate |
| M11 Locksmith | CLOSED (v5.1.0) | Yes — addRecipient, removeRecipient, listRecipients, envelope encryption | Accurate |
| M12 Carousel | CLOSED (v5.2.0) | Yes — rotateKey, keyVersion tracking, DEK re-wrapping | Accurate |
| M13 Bijou | CLOSED (v3.1.0) | Yes — dashboard TUI, progress bars, encryption card, manifest view, heatmap | Accurate |
| M14 Conduit | CLOSED (v4.0.0) | Yes — restoreStream, ObservabilityPort, Semaphore, parallel I/O | Accurate |
| M15 Prism | CLOSED | Yes — async sha256 on NodeCryptoAdapter, KeyResolver extracted | Accurate |

**Verdict: The roadmap is 100% accurate.** Every claimed milestone is verifiable in the codebase. No phantom features, no vaporware. This is unusual — most roadmaps overstate completion.

### Backlog Triage

The roadmap identifies 7 concerns (C1–C7) and 6 visions (V1–V6). Cross-referencing against Phase 2 findings:

**Concerns already identified by the roadmap that Phase 2 confirmed:**

| Concern | Roadmap Estimate | Phase 2 Finding | Agreement |
|---|---|---|---|
| C1: Memory amplification on encrypted restore | High severity, ~20 LoC | Flaw 2: Confirmed. O(n) memory for encrypted restores. | Full agreement |
| C2: Orphaned blob accumulation after STREAM_ERROR | Medium, ~20 LoC | Not independently discovered — the error handling drains promises correctly. Low priority. | Agreement on low urgency |
| C3: No upper bound on chunk size | Medium, ~6 LoC | Flaw 6: Confirmed. FixedChunker accepts any positive value. | Full agreement |
| C4: Web Crypto silent memory buffering | Medium, ~15 LoC | Flaw 3: Confirmed. `createEncryptionStream` buffers everything on Deno. | Full agreement |
| C5: Passphrase exposure in shell history | High, ~90 LoC | Not a code defect; architectural limitation of CLI passphrase flags. | Agreement |
| C6: No KDF brute-force rate limiting | Low, ~10 LoC | Not independently discovered. Low priority. | Agreement |
| C7: GCM nonce collision risk at scale | Low, ~20 LoC | Not practically exploitable. 2^48 encryptions needed for birthday bound on 96-bit nonce. | Agreement on low priority |

**Critical architectural flaws from Phase 2 that ARE MISSING from the backlog:**

1. **Crypto adapter behavioral inconsistencies (Flaw 1)** — The three adapters have different validation/error behavior. This is not mentioned in any concern or backlog item. The M15 Prism milestone addressed `sha256` async consistency but left the encrypt/decrypt inconsistencies untouched.

2. **CDC deduplication defeated by encrypt-then-chunk (Flaw 5)** — The fundamental design decision that encryption wraps the stream before chunking is not flagged as a concern or limitation in the roadmap. The Feature Matrix claims "Sub-file deduplication: Via chunking" without noting it only works for unencrypted data.

3. **FixedChunker quadratic buffer allocation (Flaw 4)** — Minor but missing from backlog. The CDC chunker received significant optimization attention; the fixed chunker did not.

**Backlog items that should be deprioritized:**

- **V1 Snapshot Trees** (~410 LoC, ~19h) — Nice to have but doesn't address any Phase 2 flaw.
- **V5 Watch Mode** (~220 LoC, ~10h) — Feature creep for a storage library.
- **V3 Manifest Diff Engine** (~180 LoC, ~8h) — Diagnostic tooling, not a stability concern.

**Backlog items that should be prioritized:**

- **C1 Memory amplification guard** — This is the highest-severity technical debt. 20 LoC to add a configurable ceiling.
- **Crypto adapter normalization** — Not in backlog. Needs to be added. ~30 LoC to align all three adapters.
- **V4 CompressionPort** (~180 LoC, ~8h) — Gzip-only compression is a significant limitation. zstd would provide 2-3x better compression ratios with faster decompression.

---

## Phase 4: The Blueprint for Success

### Month 1: Triage & Foundation

**Week 1–2: Crypto Adapter Normalization**

Align all three crypto adapters to identical behavioral contracts:

1. Add `_validateKey(key)` call to `NodeCryptoAdapter.decryptBuffer()` and `WebCryptoAdapter.decryptBuffer()`.
2. Add premature-finalize guard to `NodeCryptoAdapter.createEncryptionStream()`.
3. Make `NodeCryptoAdapter.encryptBuffer()` explicitly async (return `Promise`).
4. Add a cross-adapter behavioral test suite that asserts identical behavior for all three adapters given the same inputs.

*Estimated: ~50 LoC changes, ~100 LoC tests.*

**Week 2: Memory Safety Guards**

1. Add `maxRestoreBufferSize` option to CasService constructor (default: 512 MiB). Throw `CasError('RESTORE_BUFFER_EXCEEDED')` if the concatenated chunk buffer exceeds this limit in `_restoreBuffered()`.
2. Add buffer size guard to `WebCryptoAdapter.createEncryptionStream()` — throw if accumulated buffer exceeds a configurable limit.
3. Add upper bound validation to `FixedChunker` constructor (e.g., max 100 MiB) and `CdcChunker` (already has `maxChunkSize` but no ceiling on the ceiling).

*Estimated: ~40 LoC changes, ~30 LoC tests.*

**Week 3: FixedChunker Buffer Optimization**

Replace the `Buffer.concat([buffer, data])` loop in `FixedChunker.chunk()` with a pre-allocated working buffer pattern matching `CdcChunker`:

```js
const buf = Buffer.allocUnsafe(this.#chunkSize);
let offset = 0;
for await (const data of source) {
  let srcPos = 0;
  while (srcPos < data.length) {
    const n = Math.min(data.length - srcPos, this.#chunkSize - offset);
    data.copy(buf, offset, srcPos, srcPos + n);
    offset += n;
    srcPos += n;
    if (offset === this.#chunkSize) {
      yield Buffer.from(buf);
      offset = 0;
    }
  }
}
if (offset > 0) yield Buffer.from(buf.subarray(0, offset));
```

*Estimated: ~20 LoC change.*

**Week 4: Missing pre-commit Hook + Process Hygiene**

1. Add `scripts/git-hooks/pre-commit` that runs `pnpm run lint`.
2. Rename `scripts/git-hooks/` to `scripts/hooks/` to match CLAUDE.md convention (or update CLAUDE.md — choose one).
3. Add `Error.captureStackTrace` guard in `CasError`: `if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);`

*Estimated: ~10 LoC changes.*

### Month 2: Structural Evolution

**CompressionPort Abstraction (V4)**

The current gzip-only compression is hardcoded. Introduce a `CompressionPort` abstract class with `compress(source)` and `decompress(source)` async generator methods. Implement `GzipCompressor` (existing behavior) and `ZstdCompressor` (via `node:zlib` or `zstd-codec`). Update `CompressionSchema` to accept `'gzip' | 'zstd'`.

*Estimated: ~180 LoC, aligns with V4 vision.*

**Document the Encrypt-Then-Chunk Limitation**

This is not fixable without a major architectural change (chunk-then-encrypt with per-chunk AEAD). The correct action is:

1. Document that CDC deduplication is ineffective for encrypted data.
2. Consider emitting a warning when `encryption + chunking.strategy === 'cdc'` are both specified.
3. If the user explicitly opts in, allow it — but make the trade-off visible.

*Estimated: ~10 LoC (warning), documentation update.*

**Interactive Passphrase Prompt (V6)**

Address concern C5 (passphrase exposure in shell history) by adding TTY-based passphrase prompts with echo disabled. Fall back to flag-based input when stdin is not a TTY.

*Estimated: ~90 LoC, aligns with V6 vision.*

### Month 3: Strategic Re-alignment

**Portable Bundles (V2)**

The air-gapped use case is a key differentiator. Implement `.casb` bundle files that package manifest + chunks for transport without Git. This enables:
- Export: `git cas export --slug <slug> --out archive.casb`
- Import: `git cas import --bundle archive.casb`

*Estimated: ~340 LoC, aligns with V2 vision.*

**Garbage Collection Automation**

The `deleteAsset` and `findOrphanedChunks` methods are analysis-only. Complete the lifecycle:
1. Rename `deleteAsset` to `inspectAsset` or `getAssetMetadata` (breaking change).
2. Implement actual GC via `git prune` after vault entry removal.
3. Add `git cas gc` CLI command with `--dry-run` support.

*Estimated: ~80 LoC.*

**CI Hardening**

1. Add `dependabot.yml` for dependency updates.
2. Add `CODEOWNERS` file.
3. Add security scanning (e.g., `npm audit` in CI).
4. Add `SECURITY.md` at project root (currently missing, noted in CLAUDE.md scaffolding requirements).

---

### Executive Conclusion

**Health: Strong.** This is a well-architected, thoroughly tested codebase with a clear domain model, strict port/adapter boundaries, and an unusually high test-to-code ratio (3.1:1). The 833+ unit tests with real crypto (never mocked) and fuzz coverage demonstrate a commitment to correctness that is rare in the Node.js ecosystem.

**Intellectual Property Value: Moderate-High.** The novel contributions — Git ODB as CAS, buzhash CDC with xorshift-seeded tables, zero-cost DEK/KEK key rotation, vault commit chains with CAS semantics — represent genuine engineering innovation. These are not reimplementations of existing libraries; they are original abstractions built on well-understood primitives.

**Technical Debt: Low.** The roadmap's 7 concerns accurately catalog the known issues. Phase 2 surfaced only 3 additional findings (crypto adapter inconsistencies, encrypt-then-chunk dedup limitation, FixedChunker buffer allocation), none of which are critical. The most urgent issue — memory amplification on encrypted restore — is a ~20 LoC fix.

**Long-term Viability: Good with caveats.** The system is viable for its target niche (Git-native encrypted binary storage). The Git subprocess bottleneck limits throughput for very high-frequency operations, but this is an acceptable trade-off for correctness and portability. The encrypt-then-chunk design is a permanent architectural constraint that limits CDC's value for encrypted data — this should be prominently documented rather than "fixed."

**The Honest Assessment:** This codebase punches above its weight. A ~3,900 LoC core library with 12,000 LoC of tests, multi-runtime support, envelope encryption, CDC chunking, Merkle manifests, and an interactive TUI — all with zero native dependencies and no external server requirements. The architecture is clean, the test coverage is comprehensive, and the roadmap is honest. The identified flaws are minor and addressable. This is a well-maintained project by someone who takes software engineering seriously.

---

*Audit conducted at commit `0f7f8e658e6cd094176541ac68d33b2a6ec75a91`.*
*All blob hashes verified via `git hash-object` against live repository state.*
