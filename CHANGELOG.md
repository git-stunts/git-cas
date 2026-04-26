# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.3.3] — Unreleased

### Added

- **Migration script (`npm run upgrade`)** — fully implemented `scripts/migrate-encryption.js` for v6.0.0 encryption scheme upgrades. Two modes: **fast** (rename-only for v2 schemes and `convergent-v1`) and **full** (re-encryption for v1 whole/framed schemes that lacked AAD). Supports `--execute` (default dry-run), `--passphrase`, and `--cwd`. Reads every vault entry, classifies it, and reports what will/did change.
- **`CasService.readManifestRaw()`** — reads a manifest from a Git tree OID and returns the raw decoded object without Manifest construction or scheme assertion. Migration entry point for inspecting legacy manifests.
- **`CasService` `legacyMode` constructor option** — when `true`, `readManifest()` maps legacy scheme identifiers (v1/v2) to their current names instead of throwing `LEGACY_SCHEME`. Legacy v1 manifests (no AAD) are correctly decrypted without AAD during restore.
- **`mapToCurrentScheme()` and `isLegacyNoAad()` in `schemes.js`** — public helpers for mapping legacy scheme strings to current names and detecting v1 no-AAD schemes.

### Changed

- **BREAKING: Encryption scheme identifiers simplified** — `whole-v1`/`whole-v2` collapsed to `whole`, `framed-v1`/`framed-v2` collapsed to `framed`, `convergent-v1` collapsed to `convergent`. Legacy v1/v2 scheme strings in stored manifests now throw `LEGACY_SCHEME` at `readManifest()` time with migration guidance. The `scheme` field in `ManifestSchema` is now required for all encryption metadata (previously optional for backward-compatible schemeless whole manifests).
- **AAD is always on** — `whole` and `framed` encryption always bind slug-based AAD into the GCM tag. The v1 no-AAD path is removed.
- **Plaintext+compressed restore is now streaming** — compressed unencrypted data uses `_restoreCompressedStreaming` instead of the buffered path, eliminating the `maxRestoreBufferSize` constraint for this case.
- **`formatVersion` stamped into new manifests** — new manifests include a `formatVersion` field carrying the package semver at store time. The field is optional on read for backward compatibility with older manifests.
- **`CryptoPort._buildMeta` default scheme** — changed from `'whole-v1'` to `'whole'`.

### Added

- **Convergent encryption (`convergent`)** — new per-chunk encryption scheme that preserves CDC deduplication across encrypted stores. Each chunk is encrypted with a deterministic key and nonce derived from its plaintext content hash via HMAC-SHA256, so identical plaintext chunks always produce identical ciphertext blobs that Git deduplicates at the object level. The scheme is the default when CDC chunking and encryption are both active. Opt out with `encryption: { convergent: false }`. Force it on any chunker with `encryption: { scheme: 'convergent' }` or `encryption: { convergent: true }`. Manifests record `{ scheme: 'convergent', algorithm: 'aes-256-gcm', encrypted: true }` with no per-chunk nonce or tag fields — those are derived from the existing `digest` field at restore time. The 16-byte GCM auth tag is appended to each blob.
- **`CryptoPort.encryptBufferWithNonce(buffer, key, nonce)`** — new abstract method for AES-256-GCM encryption with a caller-provided nonce. Implemented in `NodeCryptoAdapter`, `BunCryptoAdapter`, and `WebCryptoAdapter`. Used by convergent encryption for deterministic ciphertext.
- **`CryptoPort.decryptBufferWithNonceTag(buffer, key, nonce, tag)`** — new abstract method for AES-256-GCM decryption with explicit nonce and tag. Implemented in all three crypto adapters.
- **Vault privacy mode** — opt-in HMAC slug masking for vault tree entries. When enabled via `initVault({ passphrase, privacy: true })`, tree entry names become `HMAC-SHA256(privacyKey, slug)` (64-char hex), preventing metadata discovery by anyone with repo read access. A privacy key is derived deterministically from the vault encryption key via `HMAC-SHA256(encryptionKey, "git-cas-privacy-v1")`. An encrypted `.privacy-index` blob stores the slug-to-HMAC mapping for listing/enumeration. Privacy mode requires vault encryption. All public vault methods (`addToVault`, `removeFromVault`, `listVault`, `resolveVaultEntry`) accept an optional `encryptionKey` parameter for privacy-enabled vaults.
- **`CryptoPort.hmacSha256(key, data)`** — new concrete method on `CryptoPort` using `node:crypto.createHmac`. Works across Node.js, Bun, and Deno. Returns a 32-byte HMAC-SHA256 digest.
- **AES-GCM AAD (Additional Authenticated Data) support** — `CryptoPort`, `NodeCryptoAdapter`, `BunCryptoAdapter`, and `WebCryptoAdapter` now accept an optional `aad` parameter on `encryptBuffer`, `decryptBuffer`, `createEncryptionStream`, and `createDecryptionStream`. When provided, AAD is bound into the GCM authentication tag, enabling callers to authenticate associated metadata (e.g. manifest identity) without encrypting it. Omitting `aad` preserves full backward compatibility. `_buildMeta` now accepts an optional `scheme` parameter instead of hardcoding `'whole-v1'`.
- **`whole-v2` and `framed-v2` encryption schemes** — new encryption schemes bind the manifest slug as AES-GCM AAD, so decryption fails if the slug is tampered after encryption. `whole-v2` binds `Buffer.from(slug, 'utf8')` as AAD for streaming whole-object encryption. `framed-v2` binds `slug + NUL + 4-byte BE frame index` per frame, preventing both slug tampering and frame reordering. `ManifestSchema` now accepts `whole-v2` and `framed-v2` as valid scheme literals.
- **Agent CLI OS-keychain passphrase sources** — `git cas agent` now accepts explicit OS-keychain passphrase lookup for vault-derived key flows, including `osKeychainTarget` / `osKeychainAccount` on store, restore, and vault init, plus distinct old/new keychain sources for vault rotation.
- **`framed-v1` authenticated encryption** — encrypted stores can now opt into `encryption: { scheme: 'framed-v1', frameBytes }`, which serializes independently authenticated AES-256-GCM records so `restoreStream()` and `restoreFile()` can emit verified plaintext incrementally instead of buffering the full ciphertext.
- **METHOD planning surface** — added [docs/method/process.md](./docs/method/process.md), [docs/method/release.md](./docs/method/release.md), METHOD backlog lanes, METHOD legends, retro and graveyard entrypoints, and the active cycle doc [docs/design/0020-method-adoption/adopt-method.md](./docs/design/0020-method-adoption/adopt-method.md) so fresh work now runs through one explicit method instead of the older legends/backlog workflow.
- **`git cas agent recipient ...`** — added machine-facing recipient inspection and mutation commands so Relay can list recipients and perform add/remove flows through structured protocol data instead of human CLI text.
- **`git cas agent rotate`** — added a machine-facing rotation flow so Relay can rotate recipient keys by slug or detached tree OID and expose the resulting tree and vault side effects explicitly.
- **`git cas agent vault rotate`** — added a machine-facing vault passphrase rotation flow so Relay can rotate encrypted vault state with explicit commit, KDF, and rotated/skipped-entry results.
- **`git cas agent vault init|remove`** — added machine-facing vault lifecycle commands so Relay can initialize encrypted or plaintext vaults and remove entries without scraping human CLI output.
- **Docs maintainer checklist** — added [docs/DOCS_CHECKLIST.md](./docs/DOCS_CHECKLIST.md) as the short pre-review pass for doc-heavy branches, covering boundary clarity, canonical-source links, index hygiene, and empty-state wording discipline.
- **Pre-PR doc cross-link audit** — added a lightweight routing audit to [docs/DOCS_CHECKLIST.md](./docs/DOCS_CHECKLIST.md), [WORKFLOW.md](./WORKFLOW.md), and [CONTRIBUTING.md](./CONTRIBUTING.md) so doc-heavy branches verify canonical adjacent links before review instead of discovering missing cross-links late in PR feedback.
- **Planning-index consistency review** — added an explicit planning-surface review to [docs/DOCS_CHECKLIST.md](./docs/DOCS_CHECKLIST.md) and [WORKFLOW.md](./WORKFLOW.md), defining when to verify backlog, design, archive, and legend alignment.
- **Benchmark baselines doc** — added [ADVANCED_GUIDE.md](./ADVANCED_GUIDE.md) with the first published chunking baseline, including fixed-size versus CDC throughput, dedupe reuse results, and refresh instructions.
- **Threat model doc** — added [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md) as the canonical statement of attacker models, trust boundaries, exposed metadata, and explicit non-goals.
- **Workflow model** — added [WORKFLOW.md](./WORKFLOW.md), explicit legends/backlog/invariants directories, and a cycle-first planning model for fresh work.
- **Review automation baseline** — added `.github/CODEOWNERS` with repo-wide ownership for `@git-stunts`.
- **Release runbook** — added `docs/RELEASE.md` and linked it from `CONTRIBUTING.md` as the canonical patch-release workflow.
- **`pnpm release:verify`** — new maintainer-facing release helper runs the full release checklist, captures observed test counts, and prints a Markdown summary that can be pasted into release notes or changelog prep.
- **`git cas vault stats`** — new vault summary command reports logical size, chunk references, dedupe ratio, encryption coverage, compression usage, and chunking strategy breakdowns.
- **`git cas doctor`** — new diagnostics command scans `refs/cas/vault`, validates every referenced manifest, and exits non-zero with structured issue output when it finds broken entries or a missing vault ref.
- **Deterministic property-based envelope coverage** — added a `fast-check`-backed property suite for envelope-encrypted store/restore round-trips and tamper rejection across empty, boundary-adjacent, and multi-chunk payload sizes.
- **`CompressionPort`** — new abstract port (`src/ports/CompressionPort.js`) for buffer and streaming compression/decompression. Follows the same abstract-port pattern as `ChunkingPort` and `CryptoPort`.
- **`NodeCompressionAdapter`** — new adapter (`src/infrastructure/adapters/NodeCompressionAdapter.js`) implementing `CompressionPort` via `node:zlib` gzip/gunzip. Both buffer and async-iterable streaming interfaces.

