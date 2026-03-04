# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **CODE-EVAL.md** — Forensic architectural audit (zero-knowledge code extraction, critical assessment, roadmap reconciliation, prescriptive blueprint).
- **M16 Capstone** — New milestone in ROADMAP.md addressing all 9 audit flaws and 10 concerns (C1–C10). 13 task cards, ~698 LoC, ~21h estimated.
- **Concerns C8–C10** — Three new architectural concerns identified by the audit: crypto adapter LSP violation (C8), FixedChunker quadratic allocation (C9), encrypt-then-chunk dedup loss (C10).
- **CasError codes** — `RESTORE_TOO_LARGE` and `ENCRYPTION_BUFFER_EXCEEDED` registered in canonical error code table.

### Fixed
- **16.8 — CasError portability guard** — `Error.captureStackTrace` now guarded with a runtime check. CasError constructs correctly on runtimes where `captureStackTrace` is unavailable (e.g. Firefox, older Deno).
- **16.9 — Pre-commit hook + hooks directory** — `scripts/git-hooks/` renamed to `scripts/hooks/` per CLAUDE.md convention. New `pre-commit` hook runs lint gate. `install-hooks.sh` updated accordingly.
- **16.1 — Crypto adapter behavioral normalization** — `NodeCryptoAdapter.encryptBuffer` now returns a Promise (was sync), matching Bun/Web. `decryptBuffer` validates key on all adapters. `NodeCryptoAdapter.createEncryptionStream` guards `finalize()` with `STREAM_NOT_CONSUMED`. New conformance test suite asserts identical contracts across all adapters.

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
