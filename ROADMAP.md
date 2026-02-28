# @git-stunts/cas — ROADMAP

Content-addressed storage backed by Git's object database (ODB), with optional encryption and pluggable codecs.

This roadmap is structured as:

1. **Header** — Platform, dependencies, supported environments
2. **Canonical CasError Codes** — Single registry of all error codes referenced by tasks
3. **Contracts** — Return/throw semantics for all public methods
4. **Version Plan** — Table mapping versions to milestones
5. **Milestone Dependency Graph** — ASCII diagram
6. **Milestones & Task Cards** — 7 milestones (4 closed, 3 open), remaining task cards
7. **Feature Matrix** — Competitive landscape vs. Git LFS, git-annex, Restic, Age, DVC
8. **Competitive Analysis** — When to use git-cas and when not to, with concrete scenarios

---

## 1) Platform & Supported Environments

### Supported runtimes
- Node.js: **22.x** (primary target)
- OS: Linux (CI), macOS (dev), Windows (best-effort; Git plumbing assumptions apply)

### External dependencies / assumptions
- Requires `git` available on PATH for adapter-backed operations (integration tests and real persistence).
- Uses Git plumbing commands via `cat-file`, `hash-object`, `ls-tree`, etc.
- Encryption uses **AES-256-GCM** (requires 32-byte key).
- Manifests validated by Zod schemas; malformed manifests must fail closed.

