# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — M2 Boomerang (v1.2.0)

### Added
- `CasService.restore()` — reconstruct files from manifests with per-chunk SHA-256 integrity verification.
- `ContentAddressableStore.restoreFile()` — facade method that restores and writes to disk.
- `readTree()` on `GitPersistencePort` / `GitPersistenceAdapter` — parse Git trees via `ls-tree`.
- `STREAM_ERROR` wrapping — stream failures during `store()` surface as `CasError('STREAM_ERROR')` with `{ chunksWritten }` metadata.
- CLI: `git cas store`, `git cas tree`, `git cas restore` subcommands via `bin/git-cas.js`.
- Integration test suite (59 tests) running against real Git bare repos inside Docker.
- `commander` dependency for CLI.

### Changed
- `readBlob()` now normalises `Uint8Array` from plumbing into `Buffer` for codec/crypto compatibility.

### Fixed
- None.

### Security
- None.

## [1.1.0] — M1 Bedrock

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