### Changed

- **CompressionPort extraction** — `CasService` no longer imports `node:zlib`, `node:stream`, or `node:util` directly. Compression is now delegated through a `CompressionPort` abstract port with a `NodeCompressionAdapter` default implementation. The `CasService` constructor accepts an optional `compressionAdapter` parameter for injecting alternative implementations. Public API unchanged; internal refactor only.
- **AES-GCM adapter enforcement** — Node, Bun, and Web Crypto decrypt paths now all reject malformed AES-256-GCM metadata at the adapter boundary, enforce the declared algorithm before decrypting, and reject short or malformed nonce/tag fields before any runtime-specific decrypt call runs.
- **Buffered restore adapter contract** — hard-limited buffered restore modes now require `readBlobStream()` on the persistence adapter instead of silently degrading to whole-blob `readBlob()` fallback behavior. Plaintext restore keeps the compatibility fallback.
- **KDF salt shape hardening** — stored KDF salt metadata now rejects malformed base64 at both the manifest schema layer and the runtime stored-KDF policy path, keeping vault metadata and passphrase-restore behavior aligned before derive work starts.
- **`framed-v2` default encrypted writes** — new encrypted stores now default to `framed-v2` (was `framed-v1`), gaining per-frame AAD binding by default. `encryption.frameBytes` implies framed mode even when `scheme` is omitted, and `whole-v1`/`framed-v1` are the explicit compatibility opt-outs for callers that need AAD-free encryption.
- **KDF policy hardening** — passphrase-bearing store, restore, vault init, and vault rotation now default to PBKDF2 `600000` or scrypt `N=131072`, reject out-of-policy KDF metadata with `KDF_POLICY_VIOLATION`, and keep a bounded compatibility window for older stored metadata instead of trusting arbitrary repository-controlled parameters.
- **Encrypted manifest schema hardening** — manifest parsing now only accepts legacy/explicit `whole-v1` and explicit `framed-v1` AES-256-GCM metadata, rejects `encrypted: false`, rejects malformed nonce/tag values and framed manifests without `frameBytes`, and applies the same validation through both JSON and CBOR `readManifest()` paths.
- **Web Crypto decrypt guard** — `WebCryptoAdapter` now accepts `maxDecryptionBufferSize` and rejects oversized whole-object decrypt buffers with `DECRYPTION_BUFFER_EXCEEDED`, making the Deno/browser-class `whole-v1` restore path bounded instead of silently unbounded.
- **Encrypted restore routing** — `whole-v1` remains the compatibility whole-object mode, while `framed-v1` now restores frame-by-frame and can stream through gunzip when combined with gzip compression. `verifyIntegrity()` now authenticates framed payloads by parsing and checking every record.
- **Bounded file restore for buffered modes** — `restoreFile()` no longer inherits the full-memory restore path for `whole-v1` and compression-buffered manifests. It now verifies chunks, writes tentative bytes to a temp file, and renames into place only after whole-object auth and optional gunzip succeed.
- **File restore plan seam** — `restoreFile()` now consumes `CasService.createFileRestorePlan()` instead of reconstructing bounded whole-object restore flows from underscore helper calls inside the file adapter.
- **Store write failure contract** — raw chunk-write failures during `store()` now normalize to `STORE_ERROR`, existing `CasError` write failures keep their original code, and both paths now carry `chunksDispatched`, `orphanedBlobs`, and `failedIndex` metadata.
- **Unified vault mutation retry** — `initVault()` now shares the same CAS-conflict retry orchestration path as `addToVault()` and `removeFromVault()`, so all core vault mutations run through one draft-based read-apply-write-retry helper.
- **CasService decomposition trajectory** — `ARCHITECTURE.md` now publishes the explicit extraction order for `CasService`: store write coordination first, manifest/tree publication second, recipient mutation flows third, and restore pipeline extraction only after platform-port work lands.
- **METHOD signposts and legacy planning compatibility** — [WORKFLOW.md](./WORKFLOW.md) and [docs/RELEASE.md](./docs/RELEASE.md) now act as signposts into `docs/method/`, active backlog cards now live in METHOD backlog lanes with non-numeric filenames, and [docs/BACKLOG/](./docs/BACKLOG/README.md) plus [docs/legends/](./docs/legends/README.md) now remain as legacy compatibility surfaces instead of active planning truth.
- **README rewritten** — the front page now focuses on current product truth, clear quick starts, operational caveats, and the canonical doc map instead of mixing release history, marketing copy, and reference detail.
- **Planning lifecycle clarified** — live backlog items now exclude delivered work, archive directories now hold retired backlog history and reserved retired design space, landed cycle docs use explicit landed status, and the design/backlog indexes now reflect current truth instead of stale activity.
- **Architecture map repaired** — [ARCHITECTURE.md](./ARCHITECTURE.md) now describes the shipped system instead of an older flat-manifest-only model, including Merkle manifests, the extracted `VaultService` and `KeyResolver`, current ports/adapters, and the real storage layout for trees and the vault.
- **Architecture navigation clarified** — [ARCHITECTURE.md](./ARCHITECTURE.md) now distinguishes the public package boundary from internal domain helpers and links directly to [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md) as adjacent truth.
- **Guide repaired** — the long-form guide now lives at [GUIDE.md](./GUIDE.md), links back to the canonical API/security docs, uses current `restore --oid` syntax, and no longer teaches stale EventEmitter-first or internal-import-heavy workflows for common use.
- **Markdown surface map added** — [docs/MARKDOWN_SURFACE.md](./docs/MARKDOWN_SURFACE.md) now records a per-file `KEEP` / `CUT` / `MERGE` / `MOVE` recommendation across the tracked Markdown surface, including which root docs still belong at the repo front door and which remaining artifacts are migration or local-only candidates.
- **Examples surface audited** — [examples/README.md](./examples/README.md) now records the recommendation for each maintained example, and the store/restore example now uses the public `readManifest()` helper instead of manual manifest decoding through service internals.
- **Security doc discoverability improved** — [README.md](./README.md), [CONTRIBUTING.md](./CONTRIBUTING.md), [WORKFLOW.md](./WORKFLOW.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [docs/API.md](./docs/API.md), and [docs/DOCS_CHECKLIST.md](./docs/DOCS_CHECKLIST.md) now link more directly to [SECURITY.md](./SECURITY.md) and [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md) so maintainers and agents can find the canonical security guidance from the docs they read first.
- **GitHub Actions runtime maintenance** — CI and release workflows now run on `actions/checkout@v6` and `actions/setup-node@v6`, clearing the Node 20 deprecation warnings from GitHub-hosted runners.
- **Ubuntu-based Docker test stages** — the local/CI Node, Bun, and Deno test images now build on `ubuntu:24.04`, copying runtime binaries from the official upstream images instead of inheriting Debian-based runtime images directly, and the final test commands now run as an unprivileged `gitstunts` user.
- **Test conventions expanded** — `test/CONVENTIONS.md` now documents Git tree filename ordering, Docker-only integration policy, pinned integration `fileParallelism: false`, and direct-argv subprocess helpers.

### Fixed

- **Hard buffered restore bounds** — buffered restore now enforces `maxRestoreBufferSize` against actual blob-read sizes and streamed gunzip output instead of only manifest-declared preflight estimates and post-materialization checks.
- **CLI credential edge cases** — `store --recipient` now ignores ambient `GIT_CAS_PASSPHRASE` state when no explicit vault passphrase flag/file was provided, store/restore/init now reject ambiguous explicit credential combinations consistently, `vault init --algorithm` no longer silently falls back to plaintext without a passphrase source, and `vault rotate` now rejects whitespace-only old/new passphrase inputs instead of treating them as valid credentials.
- **Bun blob writes in Git persistence** — `GitPersistenceAdapter.writeBlob()` now hashes temp files instead of piping large buffers through `git hash-object --stdin` under Bun, avoiding unhandled `EPIPE` failures during real Git-backed stores.
- **Release verification runner failures** — `runReleaseVerify()` now converts thrown step-runner errors into structured step failures with a `ReleaseVerifyError` summary instead of letting raw exceptions escape.
- **Machine-readable release verification** — `pnpm release:verify --json` now emits structured JSON on both success and failure paths, making CI automation and release-note tooling consume the same verification source of truth.
- **Dashboard launch context normalization** — `launchDashboard()` now treats injected Bijou contexts without an explicit `mode` as interactive, avoiding an incorrect static fallback, and the CLI mode tests now lock the `BIJOU_ACCESSIBLE` and `TERM=dumb` branches.

## [5.3.2] — 2026-03-15

### Changed

- **Vitest workspace split** — unit, integration, and benchmark suites now live in explicit workspace projects so the integration suite always runs with `fileParallelism: false`, regardless of the exact CLI invocation shape.
- **Status semantics** — `STATUS.md` now distinguishes the last released version (`v5.3.1`) from the current branch version (`v5.3.2`).

### Fixed

- **CLI version drift** — `bin/git-cas.js` now reads the package version instead of carrying a stale hardcoded literal, so `git-cas --version` tracks the in-repo release line correctly.

## [5.3.1] — 2026-03-15

### Fixed

- **Repeated chunk tree emission** — `createTree()` and `_createMerkleTree()` now emit one chunk blob tree entry per unique digest, preserving first-seen order at write time while leaving the manifest unchanged as the authoritative ordered index of chunk occurrences.
- **Invalid Git trees for repetitive content** — repetitive files no longer produce duplicate tree entry names, so emitted trees pass `git fsck --full` without `duplicateEntries` failures.
- **Regression coverage for tree reachability** — added unit tests for first-seen dedupe behavior and integration tests that store repetitive content, verify restore correctness, and assert clean `git fsck` results on a real Git repository.

## [5.3.0] — 2026-03-08

### Added

- **Vault rotate passphrase-file support** — `vault rotate` now accepts `--old-passphrase-file` and `--new-passphrase-file` flags, bringing it to parity with the store/restore passphrase-file support.
- **CLI store flags** — `--gzip`, `--strategy <fixed|cdc>`, `--chunk-size <n>`, `--concurrency <n>`, `--codec <json|cbor>`, `--merkle-threshold <n>`, `--target-chunk-size <n>`, `--min-chunk-size <n>`, `--max-chunk-size <n>`. All library-level chunking, compression, codec, and concurrency options are now accessible from the CLI.
- **CLI restore flags** — `--concurrency <n>`, `--max-restore-buffer <n>`. Parallel I/O and restore buffer limit now configurable from CLI.
- **`.casrc` config file** — JSON config file at the repository root provides default values for CLI flags. CLI flags always take precedence. Supports: `chunkSize`, `strategy`, `concurrency`, `codec`, `compression`, `merkleThreshold`, `maxRestoreBufferSize`, and `cdc.*` sub-keys.
- **CODE-EVAL.md** — Forensic architectural audit (zero-knowledge code extraction, critical assessment, roadmap reconciliation, prescriptive blueprint).
- **M16 Capstone** — New milestone in ROADMAP.md addressing all 9 audit flaws and 10 concerns (C1–C10). 13 task cards, ~698 LoC, ~21h estimated.
- **Concerns C8–C10** — Three architectural concerns from the CODE-EVAL.md audit now documented: crypto adapter LSP violation (C8), FixedChunker quadratic allocation (C9), encrypt-then-chunk dedup loss (C10).
- **CasError codes** — `RESTORE_TOO_LARGE` and `ENCRYPTION_BUFFER_EXCEEDED` registered in canonical error code table.
- **16.2 — Memory restore guard** — `CasService` accepts `maxRestoreBufferSize` (default 512 MiB). `_restoreBuffered` throws `RESTORE_TOO_LARGE` with `{ size, limit }` meta when encrypted/compressed restore would exceed the limit. Unencrypted streaming restore is unaffected.
- **16.3 — Web Crypto encryption buffer guard** — `WebCryptoAdapter` accepts `maxEncryptionBufferSize` (default 512 MiB). Throws `ENCRYPTION_BUFFER_EXCEEDED` when streaming encryption exceeds the limit, since Web Crypto AES-GCM is a one-shot API. NodeCryptoAdapter uses true streaming and is unaffected.
- **16.5 — Encrypt-then-chunk dedup warning** — `CasService.store()` now logs a warning when encryption is combined with CDC chunking, since ciphertext is pseudorandom and content-defined boundaries provide no dedup benefit.
- **16.10 — Orphaned blob tracking** — `STREAM_ERROR` now includes `meta.orphanedBlobs` — an array of OIDs for blobs successfully written before the stream failure. Error metric includes `orphanedBlobs` count for observability.
- **16.11 — Passphrase input security** — New `--vault-passphrase-file <path>` CLI option reads passphrase from file (use `-` for stdin). Interactive TTY prompt added as fallback when no other passphrase source is available. `resolvePassphrase` is now async with priority: file → flag → env → TTY → undefined. Empty passphrases rejected. File permission warning on group/world-readable files.
- **16.12 — KDF brute-force awareness** — `CasService` now emits `decryption_failed` metric with slug context when decryption fails with `INTEGRITY_ERROR` during encrypted restore. CLI adds a 1-second delay after `INTEGRITY_ERROR` to slow brute-force attempts. Library API imposes no delay — callers manage their own rate-limiting policy.
- **16.13 — GCM nonce collision docs + encryption counter** — `SECURITY.md` moved to project root with new sections: GCM nonce bound (2^32 NIST limit), key rotation frequency, KDF parameter guidance, and passphrase entropy recommendations. Vault metadata now tracks `encryptionCount`, incremented per encrypted `addToVault()`. Observability warning emitted when count exceeds 2^31. `VaultService` accepts optional `observability` port.
- **16.7 — Lifecycle method naming** — Added `inspectAsset()` (replaces `deleteAsset()`) and `collectReferencedChunks()` (replaces `findOrphanedChunks()`) as canonical names on both `CasService` and the facade. Old names are preserved as deprecated aliases that emit observability warnings. Type definitions updated with `@deprecated` JSDoc.

### Changed

- **`runAction` injectable delay** — `runAction()` now accepts an optional `{ delay }` dependency, replacing the hardcoded `setTimeout` call. Tests inject a spy instead of using `vi.useFakeTimers()`, making INTEGRITY_ERROR rate-limit tests deterministic across Node, Bun, and Deno.
- **Test conventions** — Added `test/CONVENTIONS.md` documenting rules for deterministic, cross-runtime tests: inject time dependencies, use `chmod()` instead of `writeFile({ mode })`, avoid global state patching.
- **VaultService test observability wiring** — `VaultService.test.js` now passes a `mockObservability()` port to all tests instead of relying on the silent no-op default. `rotateVaultPassphrase.test.js` now passes `SilentObserver` explicitly. If observability wiring breaks, the test suite will catch it.
- **`NodeCryptoAdapter.encryptBuffer` JSDoc** — `@returns` annotation corrected to `Promise<...>`, matching the async implementation.
- **`maxRestoreBufferSize` documented** — constructor JSDoc and `#config` type in `ContentAddressableStore` now include the parameter.
- **ROADMAP.md heading level** — added `## Task Cards` heading between `# M16` and `### 16.1` to satisfy MD001 heading-increment rule.
- **16.1 — Crypto adapter behavioral normalization** — `NodeCryptoAdapter.encryptBuffer` now returns a Promise (was sync), matching Bun/Web. `decryptBuffer` validates key on all adapters. `NodeCryptoAdapter.createEncryptionStream` guards `finalize()` with `STREAM_NOT_CONSUMED`. New conformance test suite asserts identical contracts across all adapters.
- **16.4 — FixedChunker pre-allocated buffer** — Replaced `Buffer.concat()` loop with a pre-allocated `Buffer.allocUnsafe(chunkSize)` working buffer, eliminating O(n²) copies for many small input buffers. Matches the allocation strategy used by `CdcChunker`.

### Fixed

- **Post-decompression size guard** — `_restoreBuffered` now enforces `maxRestoreBufferSize` after decompression, not just before. Compressed payloads that inflate beyond the configured limit now throw `RESTORE_TOO_LARGE` instead of silently allocating unbounded memory.
- **CLI passphrase prompt deferral** — `resolveEncryptionKey` now checks vault metadata before calling `resolvePassphrase`, avoiding unnecessary TTY prompts for unencrypted vaults. Store action recipient-conflict check inspects flags/env without consuming stdin.
- **CRLF passphrase normalization** — `readPassphraseFile` now strips trailing `\r\n` (Windows line endings) in addition to `\n`, preventing passphrase mismatches from Windows-edited files.
- **Constructor validation** — `CasService.maxRestoreBufferSize` (integer >= 1024), `CasService.chunkSize` (integer >= 1024), `WebCryptoAdapter.maxEncryptionBufferSize` (finite, positive), and `FixedChunker.chunkSize` (positive integer) are now validated at construction time, preventing silent misconfiguration.
- **Error-path test hardening** — `orphanedBlobs`, `restoreGuard`, `kdfBruteForce`, and `conformance` tests now fail explicitly when expected errors are not thrown (previously silent pass-through).
- **Orphaned blob enrichment on CasError re-throw** — `_chunkAndStore` now attaches `orphanedBlobs` metadata to existing `CasError` instances before re-throwing, instead of discarding the information.
- **VaultService metadata mutation on retry** — `addToVault` now shallow-copies `state.metadata` before mutation, preventing `encryptionCount` from being incremented multiple times across CAS retries.
- **16.8 — CasError portability guard** — `Error.captureStackTrace` now guarded with a runtime check. CasError constructs correctly on runtimes where `captureStackTrace` is unavailable (e.g. Firefox, older Deno).
- **16.9 — Pre-commit hook + hooks directory** — `scripts/git-hooks/` renamed to `scripts/hooks/` per CLAUDE.md convention. New `pre-commit` hook runs lint gate. `install-hooks.sh` updated accordingly.
- **16.6 — Chunk size upper bound** — CasService, FixedChunker, and CdcChunker now reject chunk sizes exceeding 100 MiB. CasService logs a warning when chunk size exceeds 10 MiB.
- **ROADMAP.md M16 summary** — Corrected LoC/hours from `~430/~28h` to `~698/~21h` to match the detailed task breakdown.
- **VaultService constructor type** — Added missing `observability?: ObservabilityPort` parameter to `index.d.ts` declaration.
- **Nullish coalescing for config merging** — `strategy` and `codec` in `mergeConfig()` now use `??` instead of `||`, so empty-string CLI values don't fall through to `.casrc` defaults.
- **Empty passphrase rejection** — `readPassphraseFile` rejects files that yield an empty string after newline stripping. `resolvePassphrase` validates `--vault-passphrase` flag and `GIT_CAS_PASSPHRASE` env var.
- **KDF algorithm validation** — `vault init` and `vault rotate` now validate `--algorithm` against the supported set (`pbkdf2`, `scrypt`) before passing to the KDF.
- **`.casrc` config validation** — `loadConfig()` now validates all config values (types, ranges, enum membership) after JSON parsing.
- **Deprecated method names in docs** — Updated `deleteAsset` → `inspectAsset` and `findOrphanedChunks` → `collectReferencedChunks` in README and GUIDE.
- **Missing error codes in SECURITY.md** — Added `RESTORE_TOO_LARGE` and `ENCRYPTION_BUFFER_EXCEEDED` sections.

## [5.2.4] — Prism polish (2026-03-03)

### Fixed

- **`CryptoPortBase.sha256()` type** — `index.d.ts` declaration corrected from `string | Promise<string>` to `Promise<string>`, matching the async implementation since v5.2.3.
- **`keyLength` passthrough** — `KeyResolver.#resolveKeyFromPassphrase` and `deriveKekFromKdf` now forward `kdf.keyLength` to `deriveKey()`, fixing a latent bug for vaults configured with non-default key lengths.
- **Deno test compatibility** — `createCryptoAdapter.test.js` no longer crashes on Deno by guarding immutable `globalThis.Deno` restoration with try/catch and skipping Node-only tests on non-Node runtimes.
- **README wording** — "no public API changes" corrected to "no breaking API changes" in the v5.2.3 summary.
- **Barrel re-export description** — README and CHANGELOG now show the correct `export { default as X } from '...'` syntax.
- **Vestigial `lastchat.txt`** removed from `jsr.json` exclude list.

### Changed

- **`keyResolver` is now private** — `CasService.keyResolver` changed to `#keyResolver`, preventing external access to an internal implementation detail.
- **`VaultPassphraseRotator.js` → `rotateVaultPassphrase.js`** — renamed to follow camelCase convention for files that export a function (PascalCase is reserved for classes).
- **`resolveChunker` validation** — `chunkSize` now validated as a finite positive number before constructing `FixedChunker`; invalid values fall through to CasService default.
- **`@fileoverview` JSDoc** added to `FileIOHelper.js`, `createCryptoAdapter.js`, and `resolveChunker.js`.
- **`KeyResolver` design note** — class JSDoc now documents the direct `CryptoPort.deriveKey()` call (bypasses `CasService.deriveKey()`).
- **Long function signature wrapped** — `rotateVaultPassphrase()` export signature broken across multiple lines.
- **Test hardening** — salt assertion in `KeyResolver.resolveForStore`, `keyLength` round-trip test, `resolveChunker` edge-case tests, guarded `rmSync` teardown in `FileIOHelper.test.js`.

## [5.2.3] — Prism refactor (2026-03-03)

### Changed

- **Async `sha256()` across all adapters** — `NodeCryptoAdapter.sha256()` now returns `Promise<string>` (was sync `string`), matching Bun and Web adapters. Fixes Liskov Substitution violation; all callers already `await`. `CryptoPort` JSDoc and `CasService.d.ts` updated to `Promise<string>`.
- **Extract `KeyResolver`** — ~170 lines of key resolution logic (`wrapDek`, `unwrapDek`, `resolveForDecryption`, `resolveForStore`, `resolveRecipients`, `resolveKeyForRecipients`, passphrase derivation, mutual-exclusion validation) extracted from `CasService` into `src/domain/services/KeyResolver.js`. CasService delegates via `this.keyResolver`. No public API changes. 24 new unit tests.
- **Move `createCryptoAdapter`** — runtime crypto detection moved from `index.js` to `src/infrastructure/adapters/createCryptoAdapter.js`; test helper now delegates instead of duplicating.
- **Factor out `resolveChunker`** — chunker factory resolution moved from `index.js` private method to `src/infrastructure/chunkers/resolveChunker.js`.
- **Move file I/O helpers** — `storeFile()` and `restoreFile()` moved from `index.js` to `src/infrastructure/adapters/FileIOHelper.js`; all `node:*` imports removed from facade.
- **Factor out `rotateVaultPassphrase`** — passphrase rotation orchestration (~100 lines with retry/backoff) moved from `index.js` to `src/domain/services/rotateVaultPassphrase.js`; `CasError` and `buildKdfMetadata` imports removed from facade.
- **Private `#config` field** — facade constructor stores options in a single private `#config` field instead of 10 public `this.fooConfig` properties.
- **Barrel re-exports** — 10 re-export-only modules (`NodeCryptoAdapter`, `Manifest`, `Chunk`, ports, observers, chunkers) converted to `export { default as X } from '...'` form, eliminating unnecessary local bindings.
- **Configurable retry** — `rotateVaultPassphrase()` now accepts optional `maxRetries` (default 3) and `retryBaseMs` (default 50) options for tuning optimistic-concurrency backoff.
- **Deterministic fuzz test** — envelope fuzz round-trip test now uses a seeded xorshift32 PRNG instead of `Math.random()`, making failures reproducible across runs.
- **DRY chunk verification** — extracted `_readAndVerifyChunk()` in `CasService`; both the buffered and streaming restore paths now delegate to the same single-chunk verification method.
- **DRY KDF metadata** — extracted `buildKdfMetadata()` helper (`src/domain/helpers/buildKdfMetadata.js`); `VaultService` and `ContentAddressableStore` both call it instead of duplicating the KDF object construction.

## [5.2.2] — JSDoc total coverage (2026-02-28)

### Added

- `tsconfig.checkjs.json` — strict `checkJs` configuration; `tsc --noEmit` passes with zero errors.
- `src/types/ambient.d.ts` — ambient type declarations for `@git-stunts/plumbing` and `bun` modules.
- `@types/node` dev dependency for typecheck support.
- JSDoc `@typedef` types: `EncryptionMeta`, `KdfParamSet`, `DeriveKeyParams` (CryptoPort); `VaultMetadata`, `VaultState`, `VaultEncryptionMeta` (VaultService).

### Changed

- Every exported and internal function, class method, and callback across all 32 source files now has complete JSDoc `@param`/`@returns` annotations.
- CryptoPort return types widened to `string | Promise<string>` (sha256), `Buffer | Uint8Array` (randomBytes), sync-or-async for encrypt/decrypt — accurately reflecting adapter implementations.
- Port `@param` names corrected to match underscore-prefixed abstract parameters (fixes TS8024).
- Observer adapter methods (`SilentObserver`, `EventEmitterObserver`, `StatsCollector`) fully typed.
- CLI files (`bin/`) comprehensively annotated with JSDoc types for all Commander callbacks and TUI render functions.

## [5.2.1] — Carousel polish (2026-02-28)

### Added

- CLI reference in `docs/API.md` for `git cas rotate` and `git cas vault rotate` flags.

### Changed

- Rotation helpers in `CasService` use native `#private` methods, matching the facade's style.
- `VAULT_CONFLICT` and `VAULT_METADATA_INVALID` error code docs now list `rotateVaultPassphrase()`.

### Fixed

- `rotateVaultPassphrase` now honours `kdfOptions.algorithm` instead of silently using the old algorithm.
- Rotation integration test no longer flaps under CI load (reduced test-only KDF iterations).

## [5.2.0] — Carousel (2026-02-28)

### Added

- **Key rotation without re-encrypting data** — `CasService.rotateKey()` re-wraps the DEK with a new KEK, leaving data blobs untouched. Enables key compromise response without re-storing assets.
- **`keyVersion` tracking** — manifest-level and per-recipient `keyVersion` counters track rotation history for audit compliance. Optional field, backward-compatible with existing manifests.
- **`git cas rotate` CLI command** — rotate a recipient's key via `--slug` (vault round-trip) or `--oid` (manifest-only). Supports `--label` for targeted single-recipient rotation.
- **`rotateVaultPassphrase()`** — rotate the vault-level encryption passphrase across all envelope-encrypted entries in a single atomic commit. Non-envelope entries are skipped with reporting.
- **`git cas vault rotate` CLI command** — rotate vault passphrase from the command line with `--old-passphrase` and `--new-passphrase`.
- **`ROTATION_NOT_SUPPORTED` error code** — thrown when `rotateKey()` is called on a manifest without envelope encryption (legacy/direct-key).
- 27 new unit tests covering key rotation, schema validation, and vault passphrase rotation.

## [5.1.0] — Locksmith (2026-02-28)

### Added

- **Envelope encryption (DEK/KEK)** — multi-recipient model where a random DEK encrypts content and per-recipient KEKs wrap the DEK. Recipients can be added/removed without re-encrypting data.
- **`RecipientSchema`** — Zod schema for validating recipient entries in manifests.
- **`recipients` field on `EncryptionSchema`** — optional array of `{ label, wrappedDek, nonce, tag }` entries.
- **`CasService.addRecipient()` / `removeRecipient()` / `listRecipients()`** — manage envelope recipients on existing manifests.
- **`--recipient <label:keyfile>` CLI flag** — repeatable flag on `git cas store` for envelope encryption.
- **`git cas recipient add/remove/list`** subcommands — CLI management of envelope recipients.
- **`RecipientEntry` type re-exported** from `index.d.ts`.
- 48 new unit tests covering envelope store/restore, recipient management, edge cases, and fuzz round-trips.

### Fixed

- **`_wrapDek` / `_unwrapDek` missing `await`** — these called async `encryptBuffer()` / `decryptBuffer()` without `await`, silently producing garbage on Bun/Deno runtimes where crypto is async.
- **`--recipient` + `--vault-passphrase` not guarded** — CLI now rejects combining `--recipient` with `--key-file` or `--vault-passphrase`.
- **Dead `_resolveEncryptionKey` method removed** — superseded by `_resolveDecryptionKey` but left behind.
- **Redundant `RECIPIENT_NOT_FOUND` guards** in `removeRecipient` collapsed into one.
- **`addRecipient` duplicated unwrap loop** replaced with `_resolveKeyForRecipients` reuse.
- **`removeRecipient` post-filter guard** — defense-in-depth check prevents zero recipients when duplicate labels exist in corrupted/crafted manifests.
- **`EncryptionSchema` empty recipients** — `recipients` array now enforces `min(1)` to reject undecryptable envelope manifests.
- **`parseRecipient` empty keyfile** — CLI now rejects `--recipient alice:` (missing keyfile path) with a clear error.
- **CLI 30s hang in Docker** — `process.exit()` with I/O flushing prevents `setTimeout` leak in containerized runtimes.
- **Deno Dockerfile** — multi-stage Node 22 copy replaces `apt install nodejs`, improving layer caching and image size.
- **Runtime-neutral Docker hint** in integration tests; `afterAll` guards `rmSync` against partial `beforeAll` failures.

## [5.0.0] — Hydra (2026-02-28)

### Breaking Changes

- **`CasService` constructor accepts `chunker` port** — a new optional `ChunkingPort` parameter controls chunking strategy. Existing code that does not pass `chunker` is unaffected (defaults to `FixedChunker`).
- **Major version bump** — new hexagonal port (`ChunkingPort`) and manifest schema extension warrant a semver-major release for downstream tooling awareness.

### Added

- **Content-defined chunking (CDC)** — Buzhash rolling-hash engine with configurable `minChunkSize` (64 KiB), `maxChunkSize` (1 MiB), and `targetChunkSize` (256 KiB). CDC limits the dedup blast radius to 1–2 chunks on incremental edits vs. total invalidation with fixed-size chunking. Benchmarked at 265 MB/s and 98.4% chunk reuse on small edits.
- **`ChunkingPort`** — new hexagonal port (`src/ports/ChunkingPort.js`) with `async *chunk(source)`, `strategy`, and `params`. Abstracts chunking behind a pluggable interface.
- **`FixedChunker`** — adapter wrapping existing fixed-size buffer slicing behind `ChunkingPort`.
- **`CdcChunker`** — adapter wrapping the buzhash CDC engine behind `ChunkingPort`.
- **`chunking` manifest field** — optional `{ strategy: 'fixed' | 'cdc', params: {...} }` metadata in manifests. Fixed-strategy manifests omit the field for full backward compatibility.
- **`ChunkingSchema`** — Zod discriminated union (`FixedChunkingSchema` + `CdcChunkingSchema`) for manifest validation.
- **`INVALID_CHUNKING_STRATEGY` error code** — thrown when an unrecognized chunking strategy is encountered in a manifest.
- **Facade `chunking` config** — `ContentAddressableStore` constructor accepts `chunking: { strategy, ... }` declarative config or a raw `chunker` port instance.
- **CDC benchmarks** (`test/benchmark/chunking.bench.js`) — throughput and dedup efficiency comparison.
- 90 new unit tests (709 total).

### Changed

- `CasService._chunkAndStore()` refactored to delegate to `ChunkingPort` instead of inline buffer slicing.
- `ChunkingPort`, `FixedChunker`, `CdcChunker` exported from the main entry point.

## [4.0.1] — M8 Spit Shine + M9 Cockpit (2026-02-28)

### Added

- **`git cas verify`** command — verify stored asset integrity from the CLI (checks blob hashes; no key needed).
- **`--json` global flag** — structured JSON output for all commands (`store`, `restore`, `verify`, `inspect`, `vault list/init/remove/info/history`).
- **`runAction` error handler** (`bin/actions.js`) — centralized `try`/`catch` with CasError code display and actionable hints for 5 common errors.
- **Vault list `--filter <pattern>`** — glob-based slug filtering with TTY-aware table formatting.
- **`CryptoPort` base class** — shared `_validateKey()`, `_buildMeta()`, and `deriveKey()` (template method pattern with `_doDeriveKey()`). Eliminates duplication across Node/Bun/Web adapters.
- **ADR-001** (`docs/ADR-001-vault-in-facade.md`) — architectural decision record for vault service composition.
- **STATUS.md** — project status dashboard with shipped versions, roadmap, dependency graph, and known concerns.
- **COMPLETED_TASKS.md** / **GRAVEYARD.md** — archived M1–M7 task cards and superseded tasks.
- `WebCryptoAdapter.finalize()` guard — throws `STREAM_NOT_CONSUMED` if called before encrypt stream is fully consumed.

### Fixed

- `verify` command uses `process.exitCode = 1` instead of `process.exit(1)` to allow stdout to drain on pipes.
- `runAction` uses `process.exitCode = 1` for consistent exit behavior across all commands.
- `vault info --json --encryption` now includes encryption metadata in JSON output.
- `store --force` without `--tree` now throws immediately instead of silently ignoring the flag.
- `inspect --json` now emits JSON even in TTY mode (previously fell through to rich view).
- `vault history --json` now emits structured JSON array of `{ commitOid, message }` objects.
- `NodeCryptoAdapter._validateKey` removed — inherits base class which accepts both `Buffer` and `Uint8Array`.
- `CasService.encrypt()` removed redundant `_validateKey` call.
- `matchGlob` rejects patterns > 200 chars (ReDoS guard); `?` no longer matches `/` path separator.
- `writeError` guards against non-Error throws.
- `_doDeriveKey` in `NodeCryptoAdapter` now properly `await`s promisified calls.

### Changed

- `CryptoPort` is now the single source of truth for key validation, metadata building, and KDF parameter normalization. All three adapters override only `_doDeriveKey()`.
- ROADMAP.md pruned: completed M1–M7 task cards moved to COMPLETED_TASKS.md.

## [4.0.0] — Conduit (2026-02-27)

### Breaking Changes

- **`CasService` no longer extends `EventEmitter`** — event subscriptions must use the new `ObservabilityPort` adapters instead of `service.on()`. The `EventEmitterObserver` adapter provides full backward compatibility for existing event-based code.
- **`observability` is a required constructor port** for `CasService`. The facade (`ContentAddressableStore`) defaults to `SilentObserver` when omitted.

### Added

- **ObservabilityPort** — new hexagonal port (`src/ports/ObservabilityPort.js`) with `metric(channel, data)`, `log(level, msg, meta?)`, and `span(name)` methods. Decouples the domain layer from Node's event infrastructure.
- **SilentObserver** — no-op adapter (default). Zero overhead when observability is not needed.
- **EventEmitterObserver** — bridges `metric()` calls to EventEmitter events (`chunk:stored`, `file:restored`, etc.) for backward-compatible progress tracking. Exposes `.on()`, `.removeListener()`, `.listenerCount()`.
- **StatsCollector** — accumulates metrics and exposes `summary()` with `chunksProcessed`, `bytesTotal`, `elapsed`, `throughput`, and `errors`.
- **`restoreStream()`** — new async generator on `CasService` and facade. Returns `AsyncIterable<Buffer>` for streaming restore with O(chunkSize) memory for unencrypted, uncompressed files. Encrypted/compressed files buffer internally but expose the same streaming API.
- **`restoreFile()` now uses streaming I/O** — writes via `createWriteStream` + `pipeline` instead of buffering the entire file with `writeFileSync`.
- **Parallel chunk I/O** — new `concurrency` option (default: 1). Store operations launch chunk writes through a counting semaphore. Streaming restore uses read-ahead for concurrent blob fetches. `concurrency: 1` produces identical sequential behavior.
- **Semaphore** — internal counting semaphore (`src/domain/services/Semaphore.js`) for concurrency control.
- 43 new unit tests (567 total).

### Changed

- CLI `store` and `restore` commands now create an `EventEmitterObserver` and pass it to the CAS instance, attaching progress tracking to the observer instead of the service.
- `restore()` reimplemented as a collector over `restoreStream()`.
- `_chunkAndStore()` refactored to use semaphore-gated parallel writes with `Promise.all`, sorting results by index after completion.
- Progress tracking example (`examples/progress-tracking.js`) updated to use `EventEmitterObserver` pattern.

## [3.1.0] — Bijou (2026-02-27)

### Added

- **Interactive vault dashboard** (`git cas vault dashboard`) — TEA-based TUI with split-pane layout, manifest detail view, keyboard navigation (`j`/`k`/`Enter`/`/`), and real-time filtering.
- **Manifest inspector** (`git cas inspect <tree-oid>`) — renders manifest details with chunk table, encryption info, and compression badges.
- **Progress bars** for `store` and `restore` operations — animated progress with throughput reporting, auto-disabled in non-TTY environments.
- **History timeline** (`git cas vault history --pretty`) — color-coded, paginated timeline view of vault commit history.
- **Encryption info card** (`git cas vault info --encryption`) — detailed KDF parameters and encryption configuration display.
- **Chunk heatmap** — chunk-size distribution grid with colored legend, displayed in manifest detail views.
- `--quiet` / `-q` flag to suppress all progress output.
- `GIT_CAS_PASSPHRASE` environment variable — alternative to `--vault-passphrase` flag for passphrase-based encryption.
- New runtime dependencies: `@flyingrobots/bijou`, `@flyingrobots/bijou-node`, `@flyingrobots/bijou-tui`.

### Fixed

- CLI `restore` now uses the canonical `readManifest` path instead of duplicating manifest resolution logic.
- Progress trackers wrapped in `try`/`finally` to prevent event listener leaks when `storeFile` or `restoreFile` throws.
- Dashboard filter and error lines clamped to pane width to prevent wrapping artifacts in narrow terminals.
- Dashboard differentiates entry vs manifest load errors — a single manifest preload failure no longer sets global error state.
- Dashboard clamps cursor position after applying filter on entry load.
- Passphrase resolution uses nullish coalescing for correct falsy-value handling.
- Locale-agnostic number formatting in encryption card tests.
- Consolidated duplicated restore flag validation into `validateRestoreFlags()`.
- Eliminated `vi.mock('node:fs')` pattern in progress tests for Bun Docker compatibility.

## [3.0.0] — Vault (2026-02-08)

### Added

- **Vault** — GC-safe ref-based storage via `refs/cas/vault`. A single Git ref pointing to a commit chain indexes all stored assets by slug. `git gc` can no longer silently discard stored data.
  - `initVault()` — initialize the vault, optionally with passphrase-based encryption (vault-level KDF policy).
  - `addToVault()` — add or update an entry by slug + tree OID, with `force` flag for overwrites.
  - `listVault()` — list all entries sorted by slug.
  - `removeFromVault()` — remove an entry by slug.
  - `resolveVaultEntry()` — resolve a slug to its tree OID.
  - `getVaultMetadata()` — inspect vault metadata (encryption config, version).
  - Vault metadata (`.vault.json`) supports versioning and optional encryption configuration.
  - CAS-safe writes with automatic retry (up to 3 attempts with exponential backoff) on concurrent update conflicts.
  - Strict slug validation: rejects empty strings, `..` traversal, control characters, oversized segments.
- New CLI subcommands: `vault init`, `vault list`, `vault info <slug>`, `vault remove <slug>`, `vault history`.
- CLI `store --tree` now auto-vaults the entry (adds to vault after creating tree).
- CLI `restore` now supports `--slug` (resolve via vault) and `--oid` (direct tree OID) flags.
- CLI `--vault-passphrase` flag for vault-level encryption on `store`, `restore`, and `vault init`.
- New error codes: `INVALID_SLUG`, `VAULT_ENTRY_NOT_FOUND`, `VAULT_ENTRY_EXISTS`, `VAULT_CONFLICT`, `VAULT_METADATA_INVALID`, `VAULT_ENCRYPTION_ALREADY_CONFIGURED`.
- TypeScript declarations for `VaultEntry`, `VaultMetadata`, `VaultState`, `VaultService`, `GitRefPort` types.
- `VaultService` — first-class domain service with proper port/adapter separation (hexagonal architecture).
- `GitRefPort` and `GitRefAdapter` — new port/adapter for Git ref and commit operations.
- `getVaultService()` on facade exposes the underlying `VaultService` for advanced usage.
- Vault-specific integration tests (`test/integration/vault.test.js`).
- 46 vault unit tests + facade delegation smoke test.

### Fixed

- `#validateMetadata` now requires `kdf.keyLength` in encryption metadata, preventing downstream KDF failures from manually edited `.vault.json` files.
- `#casUpdateRef` now preserves the original error in `VAULT_CONFLICT` meta for better diagnostics.
- CLI `--vault-passphrase` now emits a stderr warning when the vault is not encrypted, instead of silently ignoring the passphrase.
- `vault history` command now uses `VAULT_REF` constant instead of hardcoded string.
- API docs: fixed invalid import path `@git-stunts/cas/vault` → `@git-stunts/cas`.
- API docs: fixed `_readVaultState()` → `readState()` in error codes table.
- API docs and GUIDE: added `text` language identifier to fenced code blocks (markdownlint MD040).
- CLI version string updated from `2.0.0` to `3.0.0`.
- CLI `vault history --max-count` now validates input as a positive integer.
- Stale JSDoc in `GitPersistenceAdapter` corrected (removed mention of retries).
- CLI uses `program.parseAsync()` instead of `program.parse()` to prevent Bun from hanging on async action handlers.

### Changed

- **Vault promoted to domain layer** — all vault logic extracted from facade (`index.js`) into `VaultService` (`src/domain/services/VaultService.js`) with `GitRefPort`/`GitRefAdapter` for ref operations. Facade now delegates to VaultService.
- CLI `restore` command no longer takes a positional `<tree-oid>` argument. Use `--oid <tree-oid>` or `--slug <slug>` instead.
- Purged completed milestones (M1–M7) and their task cards from ROADMAP.md, reducing it from 3,153 to 1,675 lines.

## [2.0.0] — M7 Horizon (2026-02-08)

### Added

- **Compression support** (Task 7.1): Optional gzip compression pipeline via `compression: { algorithm: 'gzip' }` option on `store()`. Compression is applied before encryption when both are enabled. Manifests include a new optional `compression` field. Decompression on `restore()` is automatic.
- **KDF support** (Task 7.2): Passphrase-based encryption using PBKDF2 or scrypt via `deriveKey()` method and `passphrase` option on `store()`/`restore()`. KDF parameters are stored in `manifest.encryption.kdf` for deterministic re-derivation. All three crypto adapters (Node, Bun, Web) implement `deriveKey()`.
- **Merkle tree manifests** (Task 7.3): Large manifests (chunk count exceeding `merkleThreshold`, default 1000) are automatically split into sub-manifests stored as separate blobs. Root manifest uses `version: 2` with `subManifests` references. `readManifest()` transparently reconstitutes v2 manifests into flat chunk lists. Full backward compatibility with v1 manifests.
- New schema fields: `version`, `compression`, `subManifests` on `ManifestSchema`; `kdf` on `EncryptionSchema`.
- New error code: `INVALID_OPTIONS` for mutually exclusive options or unsupported option values.
- 62 new unit tests across three new test suites (compression, KDF, Merkle) plus expanded error tests.
- Updated API reference (`docs/API.md`), guide (`GUIDE.md`), and README with v2.0.0 feature documentation.

### Changed

- **BREAKING**: Manifest schema now includes `version` field (defaults to 1). Existing v1 manifests are fully backward-compatible.
- `CasService` constructor accepts new `merkleThreshold` option (must be a positive integer).
- `ContentAddressableStore` constructor now accepts and forwards `merkleThreshold` to `CasService`.
- `store()` and `storeFile()` accept `passphrase`, `kdfOptions`, and `compression` options.
- `restore()` accepts `passphrase` option.
- Static imports for `createGzip` and `Readable` in `CasService` (previously dynamic imports on every call).

### Fixed

- **Sub-manifest blobs are now included as tree entries** (`sub-manifest-N.json`), preventing them from being garbage-collected by `git gc`.
- `storeFile()` now forwards `passphrase`, `kdfOptions`, and `compression` options to `store()` (previously silently dropped).
- `store()` and `restore()` reject when both `passphrase` and `encryptionKey` are provided (`INVALID_OPTIONS`).
- `store()` rejects unsupported compression algorithms (`INVALID_OPTIONS`).
- `restore()` throws a descriptive error when passphrase is provided but manifest lacks KDF metadata.
- Decompression errors are now wrapped as `CasError` with code `INTEGRITY_ERROR` (previously raw zlib errors).
- `NodeCryptoAdapter.deriveKey()` uses `Buffer.from(salt)` for base64 encoding, preventing corrupt output when salt is a `Uint8Array`.
- `WebCryptoAdapter.deriveKey()` now validates KDF algorithm and throws for unsupported values instead of silently falling through to scrypt.
- `WebCryptoAdapter` scrypt derivation now throws a descriptive error when `node:crypto` is unavailable (e.g. in browsers).
- Orphaned JSDoc blocks for `restore()`, `verifyIntegrity()`, and `store()` reattached to their correct methods.
- Stale cross-reference in GUIDE.md ("Section 10" → "Section 13").
- API.md method signatures updated to include all v2 parameters.

## [1.6.2] — OIDC publishing + JSR docs coverage (2026-02-07)

### Added

- JSDoc comments on all exported TypeScript interfaces (`CryptoPort`, `CodecPort`, `GitPersistencePort`, `CasServiceOptions`, `EncryptionMeta`, `ManifestData`, `ContentAddressableStoreOptions`) to reach 100% JSR symbol documentation coverage.

### Fixed

- npm publish workflow now uses OIDC trusted publishing (no stored token). Upgrades npm to >=11.5.1 at publish time since pnpm does not yet support OIDC natively.

## [1.6.1] — JSR quality fixes (2026-02-07)

### Added

- TypeScript declaration files (`.d.ts`) for all three entrypoints and shared value objects, resolving JSR "slow types" scoring penalty.
- `@ts-self-types` directives in `index.js`, `CasService.js`, and `ManifestSchema.js`.
- `@fileoverview` module doc to `CasService.js` (required by JSR for module docs scoring).

### Fixed

- JSR package name corrected to `@git-stunts/git-cas`.
- JSR publication now excludes tests, docs, CI configs, and other non-distribution files via `jsr.json` exclude list.
- `index.d.ts` added to `package.json` files array for npm distribution.

## [1.6.0] — M4 Compass + M5 Sonar + M6 Cartographer (2026-02-06)

### Added

- `CasService.readManifest({ treeOid })` — reads a Git tree, locates and decodes the manifest, returns a validated `Manifest` value object.
- `CasService.deleteAsset({ treeOid })` — returns logical deletion metadata (`{ slug, chunksOrphaned }`) without performing destructive Git operations.
- `CasService.findOrphanedChunks({ treeOids })` — aggregates referenced chunk blob OIDs across multiple assets, returning `{ referenced: Set<string>, total: number }`.
- Facade pass-throughs for `readManifest`, `deleteAsset`, and `findOrphanedChunks` on `ContentAddressableStore`.
- New error codes: `MANIFEST_NOT_FOUND`, `GIT_ERROR`.
- 42 new unit tests across three new test suites.
- `CasService` now extends `EventEmitter` with lifecycle events:
  `chunk:stored`, `chunk:restored`, `file:stored`, `file:restored`,
  `integrity:pass`, `integrity:fail`, and `error` (guarded).
- Comprehensive benchmark suite (`test/benchmark/cas.bench.js`) covering
  store, restore, encrypt/decrypt, createTree, verifyIntegrity, and
  JsonCodec vs CborCodec at multiple data sizes.
- 14 new unit tests for EventEmitter integration.
- `docs/API.md` — full API reference for all public methods, events, value objects, ports, and error codes.
- `docs/SECURITY.md` — threat model, AES-256-GCM design, key handling, limitations.
- `GUIDE.md` — progressive-disclosure guide from zero knowledge to mastery.
- `examples/` directory with runnable scripts: `store-and-restore.js`, `encrypted-workflow.js`, `progress-tracking.js`.
- ESLint config now ignores `examples/` directory (runnable scripts use `console.log`).

## [1.3.0] — M3 Launchpad (2026-02-06)

### Added

- Native Bun support via `BunCryptoAdapter` (uses `Bun.CryptoHasher`).
- Native Deno/Web standard support via `WebCryptoAdapter` (uses `crypto.subtle`).
- Automated, secure release workflow (`.github/workflows/release.yml`) with:
  - **NPM OIDC support** including build provenance.
  - **JSR support** via `jsr.json` and automated publishing.
  - **GitHub Releases** with automated release notes.
  - **Idempotency & Version Checks** to prevent failed partial releases.
- Dynamic runtime detection in `ContentAddressableStore` to pick the best adapter automatically.
- Hardened `package.json` with repository metadata, engine constraints, and explicit file inclusion.
- Local quality gates via `pre-push` git hook and `scripts/install-hooks.sh`.

### Changed

- **Breaking Change:** `CasService` cryptographic methods (`sha256`, `encrypt`, `decrypt`, `verifyIntegrity`) are now asynchronous to support Web Crypto and native optimizations.
- `ContentAddressableStore` facade methods are now asynchronous to accommodate lazy service initialization and async crypto.
- Project migrated from `npm` to `pnpm` for faster, more reliable dependency management.
- CI workflow (`.github/workflows/ci.yml`) now runs on all branches but prevents duplicate runs on PRs.
- `Dockerfile` now uses `corepack` for pnpm management.

### Fixed

- Fixed recursion bug in `BunCryptoAdapter` where `randomBytes` shadowed the imported function.
- Resolved lazy-initialization race condition in `ContentAddressableStore` via promise caching.
- Fixed state leak in `WebCryptoAdapter` streaming encryption.
- Consolidated double decrypt calls in integrity tests for better performance.
- Hardened adapter-level key validation with type checks.

## [1.2.0] — M2 Boomerang (v1.2.0)

### Added

- `CryptoPort` interface and `NodeCryptoAdapter` — extracted all `node:crypto` usage from the domain layer.
- `CasService.store()` — accepts `AsyncIterable<Buffer>` sources (renamed from `storeFile`).
- Multi-stage Dockerfile (Node 22, Bun, Deno) with `docker-compose.yml` for per-runtime testing.
- BATS parallel test runner (`test/platform/runtimes.bats`).
- Devcontainer setup (`.devcontainer/`) with all three runtimes + BATS.
- Encryption key validation (`INVALID_KEY_TYPE`, `INVALID_KEY_LENGTH` error codes).
- Encryption round-trip unit tests (110 tests including fuzz).
- Empty file (0-byte) edge case tests.
- Error-path unit tests for constructors and core failures.
- Deterministic test digest helper (`digestOf`).

### Changed

- `CasService` domain layer has zero `node:*` imports — all platform dependencies injected via ports.
- Constructor requires `crypto` and `codec` params (no defaults); facade supplies them.
- Facade `storeFile()` now opens the file and delegates to `CasService.store()`.

### Fixed

- None.

### Security

- None.

## [1.0.0] - 2025-05-30

### Added

- `ContentAddressableStore` facade with `createJson` and `createCbor` factory methods.
- `CasService` core with `storeFile`, `createTree`, `encrypt`, `decrypt`, and `verifyIntegrity` operations.
- Hexagonal architecture via `GitPersistencePort` interface and `GitPersistenceAdapter` backed by Git's object database.
- Pluggable codec system with `JsonCodec` and `CborCodec` implementations.
- `Manifest` and `Chunk` Zod-validated, frozen value objects.
- `CasError` custom error class for structured error handling.
- Streaming AES-256-GCM encryption and decryption.
- Docker-based test runner for reproducible CI builds.

### Changed

- None.

### Fixed

- None.

### Security

- None.