### Design constraints (non-negotiable)
- Git objects are immutable; "rollback" is conceptual (unreachable objects are GC'd).
- Integrity is enforced via SHA-256 digests per chunk and GCM auth tag for encrypted restores.
- APIs are additive in v1.x; any manifest-format break is reserved for v2.0.0.

---

## 2) Canonical CasError Codes

Single registry of all error codes used across the codebase. Each code is a string passed as the `code` argument to `new CasError(message, code, meta)`.

| Code | Description | Planned By |
|------|-------------|------------|
| `INVALID_KEY_LENGTH` | Encryption key is not exactly 32 bytes (AES-256 requirement). Error meta includes `{ expected: 32, actual: <number> }`. | v1.1.0 |
| `INVALID_KEY_TYPE` | Encryption key is not a Buffer or Uint8Array. | v1.1.0 |
| `INTEGRITY_ERROR` | Decryption auth-tag verification failed (wrong key, tampered ciphertext, or tampered tag), or chunk digest mismatch on restore. | v1.1.0 |
| `STREAM_ERROR` | Read stream failed during `storeFile`. Partial chunks may have been written to Git ODB (unreachable; handled by `git gc`). Meta includes `{ chunksWritten: <number> }`. | v1.2.0 |
| `MISSING_KEY` | Encryption key required to restore encrypted content but none was provided. | v1.2.0 |
| `TREE_PARSE_ERROR` | `git ls-tree` output could not be parsed into valid entries. | v1.2.0 |
| `MANIFEST_NOT_FOUND` | No manifest entry (e.g. `manifest.json` / `manifest.cbor`) found in the Git tree. | v1.4.0 |
| `GIT_ERROR` | Underlying Git plumbing command failed. Wraps the original error from the plumbing layer. | v1.2.0 |
| `INVALID_CHUNKING_STRATEGY` | Manifest contains unrecognized chunking strategy (not `fixed` or `cdc`). | Task 10.3 |
| `NO_MATCHING_RECIPIENT` | No recipient entry matches the provided KEK. Caller's key is not in the recipient list. | Task 11.1 |
| `DEK_UNWRAP_FAILED` | Failed to unwrap DEK with the provided KEK. Wrong key or tampered wrappedDek. | Task 11.1 |
| `RECIPIENT_NOT_FOUND` | Recipient label not found in manifest recipient list. | Task 11.2 |
| `RECIPIENT_ALREADY_EXISTS` | Recipient label already exists in manifest. | Task 11.2 |
| `CANNOT_REMOVE_LAST_RECIPIENT` | Cannot remove the last recipient — at least one must remain. | Task 11.2 |
| `ROTATION_NOT_SUPPORTED` | Key rotation requires envelope encryption (DEK/KEK model). Legacy manifests must be re-stored. | Task 12.1 |
| `STREAM_NOT_CONSUMED` | `finalize()` called on encryption stream before the generator was fully consumed. | v4.0.1 |

---

## 3) Contracts

Return and throw semantics for every public method (current and planned).

### `storeFile({ filePath, slug, filename, encryptionKey? })`
- **Returns:** `Promise<Manifest>` — frozen, Zod-validated value object.
- **Throws:** `CasError('INVALID_KEY_LENGTH')` if `encryptionKey` is provided and `length !== 32`.
- **Throws:** `CasError('INVALID_KEY_TYPE')` if `encryptionKey` is not a Buffer.
- **Throws:** `CasError('STREAM_ERROR')` if the read stream fails mid-store. No manifest is returned; partial blobs may remain in Git ODB.
- **Throws:** Node.js filesystem error if `filePath` does not exist or is unreadable.
- **Empty file:** Returns `Manifest { size: 0, chunks: [] }` with no blob writes for chunk content.

### `restoreFile({ manifest, encryptionKey?, outputPath })`
- **Returns:** `Promise<{ bytesWritten: number }>`.
- **Throws:** `CasError('INTEGRITY_ERROR')` if any chunk's SHA-256 digest does not match `chunk.digest`.
- **Throws:** `CasError('INTEGRITY_ERROR')` if decryption fails (wrong key or tampered ciphertext).
- **Throws:** `CasError('INVALID_KEY_LENGTH')` if `encryptionKey` is provided and `length !== 32`.
- **Empty manifest:** Creates a 0-byte file at `outputPath`.

### `encrypt({ buffer, key })`
- **Returns:** `{ buf: Buffer, meta: { algorithm: 'aes-256-gcm', nonce: string, tag: string, encrypted: true } }`.
- **Throws:** `CasError('INVALID_KEY_LENGTH')` if `key.length !== 32`.
- **Throws:** `CasError('INVALID_KEY_TYPE')` if `key` is not a Buffer.

### `decrypt({ buffer, key, meta })`
- **Returns:** `Buffer` — original plaintext.
- **Passthrough:** If `meta.encrypted` is falsy or `meta` is undefined, returns `buffer` unchanged.
- **Throws:** `CasError('INTEGRITY_ERROR')` if GCM auth-tag verification fails.

### `createTree({ manifest })`
- **Returns:** `Promise<string>` — Git OID of the created tree.
- **Throws:** Zod validation error if `manifest` is invalid.

### `readManifest({ treeOid })`
- **Returns:** `Promise<Manifest>` — frozen, Zod-validated value object.
- **Throws:** `CasError('MANIFEST_NOT_FOUND')` if no manifest entry exists in the tree.
- **Throws:** `CasError('GIT_ERROR')` if the underlying Git command fails.
- **Throws:** Zod validation error if the manifest blob is corrupt.

### `verifyIntegrity(manifest)`
- **Returns:** `Promise<boolean>` — `true` if all chunk digests match, `false` otherwise.
- **Does not throw** on mismatch; returns `false`.

### `deleteAsset({ treeOid })`
- **Returns:** `Promise<{ chunksOrphaned: number, slug: string }>`.
- **Throws:** `CasError('MANIFEST_NOT_FOUND')` (delegates to `readManifest`).
- **Side effects:** None. Caller must remove refs; physical deletion requires `git gc --prune`.

### `findOrphanedChunks({ treeOids })`
- **Returns:** `Promise<{ referenced: Set<string>, total: number }>`.
- **Throws:** `CasError('MANIFEST_NOT_FOUND')` if any `treeOid` lacks a manifest (fail closed).
- **Side effects:** None. Analysis only.

### `deriveKey({ passphrase, salt?, algorithm?, iterations? })`
- **Returns:** `Promise<{ key: Buffer, salt: Buffer, params: object }>`.
- **Algorithms:** `pbkdf2` (default), `scrypt` — both Node.js built-ins.
- **Throws:** Standard Node.js crypto errors on invalid parameters.

### CLI: `git cas store <file> --slug <slug> [--key-file <path>]`
- **Output:** Prints manifest JSON to stdout. If `--tree` is passed, prints only the Git tree OID instead.
- **Exit 0:** Store succeeded.
- **Exit 1:** Store failed (error message to stderr).

### CLI: `git cas tree --manifest <path>`
- **Output:** Prints Git tree OID to stdout.
- **Exit 0:** Tree created.
- **Exit 1:** Invalid manifest or Git error (message to stderr).

### CLI: `git cas restore <tree-oid> --out <path> [--key-file <path>]`
- **Output:** Writes restored file to `--out` path.
- **Exit 0:** Restore succeeded, prints bytes written to stdout.
- **Exit 1:** Integrity error, missing manifest, or I/O error (message to stderr).

### `restoreStream({ manifest, encryptionKey?, passphrase? })` *(implemented — v4.0.0)*
- **Returns:** `AsyncIterable<Buffer>` — verified, decrypted, decompressed chunks in index order.
- **Throws:** `CasError('INTEGRITY_ERROR')` if any chunk fails verification (iteration stops).
- **Throws:** `CasError('MISSING_KEY')` if encrypted and no key provided.
- **Memory:** O(chunkSize) — never buffers full file.

### `rotateKey({ manifest, oldKey, newKey, label? })` *(implemented — v5.2.0)*
- **Returns:** `Promise<Manifest>` — updated manifest with re-wrapped DEK and incremented `keyVersion`.
- **Throws:** `CasError('DEK_UNWRAP_FAILED')` if `oldKey` cannot unwrap the DEK.
- **Throws:** `CasError('ROTATION_NOT_SUPPORTED')` if manifest uses legacy (non-envelope) encryption.
- **Side effects:** None. Caller must persist via `createTree()`.

### `addRecipient({ manifest, existingKey, newRecipientKey, label })` *(implemented — v5.1.0)*
- **Returns:** `Promise<Manifest>` — updated manifest with additional recipient entry.
- **Throws:** `CasError('DEK_UNWRAP_FAILED')` if `existingKey` is wrong.
- **Throws:** `CasError('RECIPIENT_ALREADY_EXISTS')` if `label` already exists.
- **Side effects:** None. Caller must persist.

### `removeRecipient({ manifest, label })` *(implemented — v5.1.0)*
- **Returns:** `Promise<Manifest>` — updated manifest without the named recipient.
- **Throws:** `CasError('RECIPIENT_NOT_FOUND')` if `label` not in recipient list.
- **Throws:** `CasError('CANNOT_REMOVE_LAST_RECIPIENT')` if only 1 recipient remains.

### CLI: `git cas verify --oid <tree-oid> | --slug <slug>` *(implemented — v4.0.1)*
- **Output:** `ok` on success, `fail` on failure.
- **Exit 0:** All chunks verified.
- **Exit 1:** Verification failed or error.

### CLI: `git cas rotate --slug <slug> --old-key-file <path> --new-key-file <path>` *(implemented — v5.2.0)*
- **Output:** New tree OID on success.
- **Exit 0:** Rotation succeeded, vault updated.
- **Exit 1:** Wrong old key, unsupported manifest, or vault error.

### CLI: `git cas vault dashboard` *(implemented)*
- **Output:** Interactive full-screen TUI in TTY mode; static table in non-TTY.
- **Exit 0:** User quit normally.
- **Exit 1:** Vault ref missing or error.

### CLI: `git cas inspect --slug <slug> | --oid <tree-oid> [--heatmap]` *(implemented)*
- **Output:** Structured manifest anatomy view in TTY; JSON dump in non-TTY.
- **Exit 0:** Manifest read and displayed.
- **Exit 1:** Manifest not found or error.

### CLI: `git cas vault history --pretty` *(implemented)*
- **Output:** Color-coded timeline in TTY; plain `git log --oneline` without `--pretty`.
- **Exit 0:** History displayed.
- **Exit 1:** Vault ref missing or error.

---

## 4) Version Plan

| Version | Milestone | Codename | Theme | Status |
|--------:|-----------|----------|-------|--------|
| v4.0.1  | M8+M9     | Spit Shine + Cockpit | CryptoPort refactor, verify, --json, error handler, vault list | ✅ |
| v4.0.0  | M14       | Conduit  | Streaming I/O, observability, parallel chunks | ✅ |
| v3.1.0  | M13       | Bijou    | TUI dashboard & progress | ✅ |
| v5.0.0  | M10       | Hydra    | Content-defined chunking | ✅ |
| v5.1.0  | M11       | Locksmith | Multi-recipient encryption | ✅ |
| v5.2.0  | M12       | Carousel | Key rotation | ✅ |

---

## 5) Milestone Dependency Graph

```text
M7 Horizon (v2.0.0) ✅
M13 Bijou (v3.1.0) ✅
M14 Conduit (v4.0.0) ✅
M8 Spit Shine + M9 Cockpit (v4.0.1) ✅

M10 Hydra ──────────── ✅ v5.0.0
M11 Locksmith ──────── ✅ v5.1.0
  └──► M12 Carousel ── ✅ v5.2.0
```

---

## 6) Milestones & Task Cards

### Milestones at a glance

| #  | Codename      | Theme                      | Version | Tasks | ~LoC   | ~Hours | Status |
|---:|--------------|----------------------------|:-------:|------:|-------:|------:|:------:|
| M14| Conduit       | Streaming I/O, observability, parallel chunks | v4.0.0 | 4 | ~600 | ~18h | ✅ CLOSED |
| M13| Bijou         | TUI dashboard & progress   | v3.1.0  | 6     | ~650   | ~20h  | ✅ CLOSED |
| M8 | Spit Shine    | Review fixups              | v4.0.1  | 2     | ~150   | ~3h   | ✅ CLOSED |
| M9 | Cockpit       | CLI improvements           | v4.0.1  | 4     | ~190   | ~5h   | ✅ CLOSED |
| M10| Hydra         | Content-defined chunking   | v5.0.0  | 4     | ~690   | ~22h  | ✅ CLOSED |
| M11| Locksmith     | Multi-recipient encryption | v5.1.0  | 4     | ~580   | ~20h  | ✅ CLOSED |
| M12| Carousel      | Key rotation               | v5.2.0  | 4     | ~400   | ~13h  | ✅ CLOSED |

Completed task cards are in [COMPLETED_TASKS.md](./COMPLETED_TASKS.md). Superseded tasks are in [GRAVEYARD.md](./GRAVEYARD.md).

---

# M14 — Conduit (v4.0.0) ✅ CLOSED

All tasks completed (14.1–14.4). See [COMPLETED_TASKS.md](./COMPLETED_TASKS.md).

---

# M8 — Spit Shine (v4.0.1) ✅ CLOSED

All tasks completed (8.2–8.3). See [COMPLETED_TASKS.md](./COMPLETED_TASKS.md).

---

# M9 — Cockpit (v4.0.1) ✅ CLOSED

All tasks completed (9.2–9.5). See [COMPLETED_TASKS.md](./COMPLETED_TASKS.md).

---

# M10 — Hydra (v5.0.0) ✅ CLOSED

All tasks completed (10.1–10.4). See [COMPLETED_TASKS.md](./COMPLETED_TASKS.md).

# M11 — Locksmith (v5.1.0) ✅ CLOSED

All tasks completed (11.1–11.4). See [COMPLETED_TASKS.md](./COMPLETED_TASKS.md).

---

# M12 — Carousel (v5.2.0) ✅ CLOSED

All tasks completed (12.1–12.4). See [COMPLETED_TASKS.md](./COMPLETED_TASKS.md).

---

# 7) Feature Matrix

Competitive landscape for content-addressed storage, encrypted binary assets, and large-file Git tooling. Rows represent the union of features across the space — not just what git-cas offers, but what users encounter and expect when evaluating tools in this category.

**Legend:** ✅ Yes | ⚠️ Partial | ❌ No | 🗓 Planned | N/A Not applicable

**Competitors:**
- **Git LFS** — Large file storage via external server + pointer files
- **git-annex** — Distributed file management with GPG encryption and location tracking
- **Restic** — Encrypted backup with CDC dedup
- **Age** — Modern file encryption primitive (not a storage system)
- **DVC** — Data/ML version control with multi-backend remotes

---

### Storage & Chunking

| Feature | git-cas v2.0 | Planned | Git LFS | git-annex | Restic | Age | DVC | Use Case | Remarks | What it would take |
|---|---|---|---|---|---|---|---|---|---|---|
| Content-addressed storage | ✅ SHA-256 | — | ✅ SHA-256 | ✅ SHA-256/512 | ✅ SHA-256 | ❌ | ✅ MD5 | Dedup, integrity, immutability | git-cas is Git-native; others use separate object stores | — |
| Fixed-size chunking | ✅ 256 KiB default, configurable | — | ❌ | ⚠️ Special remotes only | ❌ | ❌ | ❌ | Break large files into stable blobs | Simple and deterministic; poor dedup on edits | — |
| Content-defined chunking (CDC) | ✅ v5.0.0 Buzhash | — | ❌ | ❌ | ✅ Rabin fingerprint, 512K–8M | ❌ | ❌ | Sub-file dedup on versioned data | Buzhash CDC engine with 98% chunk reuse on small edits | — |
| Sub-file deduplication | ✅ Via chunking | ✅ Via CDC | ❌ | ⚠️ Chunk-level only | ✅ Via CDC | ❌ | ❌ | Avoid storing redundant bytes | Fixed chunks dedup exact matches; CDC handles shifted content | CDC (M10) improves from exact-match to shift-tolerant |
| File-level deduplication | ✅ Git ODB | — | ✅ | ✅ | ✅ | ❌ | ✅ | Identical files stored once | All CAS systems get this for free | — |
| Git-native storage (ODB) | ✅ Blobs + trees | — | ❌ Separate LFS store | ⚠️ Pointers in ODB, content in annex | ❌ Custom format | ❌ | ❌ Cache dir | Inspectable via `git log`, replicable via `git push` | Unique to git-cas. Competitors use custom storage layers | — |
| External server required | ❌ | — | ✅ LFS server | ❌ | ❌ | ❌ | ❌ | Self-contained local operation | git-cas and git-annex work fully offline. LFS requires server infra | — |

---

### Encryption & Key Management

| Feature | git-cas v2.0 | Planned | Git LFS | git-annex | Restic | Age | DVC | Use Case | Remarks | What it would take |
|---|---|---|---|---|---|---|---|---|---|---|
| Client-side encryption | ✅ AES-256-GCM | — | ❌ | ✅ GPG | ✅ AES-256-CTR + Poly1305 | ✅ ChaCha20-Poly1305 | ❌ | Protect data at rest in untrusted storage | git-cas is the only Git-native tool with integrated encryption | — |
| Authenticated encryption (AEAD) | ✅ GCM auth tag | — | ❌ | ⚠️ GPG signature optional | ✅ Poly1305 | ✅ Poly1305 | ❌ | Tamper detection + confidentiality | GCM and Poly1305 both provide authentication. GPG can but doesn't by default | — |
| Per-chunk encryption | ✅ Streaming | — | ❌ | ❌ Whole-file | ❌ Per-pack | ✅ 64 KiB chunks | ❌ | Encrypt without buffering full file | git-cas and Age both stream; Restic encrypts packed blobs | — |
| Multi-recipient encryption | ✅ M11 Locksmith | — | ❌ | ✅ Multiple GPG keys | ✅ Multiple passwords | ✅ Multiple X25519 | ❌ | Team access without sharing a single key | Envelope encryption (DEK/KEK model) | — |
| Key rotation (no re-encrypt) | ✅ M12 Carousel | — | N/A | ⚠️ Can add keys; revoke requires re-encrypt | ✅ Re-wrap master key | ❌ | N/A | Respond to key compromise without re-storing data | Re-wraps DEK, data blobs untouched | — |
| KDF / passphrase keys | ✅ PBKDF2, scrypt | — | ❌ | ✅ GPG S2K | ✅ scrypt | ✅ scrypt | ❌ | Derive keys from passwords instead of managing raw bytes | git-cas supports both PBKDF2 (100k iterations) and scrypt | — |
| Argon2 KDF | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Memory-hard KDF resists GPU/ASIC attacks | No tool in this space supports Argon2 yet. Would require native/WASM addon | ~80 LoC + native dep. ~4h. Low priority — scrypt is adequate |
| Hardware security (YubiKey/HSM) | ❌ | ❌ | ❌ | ✅ GPG smartcard | ❌ | ✅ age-plugin-yubikey | ❌ | Keys never leave hardware token | Would require plugin system or GPG integration | Plugin architecture + PIV applet integration. ~300 LoC, ~16h. Low priority |
| SSH key as encryption identity | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ ed25519/RSA | ❌ | Encrypt to existing SSH keys without new key material | Age's signature feature; niche but convenient | X25519 key derivation from SSH ed25519. ~150 LoC, ~8h. Low priority |

---

### Compression & I/O

| Feature | git-cas v2.0 | Planned | Git LFS | git-annex | Restic | Age | DVC | Use Case | Remarks | What it would take |
|---|---|---|---|---|---|---|---|---|---|---|
| Compression | ✅ gzip | — | ❌ | ⚠️ Via GPG (zlib/bzip2) | ✅ zstandard | ❌ | ❌ | Reduce storage size for compressible data | Compress-before-encrypt pipeline. Only git-cas and Restic offer explicit control | — |
| Compression algorithm selection | ❌ gzip only | ❌ | ❌ | ⚠️ GPG's choice | ✅ zstd auto/max/off | ❌ | ❌ | Tune speed vs. ratio per workload | zstd is faster + better ratio than gzip. Would need CompressionPort | CompressionPort + zstd adapter. ~120 LoC, ~6h. Medium priority |
| Streaming store (O(1) memory) | ✅ AsyncIterable | — | ⚠️ Transfer adapters | ✅ GPG pipeline | ✅ Pack streaming | ✅ 64 KiB chunks | ❌ | Store arbitrarily large files without OOM | git-cas chunks and encrypts in streaming fashion | — |
| Streaming restore (O(1) memory) | ✅ restoreStream() | — | ⚠️ | ✅ | ✅ | ✅ | ❌ | Restore large files without OOM | Implemented in v4.0.0 (M14 Conduit) | — |
| Partial restore / byte-range | ❌ | ❌ | ❌ | ⚠️ Per-chunk retrieval | ✅ FUSE mount | ❌ | ❌ | Extract byte ranges without restoring full file | Manifest has chunk offsets; byte-range index is feasible | Chunk offset index + range API. ~200 LoC, ~10h. Low priority |

---

### Manifests & Indexing

| Feature | git-cas v2.0 | Planned | Git LFS | git-annex | Restic | Age | DVC | Use Case | Remarks | What it would take |
|---|---|---|---|---|---|---|---|---|---|---|
| Manifest / index format | ✅ JSON or CBOR | — | Pointer files (text) | Symlinks + location log | JSON index (encrypted) | Binary header | YAML .dvc files | Describe stored assets for retrieval | git-cas is unique in offering codec choice (JSON for humans, CBOR for perf) | — |
| Codec pluggability | ✅ JsonCodec, CborCodec | — | ❌ | ❌ | ❌ | ❌ | ❌ | Choose manifest format per use case | Extensible via CodecPort. No other tool offers this | — |
| Merkle tree manifests | ✅ v2 auto-split | — | ❌ | ❌ | ❌ | ❌ | ❌ | Scale manifests for millions of chunks | Auto-splits at threshold (default 1000). Transparent reconstitution | — |
| Vault / ref-based indexing | ✅ refs/cas/vault | — | ❌ | ✅ git-annex branch | ❌ | ❌ | ❌ | GC-safe asset index that survives `git gc` | CAS semantics with retry. Unique among Git-native tools | — |
| Manifest versioning | ✅ v1 flat, v2 Merkle + chunking | — | Pointer v1 only | ❌ | ❌ | ❌ | ❌ | Evolve format without breaking old manifests | Full backward compat: v2 code reads v1 manifests | — |

---

### Lifecycle & Management

| Feature | git-cas v2.0 | Planned | Git LFS | git-annex | Restic | Age | DVC | Use Case | Remarks | What it would take |
|---|---|---|---|---|---|---|---|---|---|---|
| Integrity verification | ✅ SHA-256 + GCM tag | — | ✅ SHA-256 | ✅ `annex fsck` | ✅ `restic check` | ✅ Poly1305 | ✅ MD5/SHA256 | Detect corruption or tampering | Per-chunk digest + auth tag. `verifyIntegrity()` API | — |
| Garbage collection | ⚠️ Vault prevents GC loss; manual `git gc` for cleanup | — | ✅ `lfs prune` | ✅ `unused` + `dropunused` | ✅ `forget` + `prune` | N/A | ✅ `dvc gc` | Reclaim storage from deleted assets | Vault refs keep blobs reachable. No automated sweeper | Vault squash + storage stats. ~80 LoC, ~3h. Low priority |
| Lifecycle management | ✅ readManifest, deleteAsset, findOrphanedChunks | — | ⚠️ Prune + server policies | ✅ Full (unused, drop, dead, whereis, numcopies) | ✅ Retention policies | N/A | ⚠️ `dvc gc` with scope flags | Inspect, audit, and plan deletions | git-annex is most mature. git-cas provides the primitives | — |
| Retention policies (time/count) | ❌ | ❌ | ❌ | ❌ | ✅ keep-last, keep-daily, keep-weekly, etc. | N/A | ❌ | Automated pruning by age or count | Backup-oriented feature. Out of scope for CAS library | Policy engine + vault history scanning. ~200 LoC, ~8h. Not planned |
| Incremental backups / snapshots | ❌ | ❌ | N/A | ✅ Sync transfers only changed content | ✅ Core design | N/A | ✅ Only changed files pushed | Efficient repeated backups | git-cas stores individual assets, not snapshot trees | Snapshot tree structure + diff engine. ~400 LoC, ~20h. Not planned |
| Location tracking | ❌ | ❌ | ❌ | ✅ `whereis`, numcopies, trust levels | ❌ | N/A | ❌ | Know which remotes hold copies of each file | git-annex's defining feature. Orthogonal to CAS | Location log in vault metadata. ~250 LoC, ~12h. Not planned |
| FUSE mount | ❌ | ❌ | ❌ | ⚠️ Third-party | ✅ `restic mount` | ⚠️ Rust `rage` only | ❌ | Browse stored assets as a filesystem | Requires platform-specific FUSE bindings | libfuse binding + virtual FS. ~500 LoC, ~24h. Not planned |

---

### Observability & Developer Experience

| Feature | git-cas v2.0 | Planned | Git LFS | git-annex | Restic | Age | DVC | Use Case | Remarks | What it would take |
|---|---|---|---|---|---|---|---|---|---|---|
| CLI tool | ✅ `git cas` subcommand | — | ✅ `git lfs` | ✅ `git annex` | ✅ `restic` | ✅ `age` | ✅ `dvc` | Terminal-based workflows | All tools have CLIs. git-cas integrates as a Git subcommand | — |
| Programmatic API / library | ✅ Node.js (ESM) | — | ⚠️ Go internal | ⚠️ Haskell | ⚠️ Go internal | ✅ Go, Rust, JS, Java, Python | ✅ Python | Integrate CAS into applications | git-cas and Age are the strongest library stories | — |
| Multi-runtime support | ✅ Node, Bun, Deno | — | ❌ Go only | ❌ Haskell only | ❌ Go only | ✅ Go, Rust, JS, Java, Python | ❌ Python only | Same library works across JS runtimes | Only git-cas and Age support multiple runtimes | — |
| Progress events (structured) | ✅ ObservabilityPort (metric/log/span) | — | ✅ Transfer protocol | ⚠️ Terminal bars | ✅ JSON Lines | ❌ | ⚠️ Terminal bars | Build progress bars, logging, monitoring | git-cas emits typed metrics per chunk via ObservabilityPort (v4.0.0) | — |
| CLI progress feedback | ✅ Animated (bijou) | — | ✅ | ✅ | ✅ | ❌ | ✅ | Users know operations are working | Implemented in v3.1.0 (M13 Bijou) | — |
| Structured output (--json) | ✅ `--json` | — | ❌ | ❌ | ✅ `--json` | ❌ | ✅ `--json` | CI/CD pipeline integration | Global `--json` flag on all commands | — |
| CLI `verify` command | ✅ `git cas verify` | — | ✅ Implicit on checkout | ✅ `annex fsck` | ✅ `restic check` | ❌ | ✅ `dvc check-ignore` | Audit integrity without restoring | Per-chunk SHA-256 verification | — |
| Actionable error messages | ✅ Hints | — | ⚠️ | ⚠️ | ✅ | ❌ | ✅ | Users know what went wrong and what to do next | Error codes + actionable hint map | — |

---

### Integration & Ecosystem

| Feature | git-cas v2.0 | Planned | Git LFS | git-annex | Restic | Age | DVC | Use Case | Remarks | What it would take |
|---|---|---|---|---|---|---|---|---|---|---|
| Multi-backend storage (S3, etc.) | ❌ Git ODB only | ❌ | ⚠️ Custom transfer adapters | ✅ S3, rsync, WebDAV, IPFS, bittorrent, rclone, etc. | ✅ S3, SFTP, Azure, GCS, Swift | N/A | ✅ S3, Azure, GCS, HDFS, SSH | Store content on cloud/remote infrastructure | git-cas deliberately uses Git as the transport layer (push/pull) | Remote backend port. ~300 LoC, ~16h. Not planned — Git remotes serve this role |
| File locking (pessimistic) | ❌ | ❌ | ✅ Lock API | ❌ | N/A | N/A | ❌ | Prevent concurrent edits on binary files | LFS-specific feature for team workflows on unmergeable files | Lock API on vault entries. ~150 LoC, ~8h. Not planned |
| Plugin / extension system | ❌ Ports (compile-time) | ❌ | ✅ Transfer adapters | ✅ External special remotes | ❌ | ✅ age-plugin-* | ✅ Remote plugins | Extend with custom backends, crypto, etc. | git-cas uses ports/adapters pattern (hexagonal), but no runtime plugin loading | Runtime plugin discovery. ~200 LoC, ~10h. Not planned |
| ML experiment tracking | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Metrics, params, plots, DVCLive | Track ML experiments with data versioning | DVC's differentiator. Out of scope for a CAS library | N/A — different product category |
| Pipeline / DAG execution | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ `dvc.yaml` + `dvc repro` | Reproducible data processing pipelines | DVC-specific. Out of scope | N/A — different product category |
| Post-quantum cryptography | ❌ | ❌ | ❌ | ❌ | ❌ | 🗓 X-Wing hybrid | ❌ | Future-proof against quantum attacks | Age has this on its roadmap (X-Wing KEM). Very early-stage across the industry | X-Wing KEM integration. Research-stage. Not planned |

---

### Competitive Summary

|  | git-cas | Git LFS | git-annex | Restic | Age | DVC |
|---|---|---|---|---|---|---|
| **Core identity** | Git-native CAS with encryption | Git large file offloading | Distributed file management | Encrypted backup with dedup | File encryption primitive | ML data version control |
| **Strongest at** | Git ODB integration, pluggable codecs, Merkle manifests, vault | Simplicity, file locking, ecosystem adoption | Backend diversity, location tracking, metadata views | CDC dedup, retention policies, FUSE mount | Multi-recipient, HSM, multi-language, simplicity | ML pipelines, experiment tracking, Python ecosystem |
| **Weakest at** | No multi-backend, gzip only | No encryption, no compression, requires server | Complexity, Haskell-only, no CDC | No Git integration, no library API | Not a storage system | No encryption, no chunking, no streaming |
| **Server required** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Best use case** | Encrypted binary assets in Git repos | Large files in GitHub/GitLab repos | Distributed archive management | Encrypted backups of filesystems | Encrypting files for recipients | ML model/data versioning |

---

### Where git-cas leads

1. **Git-native CAS** — Only tool that stores content directly in Git's object database. Assets are inspectable via `git log`, replicable via `git push`, and addressable via tree OIDs. No custom binary format, no external server.
2. **Merkle tree manifests** — No competitor offers automatic manifest splitting for very large files.
3. **Codec pluggability** — JSON for human readability, CBOR for binary efficiency. No other tool lets you choose.
4. **Vault with CAS semantics** — Atomic ref-based indexing with conflict detection and retry. Assets survive `git gc`.
5. **Multi-runtime JS library** — Works on Node, Bun, and Deno. Only Age offers comparable multi-runtime coverage.

### Where git-cas trails (and what closes the gap)

1. **Multi-recipient encryption** → M11 Locksmith. DEK/KEK envelope encryption. ~580 LoC, ~20h.
2. **Content-defined chunking** → M10 Hydra. Buzhash CDC engine + ChunkingPort. ~690 LoC, ~22h.
3. **Key rotation** → M12 Carousel. Re-wrap DEK without re-encrypting data. ~400 LoC, ~13h.
4. ~~**Streaming restore**~~ → ✅ Delivered in v4.0.0 (M14 Conduit). `restoreStream()` returning AsyncIterable.
5. **CLI polish** → M9 Cockpit. Verify, --json, actionable errors. ~190 LoC, ~5h.
6. ~~**CLI progress feedback**~~ → ✅ Delivered in v3.1.0 (M13 Bijou). Animated progress bars with throughput.
7. **Multi-backend storage** → Not planned. Git remotes serve as the transport layer by design. Adding S3/SFTP backends would dilute the "Git-native" identity.
8. **Compression algorithm selection** → Not on roadmap. CompressionPort + zstd adapter would cost ~120 LoC, ~6h. Medium priority.
9. **FUSE mount / partial restore** → Not planned. Niche for a CAS library. Would require ~500 LoC + platform-specific bindings.

---

# 8) Competitive Analysis — When to Use git-cas (and When Not To)

## The one-line pitch

git-cas is for people who want Git to be the whole stack — object store, transport, access control, audit log — and don't want to bolt on a second system for binary assets.

Every competitor in this space either requires an external server (Git LFS), invents a custom storage format (Restic, DVC), or isn't a storage system at all (Age). git-cas is the only tool that writes content directly into Git's object database as native blobs and trees, meaning your assets travel with `git push`, deduplicate with `git gc`, and are addressable with tree OIDs in commits and tags. If that sentence excited you, this is your tool. If it didn't, keep reading — one of the others might be a better fit.

---

## When to use git-cas

### 1. Encrypted binary assets in a Git monorepo

**Scenario:** You're building a game, a design system, or a firmware project. You have binary assets (textures, fonts, model weights, firmware images) that belong in the same repo as your source code. Some of them are sensitive (signing keys, license bundles, proprietary models) and need to be encrypted at rest, even in private repos.

**Why git-cas:** Assets live in the Git ODB alongside your source. They're committed, branched, tagged, and pushed like any other object. Encryption is AES-256-GCM, integrated into the chunking pipeline, not bolted on after the fact. The vault keeps them GC-safe. You don't need a second storage system, a second credential set, or a second billing account.

**Why not Git LFS:** LFS can't encrypt. LFS requires a server. LFS pointer files are not the content — they're redirects to an external store that you have to provision, pay for, and maintain separately.

**Why not git-annex:** git-annex can do this, but it stores content in `.git/annex/objects`, not in the Git ODB. It requires GPG for encryption (heavyweight, config-heavy, S2K-based KDF). It's a Haskell binary — you can't import it as a library in your Node/TypeScript build system. If you're already in the Haskell ecosystem and need distributed location tracking, git-annex is phenomenal. If you're in the JavaScript ecosystem and want a library, it's the wrong tool.

---

### 2. Self-hosted secret bundles without external infrastructure

**Scenario:** Your team stores deployment secrets, TLS certificates, or environment bundles in a private Git repo. You want encryption at rest, passphrase-based access, and zero dependency on external services (no Vault server, no AWS KMS, no 1Password CLI).

**Why git-cas:** `git cas store ./secrets.tar.gz --slug prod-secrets --tree --vault-passphrase "correct horse battery staple"` — done. Encrypted, vaulted, GC-safe, and replicable to any Git remote. Restore with the passphrase. No infrastructure. No SaaS. No tokens to rotate (until M12 ships, and then you can rotate those too).

**Why not sops/Age:** If your secrets are structured YAML/JSON (Kubernetes secrets, Terraform vars), sops is purpose-built for that — it encrypts individual values within the file, so you can `git diff` the structure without decrypting. git-cas encrypts the entire blob. If you need per-field encryption and diffable ciphertext, use sops. If you need to store opaque binary bundles (tarballs, keystores, firmware signing keys), git-cas is the better fit.

---

### 3. Deterministic, content-addressed artifact storage

**Scenario:** Your CI pipeline produces build artifacts (WASM bundles, compiled binaries, ML model checkpoints). You want to store them content-addressed so identical builds don't duplicate storage, and you want to reference them by tree OID in release commits.

**Why git-cas:** Store the artifact, get a tree OID, commit that OID in your release tag. The artifact is now permanently addressable at that commit. `git cas restore --oid <tree-oid> --out ./artifact.wasm` retrieves it anywhere the repo is cloned. Deduplication is free — if two builds produce identical output, Git stores one copy. Manifests give you a chunk-level inventory with SHA-256 digests.

**Why not DVC:** If your artifacts are outputs of a reproducible pipeline with parameters, metrics, and experiments, DVC is built exactly for that. DVC tracks inputs → outputs through a DAG, supports experiment comparison, and integrates with ML frameworks via DVCLive. git-cas stores blobs — it doesn't understand pipelines, parameters, or metrics. If you need `dvc repro` and `dvc exp`, use DVC. If you need a dumb content-addressed blob store that lives inside Git, use git-cas.

---

### 4. Embedding binary data packs in libraries or SDKs

**Scenario:** You're shipping an npm package or JSR module that needs to bundle a data file (a wasm binary, a trained model, a lookup table) that's too large for Git's comfort zone but too tightly coupled to the code to live in a separate system.

**Why git-cas:** Store the data pack via the programmatic API (`cas.storeFile()`), commit the tree OID, and restore it in your build script or at runtime. The data travels with `git clone` — no post-install fetch from a CDN, no `git lfs pull`, no separate authentication. Your consumers don't need to know git-cas exists; they just clone and build.

**Why not Git LFS:** LFS requires consumers to have LFS installed and configured, and it requires a server to host the objects. If your package is on npm or JSR, the LFS objects don't travel with `npm install` — they're left behind on the LFS server, which your consumers may not have access to.

---

### 5. Offline-first or air-gapped environments

**Scenario:** You're working in a classified environment, an air-gapped network, or a submarine (it happens). You need encrypted binary asset management with zero network dependencies.

**Why git-cas:** Everything is local. `git init`, `npm install @git-stunts/git-cas`, and go. No server, no cloud, no tokens, no DNS resolution. Push to a USB drive via `git bundle` if you need to transfer. Encryption is client-side. The vault is a Git ref. The entire system fits in a single repo directory.

**Why not anything cloud-dependent:** Git LFS needs a server. DVC's value proposition is built around remote storage (S3, GCS). Restic can work locally but is designed around the backup-to-remote workflow. git-annex is the closest competitor here — it also works fully offline — but it brings GPG complexity and doesn't integrate as a JavaScript library.

---

## When NOT to use git-cas

### 0. You just want images or demos in your README

**Use instead: an orphan branch**

**Scenario:** You want to put screenshots, demo GIFs, and logos in your repo's README. The assets are public, small (< 5 MB each), and you want GitHub to render them inline.

**Why not git-cas:** It's overkill. You don't need encryption, chunking, manifests, or a vault for a 200 KiB screenshot. git-cas adds a dependency, a CLI workflow, and conceptual overhead for a problem that's already solved by 5 git commands.

**Why an orphan branch:** `git checkout --orphan assets`, `git rm -rf .`, add your images, commit, push. Reference them with `![Demo](../assets/demo.gif?raw=true)`. No dependencies, no tooling, no build step. GitHub renders them directly. Every developer on your team already knows how to do this. The approach is documented everywhere and works with every Git host.

**The honest line:** If your assets are public and small, the orphan branch pattern is simpler and better. git-cas earns its keep when you need encryption, dedup, compression, integrity verification, or lifecycle management — not when you need a GIF in a README.

---

### 1. You need to back up an entire filesystem

**Use instead: Restic**

**Scenario:** You want nightly encrypted backups of `/home` or a database dump directory, with 30-day retention, incremental snapshots, and the ability to mount old snapshots as a virtual filesystem.

**Why not git-cas:** git-cas stores individual assets by slug. It doesn't have a concept of filesystem snapshots, retention policies, or incremental diffing. You'd have to build all of that yourself. It doesn't have FUSE mounting. It doesn't have `--keep-daily 7 --keep-weekly 4 --keep-monthly 12`.

**Why Restic:** Restic was built for exactly this. Content-defined chunking means incremental backups only store changed chunks. Retention policies automate pruning. `restic mount` lets you browse any snapshot. AES-256 encryption is mandatory and always-on. scrypt KDF. JSON progress output. It's the gold standard for encrypted backups.

---

### 2. You need large file storage on GitHub/GitLab with team workflows

**Use instead: Git LFS**

**Scenario:** Your team of 30 designers commits Photoshop files, video assets, and 3D models to a GitHub repo. You need file locking so two people don't edit the same binary simultaneously, and you want GitHub's UI to show file sizes and download links.

**Why not git-cas:** git-cas has no file locking. It has no integration with GitHub's LFS API, no web UI support for previewing large files, and no concept of "tracks" or `.gitattributes`-based auto-detection. You'd be managing everything manually through the CLI or API.

**Why Git LFS:** LFS is the ecosystem default. GitHub, GitLab, Bitbucket, and Gitea all speak the LFS protocol natively. File locking prevents concurrent binary edits. `.gitattributes` tracks patterns automatically. The web UI shows LFS-tracked files with download links. It's less capable (no encryption, no compression, no chunking), but it's the path of least resistance for teams on hosted Git platforms.

---

### 3. You need to distribute files across dozens of storage backends

**Use instead: git-annex**

**Scenario:** You're managing a research dataset that's replicated across 5 university servers (rsync), 2 S3 buckets, a WebDAV share, and a colleague's external hard drive. You need to track which copies exist where, enforce minimum replica counts, and selectively sync subsets.

**Why not git-cas:** git-cas stores everything in the Git ODB. The only "remote" is wherever you `git push` to. There's no concept of special remotes, location tracking, numcopies enforcement, or selective sync. Your data goes where Git goes, period.

**Why git-annex:** This is git-annex's entire reason for existing. It supports S3, rsync, WebDAV, Tahoe-LAFS, bittorrent, IPFS, rclone, and custom external remotes. `git annex whereis` tells you which remotes hold each file. `numcopies` ensures a minimum replica count. `git annex get --from=university-server` fetches specific files from specific remotes. No other tool in this space comes close to this level of distributed file management.

---

### 4. You're building ML pipelines with experiment tracking

**Use instead: DVC**

**Scenario:** You're training ML models. You want to version your training data, track hyperparameters, compare metrics across experiments, and reproduce any previous run. Your data lives on S3 and your code is on GitHub.

**Why not git-cas:** git-cas is a content-addressed blob store. It doesn't understand what a "parameter" is, what a "metric" is, or what a "pipeline stage" is. It can store your model weights, but it can't track which hyperparameters produced them, compare accuracy across runs, or rerun a training pipeline.

**Why DVC:** DVC was purpose-built for this workflow. `dvc.yaml` defines pipeline stages with dependencies and outputs. `dvc exp run` executes experiments with parameter variations. `dvc metrics diff` compares runs. `dvc plots` visualizes training curves. DVCLive integrates with PyTorch and TensorFlow for live logging. The Python API (`dvc.api.open()`) reads versioned data from any DVC remote. It's the MLOps standard.

---

### 5. You need to encrypt files for specific people using their SSH or PGP keys

**Use instead: Age**

**Scenario:** You want to encrypt a file so that Alice (SSH key), Bob (age key), and Carol (YubiKey) can all decrypt it. You don't need storage, chunking, or manifests — just "encrypt this file for these three people."

**Why not git-cas:** git-cas v2.0 uses a single symmetric key. There's no concept of recipients, public-key encryption, or hardware tokens. M11 Locksmith will add multi-recipient via DEK/KEK, but it won't support SSH keys, X25519 identity files, or YubiKey PIV — it's symmetric KEKs only.

**Why Age:** Age is a pure encryption primitive that does one thing exceptionally well. `age -r ssh-ed25519:AAAA... -r age1... -o secret.enc secret.txt` encrypts for two recipients using their existing keys. The `age-plugin-yubikey` adds hardware token support. Implementations exist in Go, Rust, JavaScript, Java, and Python. It's heading toward post-quantum readiness with X-Wing. If your problem is "encrypt a file for specific people," Age is the answer.

---

### 6. Your repo has >10 GB of binary assets and you need fast clone times

**Use instead: Git LFS or DVC**

**Scenario:** Your game repo has 50 GB of textures and audio. New developers need to clone the repo and start working without downloading all 50 GB upfront.

**Why not git-cas:** git-cas stores blobs in the Git ODB. `git clone` downloads everything. There's no lazy fetching, no sparse checkout for binary assets, no "download only what you need." The vault keeps objects reachable, which means `git gc` won't prune them, which means every clone gets the full history of every binary asset.

**Why Git LFS / DVC:** Both use pointer files in the Git tree and store actual content externally. `git clone` downloads only the small pointer files. `git lfs pull` or `dvc pull` fetches the actual content on demand, optionally filtered by path or pattern. For very large asset repositories, this deferred-fetch model is essential for developer productivity.

---

## Decision flowchart

```text
Do you need encrypted binary storage inside Git's ODB?
├── YES → git-cas
│   ├── Need multi-recipient? → Wait for M11 or use Age for the encryption layer
│   ├── Need CDC dedup? → Wait for M10
│   └── Need >10 GB with lazy clone? → git-cas is the wrong tool. Use LFS + separate encryption
│
├── NO, I just need images/demos in my README
│   └── Orphan branch (git checkout --orphan assets). Zero dependencies, GitHub renders inline.
│
├── NO, I need filesystem backups
│   └── Restic
│
├── NO, I need large files on GitHub with team workflows
│   └── Git LFS
│
├── NO, I need distributed file replication across many backends
│   └── git-annex
│
├── NO, I need ML pipeline tracking + data versioning
│   └── DVC
│
└── NO, I just need to encrypt a file for specific people
    └── Age
```

---

## The honest assessment

git-cas occupies a specific niche: **Git-native encrypted content-addressed storage for people who want one system, not two.** It's not the best backup tool (Restic is). It's not the best large-file-on-GitHub tool (LFS is). It's not the best distributed file manager (git-annex is). It's not the best ML data versioner (DVC is). It's not the best encryption primitive (Age is).

What it is: the only tool that lets you `git cas store ./model.bin --slug v3-weights --tree --vault-passphrase "secret"`, commit the tree OID, push to any Git remote, and restore it on any machine with `git cas restore --slug v3-weights --out ./model.bin --vault-passphrase "secret"` — no server, no external storage, no second system. Everything is Git objects, Git refs, Git transport.

If that's what you want, nothing else does it. If it's not, the right tool probably isn't git-cas.

---

# M13 — Bijou (v3.1.0) ✅ CLOSED

All tasks completed (13.1–13.6). See [COMPLETED_TASKS.md](./COMPLETED_TASKS.md).

---

## Backlog (unscheduled)

Ideas for future milestones. Not committed, not prioritized — just captured.

### Named Vaults
Multiple vaults instead of one. Refs move from `refs/cas/vault` to `refs/cas/vaults/<name>`. Default vault is `default`. CLI gets `--vault <name>` flag.

### Export
- **Export vault to archive** — `git cas vault export --format tar.gz` dumps all entries to a tarball/zip.
- **Export individual entry** — `git cas export --slug photos/vacation --format tar.gz` restores and archives a single entry.
- **Bulk export** — restore multiple slugs into a single archive.

### Vault Management
- **Move into vault** — `git cas vault add --slug <slug> --oid <tree-oid>` to adopt an existing CAS tree into the vault (the API `addToVault()` already supports this; just needs a CLI command).
- **Purge from CAS** — remove an entry from the vault and run `git gc` to reclaim storage. Tricky because git doesn't delete individual objects — you remove refs and let GC handle it.

### Publish / Mount
- **Publish to working tree** — `git cas publish --slug assets/hero --to docs/hero.gif` reconstitutes a vault entry into the repo's working tree so it's servable by GitHub (markdown images, Pages, etc.).
- **Publish to branch** — `git cas publish --branch gh-assets` materializes all vault entries onto a dedicated branch. Keeps the main branch clean while making assets accessible via GitHub raw URLs.
- **Auto-publish hook** — pre-commit or CI step that keeps published assets in sync with vault state.

### Repo Intelligence
- **Duplicate detection on store** — warn if a file being stored already exists as a tracked git blob (same content hash). "This file is already tracked by git — are you sure you want to store it in CAS too?"
- **Repo scan / dedup advisor** — `git cas scan` walks the git object database and recommends files that could benefit from CAS (large blobs, binary files, duplicated content across branches). Reports dedup opportunities and potential storage savings.

---

# Ideas & Visions

New feature concepts with fully fleshed out visions and mini battle plans. Not committed to any milestone — captured here for future consideration and discussion.

---

## Vision 1: Snapshot Trees — Directory-Level Store

**The Pitch**

Today, git-cas stores one file at a time. Storing a build output directory means N separate `storeFile()` calls, N separate vault entries, and the caller manually tracking which slugs belong together. There's no concept of "this set of files is one atomic artifact."

Snapshot trees change that. `git cas store-tree ./dist --slug release/v4.0.0` stores an entire directory as a single CAS tree — one root manifest that references child manifests per file, one vault entry, one tree OID. Restore reconstitutes the full directory structure. This unlocks "store my build output" as a single atomic operation.

**Why It Matters**

- **CI/CD artifacts**: `npm run build && git cas store-tree ./dist --slug build/$CI_COMMIT_SHA --tree` — one command, one OID, committed in the release tag.
- **Dataset versioning**: Store a directory of CSV/Parquet files as a single versioned snapshot, restore any version atomically.
- **Config bundles**: Store an entire config directory (TLS certs, env files, deploy scripts) as one encrypted vault entry.
- **Binary releases**: Store a multi-file release (binary + README + license + checksums) as one restorable unit.

**Manifest Design**

```json
{
  "version": 3,
  "type": "tree",
  "slug": "release/v4.0.0",
  "entries": [
    { "path": "index.js", "manifestOid": "abc123...", "size": 45200 },
    { "path": "lib/utils.js", "manifestOid": "def456...", "size": 12800 },
    { "path": "assets/logo.png", "manifestOid": "789abc...", "size": 204800 }
  ],
  "totalSize": 262800,
  "totalChunks": 12,
  "encryption": { ... },
  "compression": { ... }
}
```

Each `entries[].manifestOid` points to a standard file-level manifest blob (v1/v2). The root tree manifest is the index; child manifests are the per-file metadata. Encryption and compression applied per-file, configured at the tree level.

**Mini Battle Plan**

| Phase | Work | ~LoC | ~Hours |
|-------|------|------|--------|
| 1. Schema | Add `TreeManifestSchema` with `type: 'tree'`, `entries[]` array. Backward compat: existing manifests have no `type` field (treated as `type: 'file'`). | ~40 | ~2h |
| 2. CasService | `storeTree({ source: string, slug, encryptionKey?, compression? })` — walks directory recursively, stores each file via existing `store()`, collects child manifests, builds root tree manifest. Parallel file stores via semaphore. | ~120 | ~6h |
| 3. CasService | `restoreTree({ manifest, outputDir, encryptionKey? })` — reads root tree manifest, restores each child file to `outputDir/entry.path`. Creates intermediate directories. | ~80 | ~4h |
| 4. Facade | Wire `storeDirectory()` and `restoreDirectory()` through `ContentAddressableStore`. | ~30 | ~1h |
| 5. CLI | `git cas store-tree <dir> --slug <slug>` and `git cas restore --slug <slug> --out <dir>` (auto-detect tree vs file manifest). | ~40 | ~2h |
| 6. Tests | Round-trip with nested dirs, empty dirs, symlinks (skip or follow?), encrypted+compressed trees, Merkle child manifests. | ~100 | ~4h |
| **Total** | | **~410** | **~19h** |

**Open Questions**
- Symlinks: follow, skip, or store as metadata?
- Empty directories: include in manifest or skip?
- File permissions: record and restore, or ignore?
- Maximum depth limit to prevent unbounded recursion?

---

## Vision 2: Portable Bundles — Air-Gap Transfer

**The Pitch**

`git cas bundle --slug my-asset --out asset.casb` creates a self-contained bundle file that includes the manifest, all chunk blobs, and enough metadata to import into any git-cas-enabled repo. `git cas import --bundle asset.casb` reconstitutes it. Like `git bundle` but for CAS assets.

This enables offline transfer between air-gapped systems without needing `git push/pull` or shared remotes. Ship a USB stick, email an encrypted bundle, or distribute via any file transfer mechanism.

**Bundle Format**

```text
┌─────────────────────────────┐
│ Magic: "CASB\x01"   (5B)   │  ← Version 1 bundle
│ Header length       (4B)    │
│ Header (JSON):              │
│   { slug, filename, size,   │
│     chunkCount, encrypted,  │
│     compressed, codec }     │
│ Manifest blob       (var)   │
│ Chunk 0 length      (4B)   │
│ Chunk 0 data        (var)   │
│ Chunk 1 length      (4B)   │
│ Chunk 1 data        (var)   │
│ ...                         │
│ SHA-256 checksum     (32B)  │  ← Over everything above
└─────────────────────────────┘
```

Simple, streamable, no external dependencies. The checksum at the end covers the entire bundle — tamper detection without needing encryption.

**Mini Battle Plan**

| Phase | Work | ~LoC | ~Hours |
|-------|------|------|--------|
| 1. Format spec | Define bundle wire format, version byte, header schema. Document in `docs/BUNDLE-FORMAT.md`. | ~0 prod, ~40 docs | ~1h |
| 2. Bundle writer | `CasService.createBundle({ manifest, output: WritableStream })` — streams manifest + chunks into bundle format. Calculates trailing checksum. | ~80 | ~4h |
| 3. Bundle reader | `CasService.importBundle({ input: ReadableStream })` — parses header, validates checksum, writes blobs to Git ODB, returns manifest. | ~100 | ~5h |
| 4. Facade + CLI | `git cas bundle --slug <slug> --out <path>` and `git cas import --bundle <path> [--vault]`. | ~40 | ~2h |
| 5. Tests | Round-trip, corrupted bundle (bad checksum), encrypted bundles, Merkle manifests, partial read (truncated file). | ~80 | ~3h |
| **Total** | | **~340** | **~15h** |

**Why Not Just `git bundle`?**

`git bundle` exports entire ref histories. It requires the recipient to have a compatible Git repo structure. CAS bundles export a single asset with just the manifest and blobs — no ref history, no commit chain, no pack negotiation. They're smaller, simpler, and purpose-built for asset transfer.

---

## Vision 3: Manifest Diff Engine

**The Pitch**

`git cas diff --from photos/v1 --to photos/v2` compares two manifests and shows which chunks changed, were added, or removed. With CDC (M10), this becomes extremely powerful — you can see exactly which byte ranges of a binary file changed between versions.

**API Design**

```js
const diff = await cas.diffManifests({ oldManifest, newManifest });
// Returns:
// {
//   unchanged: [{ index, digest, size }],
//   added:     [{ index, digest, size }],
//   removed:   [{ index, digest, size }],
//   modified:  [{ oldIndex, newIndex, oldDigest, newDigest }],
//   summary: {
//     unchangedBytes: 1048576,
//     addedBytes: 262144,
//     removedBytes: 0,
//     reuseRatio: 0.8,  // 80% of chunks reused
//   }
// }
```

The diff is purely metadata-based — no blob reads required. Compare chunk digests between manifests. With fixed chunking, any insertion shifts all downstream chunks (low reuse). With CDC, insertions affect 1-2 chunks (high reuse). The `reuseRatio` metric quantifies dedup efficiency.

**TUI Integration**

```
git cas diff --from photos/v1 --to photos/v2 --heatmap

 v1:  ████████████████████████████████████████
 v2:  ████████░░░░████████████████████████████
                ^^^^
         2 chunks changed (bytes 524288–786432)
         38/40 chunks reused (95.0%)
```

**Mini Battle Plan**

| Phase | Work | ~LoC | ~Hours |
|-------|------|------|--------|
| 1. Diff engine | `CasService.diffManifests({ oldManifest, newManifest })` — digest-set comparison, handles reordering. | ~60 | ~3h |
| 2. CLI command | `git cas diff --from <slug/oid> --to <slug/oid>` with human-readable summary. | ~30 | ~1h |
| 3. Heatmap view | Side-by-side chunk heatmap showing unchanged (green), changed (red), added (yellow) blocks. Reuses bijou gradient components from Task 13.5. | ~40 | ~2h |
| 4. Tests | Identical manifests (0 diff), completely different, single-chunk change, CDC vs fixed dedup comparison. | ~50 | ~2h |
| **Total** | | **~180** | **~8h** |

**Synergy with M10 Hydra**: Diff becomes dramatically more useful with CDC. Fixed chunking: insert 1 byte → 100% of downstream chunks changed. CDC: insert 1 byte → 1-2 chunks changed. The diff engine quantifies this, making CDC's value proposition concrete and measurable.

---

## Vision 4: CompressionPort — zstd, brotli, lz4

**The Pitch**

Currently, compression is hardcoded to gzip. The `CompressionPort` abstraction mirrors the existing `CryptoPort` and `CodecPort` patterns — a port with pluggable adapters. The manifest already records `compression.algorithm`, so backward compat is built in.

**Why This Matters**

| Algorithm | Ratio (typical) | Compress speed | Decompress speed | Best for |
|-----------|-----------------|----------------|------------------|----------|
| gzip | Good | Slow (~50 MB/s) | Moderate (~300 MB/s) | Current default |
| **zstd** | **Excellent** | **Fast (~500 MB/s)** | **Very fast (~1.5 GB/s)** | **General purpose, best all-rounder** |
| brotli | Excellent | Very slow (~10 MB/s) | Fast (~500 MB/s) | Pre-compressed web assets |
| lz4 | Moderate | Ultra-fast (~2 GB/s) | Ultra-fast (~4 GB/s) | Speed-critical, low-latency |

Zstd alone would give 5-10x faster compression with equal or better ratio. For a tool that compresses before encrypting, compression speed directly impacts store throughput.

**Mini Battle Plan**

| Phase | Work | ~LoC | ~Hours |
|-------|------|------|--------|
| 1. Port definition | `src/ports/CompressionPort.js` — `compress(source: AsyncIterable<Buffer>): AsyncIterable<Buffer>` and `decompress(buffer: Buffer): Promise<Buffer>`. Property: `algorithm: string`. | ~20 | ~1h |
| 2. GzipAdapter | Wrap existing `createGzip()` / `gunzipAsync()` logic into adapter. Remove inline gzip from CasService. | ~30 | ~1h |
| 3. ZstdAdapter | Use `@napi-rs/zstd` (native binding, 0-dep) or `fzstd` (pure JS fallback). Streaming compress via transform. | ~40 | ~2h |
| 4. CasService refactor | Replace inline compression with `this.compression.compress(source)` and `this.compression.decompress(buffer)`. Facade accepts `compression: { algorithm: 'gzip' \| 'zstd' }` and selects adapter. | ~30 | ~2h |
| 5. Tests + benchmarks | Round-trip with each algorithm. Benchmark: 10 MB file, gzip vs zstd compress speed and ratio. | ~60 | ~2h |
| **Total** | | **~180** | **~8h** |

**Backward Compatibility**: Old manifests with `compression.algorithm: 'gzip'` still work — the facade selects the gzip adapter. New manifests can specify `'zstd'`. Restoring always reads the algorithm from the manifest, so mixed-algorithm vaults work seamlessly.

---

## Vision 5: Watch Mode — Continuous Sync

**The Pitch**

`git cas watch ./data --slug live-data --interval 5s` monitors a file or directory for changes and incrementally re-stores modified content. Combined with CDC (M10), only changed chunks get written. The vault entry updates atomically on each sync cycle.

**Use Cases**

- **Development hot-reload**: Watch a model weights file during training; each checkpoint auto-stored with a versioned slug (`live-data@1`, `live-data@2`, ...).
- **Config sync**: Watch a config directory; changes automatically vaulted.
- **Continuous backup**: Low-overhead continuous protection for critical files.

**Mini Battle Plan**

| Phase | Work | ~LoC | ~Hours |
|-------|------|------|--------|
| 1. File watcher | Use `fs.watch()` (Node) / `Bun.file().watch()` with debounce (default 1s). Detect create/modify/delete. | ~50 | ~2h |
| 2. Incremental store | On change: re-store the file, diff manifests (Vision 3), skip if unchanged (identical digest). Update vault entry with `--force`. | ~60 | ~3h |
| 3. CLI command | `git cas watch <path> --slug <slug> [--interval <duration>] [--key-file <path>]`. Ctrl-C to stop. | ~30 | ~1h |
| 4. Progress | Live status line showing: last sync time, files watched, total syncs, bytes stored. | ~20 | ~1h |
| 5. Tests | Mock fs.watch, verify debounce, verify vault updates, verify no-op on unchanged files. | ~60 | ~3h |
| **Total** | | **~220** | **~10h** |

**Synergy with CDC (M10)**: Without CDC, every modification re-stores every chunk downstream of the edit point. With CDC, only 1-2 chunks change per modification. Watch mode + CDC together give efficient continuous incremental storage.

---

## Vision 6: Interactive Passphrase Prompt

**The Pitch**

Replace `--vault-passphrase "my secret"` (visible in shell history, `ps` output, and CI logs) with an interactive TTY prompt that reads the passphrase from stdin with echo disabled. Like `gpg`, `ssh-keygen`, and `sudo`.

```shell
$ git cas store ./secrets.tar.gz --slug prod-secrets --vault-passphrase
Enter vault passphrase: ••••••••••
Confirm passphrase: ••••••••••
```

Falls back to `GIT_CAS_PASSPHRASE` env var for non-interactive contexts (CI). The flag `--vault-passphrase` without a value triggers the prompt; with a value, uses it directly (backward compatible).

**Mini Battle Plan**

| Phase | Work | ~LoC | ~Hours |
|-------|------|------|--------|
| 1. TTY reader | `readPassphrase(prompt: string): Promise<string>` — opens `/dev/tty` (Unix) or `CON` (Windows), sets raw mode, reads until Enter, echoes `•` per character. | ~40 | ~2h |
| 2. CLI integration | When `--vault-passphrase` is passed without a value and stdin is a TTY, call `readPassphrase()`. On store (first use), prompt twice for confirmation. | ~20 | ~1h |
| 3. Tests | Mock TTY input, verify echo suppression, verify confirmation match/mismatch, verify env var fallback. | ~30 | ~1h |
| **Total** | | **~90** | **~4h** |

**This directly mitigates Concern 5 (shell history exposure) below.**

---

# Concerns & Mitigations

Architectural and security concerns identified during code review, with proposed mitigations and defensive tests for each.

---

## Concern 1: Memory Amplification on Encrypted/Compressed Restore

**The Problem**

`_restoreBuffered()` concatenates ALL chunk blobs into a single buffer, decrypts, then decompresses. Despite `restoreStream()` exposing an `AsyncIterable` API (implying streaming), encrypted or compressed files buffer the entire plaintext in memory. A 10 GB encrypted file attempts a 10 GB allocation — and then potentially a second 10 GB buffer for decompression.

The JSDoc note added in the M14 review documents this, but there's no runtime guard. A user calling `restoreStream()` expecting constant memory will OOM silently on large encrypted files.

**Root Cause**: AES-256-GCM requires the entire ciphertext for authentication tag verification before any plaintext is released. You can't verify-then-stream with GCM — it's authenticate-everything-or-nothing. This is a fundamental limitation of the cipher mode, not a bug.

**Mitigation Strategy**

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| M1 | **Memory guard**: Add `maxRestoreBufferSize` option (default 512 MB). `_restoreBuffered()` checks `manifest.size` against limit before allocating. Throws `CasError('RESTORE_TOO_LARGE')` with actionable message suggesting chunked storage without encryption, or increasing the limit. | ~20 LoC | Prevents surprise OOM |
| M2 | **Per-chunk encryption** (long-term): Encrypt each chunk independently with a derived per-chunk nonce (`baseNonce + chunkIndex`). Each chunk gets its own GCM tag. Restore can verify and decrypt per-chunk in O(chunkSize) memory. **Breaking change** — new manifest encryption format. | ~200 LoC | True streaming encrypted restore |
| M3 | **Documentation**: Add a "Memory Model" section to README explaining which code paths buffer and which stream. | ~0 LoC | Sets expectations |

**Recommended**: M1 (immediate safety net) + M3 (documentation). M2 is a future milestone — it changes the encryption format and requires careful security analysis (per-chunk nonces must not collide, chunk reordering attacks need mitigation via a MAC over the chunk sequence).

**Defensive Tests**

```js
describe('Concern 1: Memory guard on encrypted restore', () => {
  it('throws RESTORE_TOO_LARGE when manifest.size exceeds maxRestoreBufferSize', ...);
  it('succeeds when manifest.size is within maxRestoreBufferSize', ...);
  it('does not apply guard to unencrypted uncompressed restoreStream', ...);
  it('includes actionable hint in RESTORE_TOO_LARGE error message', ...);
});
```

**New Error Code**: `RESTORE_TOO_LARGE` — "File too large for buffered restore. The encrypted/compressed restore path buffers the entire file in memory. Set `maxRestoreBufferSize` to increase the limit, or store without encryption for streaming restore."

---

## Concern 2: Orphaned Blob Accumulation After STREAM_ERROR

**The Problem**

When `_chunkAndStore()` throws `STREAM_ERROR`, chunks already written to Git via `persistence.writeBlob()` are orphaned — they exist in the Git ODB but no tree or ref references them. `git gc` will eventually reclaim them (default grace period: 2 weeks), but:

1. No tracking of which blobs were orphaned — there's no cleanup manifest or error log.
2. In high-failure environments (unreliable sources, network streams), orphaned blobs accumulate silently.
3. `git count-objects` shows growing "loose objects" with no explanation.

The `await Promise.allSettled(pending)` fix from C1 ensures in-flight writes complete (no floating promises), but their results are discarded — successful writes still create orphaned blobs.

**Mitigation Strategy**

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| M1 | **Report orphaned blobs in error metadata**: After `Promise.allSettled(pending)`, collect the blob OIDs from fulfilled results and include them in the `STREAM_ERROR` meta: `{ chunksDispatched, orphanedBlobs: ['abc...', 'def...'], originalError }`. Callers can log or clean up. | ~15 LoC | Visibility |
| M2 | **Observability metric**: Emit `observability.metric('error', { action: 'orphaned_blobs', count: N, blobs: [...] })` so monitoring systems can track accumulation. | ~5 LoC | Monitoring |
| M3 | **CLI warning**: When `git cas store` fails with STREAM_ERROR, print: `"Warning: N chunk blobs were written before the error. They will be reclaimed by 'git gc'."` | ~5 LoC | User awareness |

**Recommended**: M1 + M2 (cheap, high-value visibility). M3 for CLI polish.

**Defensive Tests**

```js
describe('Concern 2: Orphaned blob tracking on STREAM_ERROR', () => {
  it('includes orphanedBlobs array in STREAM_ERROR meta', ...);
  it('orphanedBlobs contains blob OIDs from successful writes before failure', ...);
  it('orphanedBlobs is empty when stream fails before any writes', ...);
  it('emits orphaned_blobs metric via observability', ...);
});
```

---

## Concern 3: No Upper Bound on Chunk Size

**The Problem**

`CasService` enforces a minimum chunk size (`chunkSize < 1024` throws), but there's no maximum. A user can configure `chunkSize: 4 * 1024 * 1024 * 1024` (4 GB) — and `git hash-object -w` will attempt to read the entire 4 GB chunk into memory as a single buffer. The `_storeChunk()` method passes the chunk buffer to `persistence.writeBlob()`, which shells out to `git hash-object` via stdin — but the buffer itself is already in Node.js memory.

Additionally, Git repositories have practical performance limits on individual blob sizes. While there's no hard cap, blobs >100 MB cause significant performance degradation in pack files, and >1 GB blobs can cause `git push` failures on many hosting platforms (GitHub's limit is 100 MB per blob via the API).

