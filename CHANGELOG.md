# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] — M7 Horizon (2026-02-07)

### Added
- **Compression support** (Task 7.1): Optional gzip compression pipeline via `compression: { algorithm: 'gzip' }` option on `store()`. Compression is applied before encryption when both are enabled. Manifests include a new optional `compression` field. Decompression on `restore()` is automatic.
- **KDF support** (Task 7.2): Passphrase-based encryption using PBKDF2 or scrypt via `deriveKey()` method and `passphrase` option on `store()`/`restore()`. KDF parameters are stored in `manifest.encryption.kdf` for deterministic re-derivation. All three crypto adapters (Node, Bun, Web) implement `deriveKey()`.
- **Merkle tree manifests** (Task 7.3): Large manifests (chunk count exceeding `merkleThreshold`, default 1000) are automatically split into sub-manifests stored as separate blobs. Root manifest uses `version: 2` with `subManifests` references. `readManifest()` transparently reconstitutes v2 manifests into flat chunk lists. Full backward compatibility with v1 manifests.
- New schema fields: `version`, `compression`, `subManifests` on `ManifestSchema`; `kdf` on `EncryptionSchema`.
- 52 new unit tests across three new test suites (compression, KDF, Merkle).
- Updated API reference (`docs/API.md`), guide (`GUIDE.md`), and README with v2.0.0 feature documentation.

### Changed
- **BREAKING**: Manifest schema now includes `version` field (defaults to 1). Existing v1 manifests are fully backward-compatible.
- `CasService` constructor accepts new `merkleThreshold` option.
- `store()` accepts `passphrase`, `kdfOptions`, and `compression` options.
- `restore()` accepts `passphrase` option.

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
