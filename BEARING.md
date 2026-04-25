# BEARING

Current direction and active tensions. Historical ship data is in `CHANGELOG.md`.

```mermaid
timeline
    Phase 1 : Core CAS Engine : Git Substrate : SHA-256 Manifests
    Phase 2 : Vault Infrastructure : CDC Deduplication : Encryption
    Phase 3 : Multi-Runtime (Node/Bun/Deno) : Agent CLI : TUI Cockpit
    Phase 4 : Streaming Encrypted Restore : Service Decomposition : Platform-Agnostic CLI
    Phase 5 : Security Hardening : AAD-Bound Encryption : Architecture Completion
    Phase 6 : Scheme Simplification : Convergent Encryption : Streaming Parity
```

## Current State

The encryption surface has been simplified and the dedup-with-encryption gap is
closed. The 20-card backlog from Phase 5 remains clear; recent work focused on
collapsing scheme complexity and shipping convergent encryption.

What exists now:

- **Three encryption schemes.** `whole`, `framed`, `convergent` — no version
  suffixes. Legacy `whole-v1`, `whole-v2`, `framed-v1`, `framed-v2`, and
  `convergent-v1` scheme strings explode at `readManifest()` time with a
  `LEGACY_SCHEME` error pointing to the migration script. Scheme truth is
  centralized in `src/domain/encryption/schemes.js`.
- **AAD always on.** `whole` and `framed` encryption always bind slug-based AAD
  into the GCM tag. The v1 no-AAD path is removed entirely. Legacy manifests
  cannot be read without migration.
- **Convergent encryption.** Per-chunk deterministic encryption that preserves
  CDC deduplication across encrypted stores. Each chunk's key and nonce are
  derived from its plaintext content hash via HMAC-SHA256, so identical
  plaintext chunks produce identical ciphertext blobs that Git deduplicates at
  the object level. Default when CDC chunking and encryption are both active.
  `ConvergentEncryption` is extracted as its own service.
- **`formatVersion` in manifests.** New manifests carry a `formatVersion` field
  with the package semver at store time. Optional on read for backward
  compatibility.
- **Manifest diffing.** Shipped for comparing manifest state across versions.
- **Parallel chunk restore.** `PrefetchWindow` enables parallel chunk fetch
  during restore, improving throughput for large chunked assets.
- **Plaintext + gzip streaming.** Compressed unencrypted data now uses
  `_restoreCompressedStreaming` instead of the buffered path, eliminating the
  `maxRestoreBufferSize` constraint for this case.
- **Fully hexagonal architecture.** All platform dependencies (`node:zlib`,
  `node:crypto`, `node:stream`) are extracted behind abstract ports
  (`CompressionPort`, `CryptoPort`, `ChunkingPort`). `CasService` has zero
  direct platform imports.
- **Hardened security posture.** Eleven audit-driven fixes plus KDF salt
  validation hardening, store write failure normalization, and unified vault
  mutation retry.
- **Vault privacy mode.** HMAC slug masking prevents metadata discovery for
  anyone with bare repo read access.
- **Manifest-level integrity hash.** Manifests carry a top-level integrity
  digest for fast tamper detection without chunk-by-chunk verification.
- **Migration script.** `scripts/migrate-encryption.js` upgrades legacy v1/v2
  manifests to the current scheme identifiers.

## Resolved Tensions

These were the active tensions from the previous bearing. All resolved.

- **Encryption vs. Dedupe** — resolved by convergent encryption. The `convergent`
  scheme derives per-chunk keys and nonces from plaintext content hashes, so
  identical chunks produce identical ciphertext that Git deduplicates at the
  object level. Operators no longer choose one or the other; CDC dedup works
  with encryption enabled. The threat model tradeoff (confirming known-plaintext
  attacks) is documented in THREAT_MODEL and GUIDE.
- **Runtime Parity** — Web Crypto whole-object restore is now bounded via
  `maxDecryptionBufferSize` on `WebCryptoAdapter`. The buffered path is still
  not mechanically identical to Node/Bun streaming, but the bound is enforced
  and documented.
- **Buffer Limits** — `whole restoreStream()` enforces actual buffered-read
  and decompression limits. `framed` provides true streaming restore for callers
  who need unbounded payloads.
- **Vault Contention** — all vault mutations (`initVault`, `addToVault`,
  `removeFromVault`) now share one unified CAS-conflict retry orchestration
  path.
- **KDF Compatibility Window** — KDF policy enforcement is now strict at both
  the schema layer and runtime stored-KDF path. Legacy metadata rides through a
  bounded compatibility window with explicit policy violations surfaced.
- **Decomposition Order** — the CasService decomposition trajectory is published
  in ARCHITECTURE.md. Platform dependency leaks are closed; extraction order is
  explicit.
- **Scheme Proliferation** — collapsed from five scheme identifiers to three.
  AAD is always on, version suffixes are gone, and legacy strings are rejected
  at the boundary with migration guidance. Scheme truth lives in one file
  (`schemes.js`).

## Open Tensions

- **CasService size.** At ~2100 lines, `CasService` is still the largest single
  module. The published decomposition order (store coordination, then manifest
  publication, then recipient flows, then restore pipeline) has not yet been
  executed. The service works, but it concentrates too many responsibilities.
- **No browser/edge runtime.** The architecture is now fully hexagonal and
  platform-agnostic at the port level, but no browser or edge adapter exists.
  `@git-stunts/plumbing` shells out to the `git` CLI, which is fundamentally
  unavailable in browsers and Workers. A browser path would require a pure-JS
  Git object layer or a remote persistence adapter.
- **No formal verification of crypto.** The encryption layer uses standard
  AES-256-GCM primitives through well-tested runtime APIs, but the framing
  protocol, AAD binding scheme, convergent derivation, and KDF policy have not
  been formally audited by a third party.
- **Framed encryption overhead.** Per-frame AES-GCM authentication adds 32
  bytes (4-byte length + 12-byte nonce + 16-byte tag) per frame. For small `frameBytes` values
  this overhead is non-trivial. There is no adaptive frame sizing.

## Next Horizon

With schemes simplified and convergent encryption shipped, these are candidate
directions — not commitments.

- **CasService decomposition.** Execute the published extraction order: pull
  store write coordination into `StoreCoordinator`, manifest/tree publication
  into `PublicationService`, recipient mutation into `RecipientService`, and
  restore pipeline into `RestoreService`. Each extraction should preserve the
  public facade contract.
- **Browser/edge persistence adapter.** A `FetchPersistenceAdapter` or
  `IsomorphicGitAdapter` could enable browser-side restore (read path) without
  the `git` CLI. Write path is harder — it needs ref updates and tree creation.
- **Formal crypto audit.** Engage a third-party security firm to review the
  framing protocol, AAD binding, convergent key derivation, KDF policy
  enforcement, and key derivation paths.
- **Performance optimization.** Profiling large-asset store/restore paths,
  particularly CDC chunking throughput, convergent encryption overhead, and
  PrefetchWindow tuning. The benchmarks baseline exists in `ADVANCED_GUIDE.md`.
- **Adaptive frame sizing.** Investigate dynamic `frameBytes` selection based on
  payload characteristics to reduce per-frame overhead for small assets while
  maintaining streaming properties for large ones.

---

Ship history: [`CHANGELOG.md`](./CHANGELOG.md)