**Mitigation Strategy**

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| M1 | **Enforce maximum chunk size**: Add `if (chunkSize > 100 * 1024 * 1024) throw new Error('Chunk size must not exceed 100 MiB')` in the constructor. 100 MiB is generous (default is 256 KiB) while staying within Git hosting limits. | ~3 LoC | Prevents footgun |
| M2 | **Warn above 10 MiB**: Emit `observability.log('warn', 'Large chunk size may impact Git performance', { chunkSize })` when chunkSize > 10 MiB. | ~3 LoC | Soft guidance |

**Recommended**: M1 (hard cap) + M2 (soft warning). The maximum can be made configurable via an `allowLargeChunks: true` escape hatch for advanced users.

**Defensive Tests**

```js
describe('Concern 3: Chunk size upper bound', () => {
  it('throws when chunkSize exceeds 100 MiB', ...);
  it('accepts chunkSize of exactly 100 MiB', ...);
  it('accepts default chunkSize (256 KiB)', ...);
  it('accepts minimum chunkSize (1024 bytes)', ...);
  it('logs warning when chunkSize exceeds 10 MiB', ...);
});
```

---

## Concern 4: Web Crypto Adapter Silent Memory Buffering

**The Problem**

`WebCryptoAdapter.createEncryptionStream()` returns an `encrypt()` async generator that appears to stream, but internally accumulates all chunks into a single buffer before calling `crypto.subtle.encrypt()` (which is one-shot for GCM). The Deno runtime uses this adapter. A user on Deno calling `store()` with a 5 GB source will OOM without any indication that streaming is not actually happening.

The NodeCryptoAdapter and BunCryptoAdapter use `node:crypto` Cipher streams which truly stream — so this is a Deno-specific behavioral difference with no warning.

**Mitigation Strategy**

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| M1 | **Size tracking in encrypt generator**: Track accumulated bytes in `encrypt()`. When total exceeds a configurable limit (default 512 MB), throw `CasError('ENCRYPTION_BUFFER_EXCEEDED')` with message: `"Web Crypto API requires buffering the entire file for GCM encryption. File exceeds buffer limit. Use Node.js or Bun for large encrypted files, or store without encryption."` | ~15 LoC | Prevents silent OOM |
| M2 | **Runtime capability flag**: Add `CryptoPort.capabilities` property: `{ streamingEncryption: boolean }`. WebCryptoAdapter returns `false`. CasService can check this and warn or error when storing large encrypted files on non-streaming runtimes. | ~20 LoC | Architectural awareness |
| M3 | **Adapter-level documentation**: JSDoc on WebCryptoAdapter noting the buffering limitation. | ~5 LoC | Developer awareness |

**Recommended**: M1 (safety net) + M3 (documentation). M2 is a clean long-term solution.

**Defensive Tests**

```js
describe('Concern 4: Web Crypto buffering guard', () => {
  it('throws ENCRYPTION_BUFFER_EXCEEDED when accumulated bytes exceed limit', ...);
  it('succeeds for files within buffer limit', ...);
  it('NodeCryptoAdapter does NOT throw for large files (true streaming)', ...);
  it('WebCryptoAdapter.capabilities.streamingEncryption is false', ...);
});
```

**New Error Code**: `ENCRYPTION_BUFFER_EXCEEDED` — "File exceeds encryption buffer limit on this runtime. Web Crypto API (Deno) buffers the entire file for AES-GCM. Use Node.js or Bun for large encrypted files."

---

## Concern 5: Passphrase Exposure in Shell History and Process Listings

**The Problem**

The `--vault-passphrase <value>` CLI flag puts the passphrase in:
1. **Shell history**: `~/.bash_history`, `~/.zsh_history` — survives terminal close, searchable.
2. **Process listing**: `ps aux` shows full command line including the passphrase to all users on the system.
3. **CI logs**: If used in a CI pipeline without masking, the passphrase appears in build logs.

The `GIT_CAS_PASSPHRASE` env var is better (not in shell history) but still visible in `/proc/<pid>/environ` on Linux and in process listings on some systems.

**Mitigation Strategy**

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| M1 | **Interactive prompt**: See Vision 6 above. `--vault-passphrase` without a value triggers TTY prompt with echo disabled. Confirmation on first use. | ~90 LoC | Eliminates history exposure |
| M2 | **File-based passphrase**: `--vault-passphrase-file <path>` reads the passphrase from a file (like `docker secret`, `kubectl --token-file`). File can be tmpfs-backed, permissions-restricted, or injected by a secrets manager. | ~15 LoC | CI-friendly, no process exposure |
| M3 | **Stdin passphrase**: `echo "secret" \| git cas store --vault-passphrase -` reads from stdin. Useful in pipes. | ~10 LoC | Scriptable |
| M4 | **Documentation warning**: Add security note in README and `--help` output: "Avoid passing passphrases on the command line. Use `GIT_CAS_PASSPHRASE` env var, `--vault-passphrase-file`, or omit the value for interactive prompt." | ~0 LoC | Awareness |

**Recommended**: M1 + M2 + M4. Interactive prompt for humans, file-based for CI, documentation for everyone.

**Defensive Tests**

```js
describe('Concern 5: Passphrase input security', () => {
  it('reads passphrase from file when --vault-passphrase-file is used', ...);
  it('prompts interactively when --vault-passphrase is passed without value in TTY', ...);
  it('falls back to GIT_CAS_PASSPHRASE env var in non-TTY', ...);
  it('errors when no passphrase source is available in non-TTY mode', ...);
  it('confirmation prompt rejects mismatched passphrases', ...);
});
```

---

## Concern 6: No KDF Brute-Force Rate Limiting

**The Problem**

`deriveKey()` and the restore path's `_resolveKeyFromPassphrase()` have no rate limiting, attempt counting, or lockout mechanism. An attacker with access to the API or CLI can brute-force passphrases at full CPU speed:

- PBKDF2 (100k iterations, SHA-512): ~100-500 attempts/sec on modern hardware.
- scrypt (N=16384, r=8, p=1): ~10-50 attempts/sec.

For a strong passphrase (>80 bits of entropy), this is fine — but many users choose weak passphrases. There's no warning, no audit trail, and no way to detect an ongoing brute-force attack.

**Mitigation Strategy**

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| M1 | **Observability metric on failed decryption**: Emit `observability.metric('error', { action: 'decryption_failed', slug, attempt })` on every `INTEGRITY_ERROR` during restore. Monitoring systems can alert on anomalous failure rates. | ~5 LoC | Detection |
| M2 | **CLI rate limit**: In the CLI layer (not the library), add a 1-second delay after each failed passphrase attempt. Prevents rapid brute-force via the terminal without affecting the programmatic API. | ~5 LoC | CLI hardening |
| M3 | **Stronger KDF defaults**: Increase PBKDF2 default iterations from 100k to 600k (OWASP 2023 recommendation for SHA-512). Increase scrypt default cost from 16384 to 65536. Document the change as a security improvement. **Note**: this affects store/restore performance — KDF runs once per operation, so the latency increase (100ms → 600ms for PBKDF2) is acceptable for interactive use but may impact batch workflows. | ~5 LoC | Resistance |
| M4 | **Documentation**: Add KDF parameter guidance to SECURITY.md — recommended iterations/cost for different threat models (personal use, team, high-security). | ~0 LoC | Guidance |

**Recommended**: M1 (detection) + M2 (CLI hardening) + M4 (guidance). M3 is a judgment call — the performance tradeoff is worth discussing.

**Defensive Tests**

```js
describe('Concern 6: KDF brute-force awareness', () => {
  it('emits decryption_failed metric on wrong passphrase', ...);
  it('emits metric with slug context for audit trail', ...);
  it('CLI applies delay after failed passphrase attempt', ...);
  it('library API does NOT rate-limit (callers manage their own policy)', ...);
});
```

---

## Concern 7: GCM Nonce Collision Risk at Scale

**The Problem**

AES-256-GCM uses a 96-bit (12-byte) nonce, generated randomly per `encryptBuffer()` / `createEncryptionStream()` call. The birthday bound for 96-bit nonces is ~2^48 — after ~281 trillion encryptions with the same key, nonce collision probability exceeds 50%. In practice, NIST recommends limiting to 2^32 (~4.3 billion) invocations per key for a negligible collision probability.

For a single user storing files with one key, this is not a practical concern — you'd need to store 4 billion files. But:
1. There's no explicit tracking or warning of nonce count per key.
2. The nonce is pure random, not a counter — so there's no guarantee of uniqueness even at low counts (just overwhelming probability).
3. A nonce collision with GCM is catastrophic — it reveals the XOR of two plaintexts and allows auth tag forgery.

**Mitigation Strategy**

| # | Mitigation | Effort | Impact |
|---|-----------|--------|--------|
| M1 | **Document the bound**: Add to SECURITY.md: "AES-256-GCM with random nonces is safe for up to 2^32 encryptions per key. For higher volumes, rotate keys (M12) or use a counter-based nonce scheme." | ~0 LoC | Awareness |
| M2 | **Nonce counter option** (long-term): Add optional `nonceStrategy: 'random' \| 'counter'` to encryption options. Counter-based nonces guarantee uniqueness but require persistent state (a counter stored in the vault metadata). Random remains the default for simplicity. | ~60 LoC | Eliminates collision risk |
| M3 | **Key usage counter in vault**: Track `encryptionCount` in vault metadata. When it exceeds 2^31, emit a warning via observability: "Key has been used for N encryptions. Consider rotating." | ~20 LoC | Proactive warning |

**Recommended**: M1 (immediate, zero-cost) + M3 (proactive warning). M2 is a significant design change that adds state management complexity — only needed for extremely high-volume use cases.

**Defensive Tests**

```js
describe('Concern 7: Nonce uniqueness', () => {
  it('generates unique nonces across 1000 consecutive encryptions', ...);
  it('nonce is exactly 12 bytes (96 bits)', ...);
  it('different encryptions of same plaintext with same key produce different ciphertexts', ...);
  it('vault tracks encryptionCount and increments per store', ...);
  it('warns via observability when encryptionCount exceeds threshold', ...);
});
```

---

## Summary Table

| # | Type | Severity | Fix Cost | Recommended Action |
|---|------|----------|----------|-------------------|
| C1 | Memory amplification | High | ~20 LoC | Add `maxRestoreBufferSize` guard |
| C2 | Orphaned blobs | Medium | ~20 LoC | Report orphaned blob OIDs in error meta |
| C3 | No chunk size cap | Medium | ~6 LoC | Enforce 100 MiB maximum |
| C4 | Web Crypto buffering | Medium | ~15 LoC | Add buffer size guard in WebCryptoAdapter |
| C5 | Passphrase exposure | High | ~90 LoC | Interactive prompt + file-based input |
| C6 | KDF no rate limit | Low | ~10 LoC | Observability metric + CLI delay |
| C7 | GCM nonce collision | Low | ~20 LoC | Document bound + vault usage counter |

| # | Type | Theme | Est. Cost |
|---|------|-------|-----------|
| V1 | Feature | Snapshot trees (directory store) | ~410 LoC, ~19h |
| V2 | Feature | Portable bundles (air-gap transfer) | ~340 LoC, ~15h |
| V3 | Feature | Manifest diff engine | ~180 LoC, ~8h |
| V4 | Feature | CompressionPort + zstd/brotli/lz4 | ~180 LoC, ~8h |
| V5 | Feature | Watch mode (continuous sync) | ~220 LoC, ~10h |
| V6 | Feature | Interactive passphrase prompt | ~90 LoC, ~4h |
