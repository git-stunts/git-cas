# @git-stunts/cas — ROADMAP

Content-addressed storage backed by Git's object database (ODB), with optional encryption and pluggable codecs.

This roadmap is structured as:

1. **Header** — Platform, dependencies, supported environments
2. **Canonical CasError Codes** — Single registry of all error codes referenced by tasks
3. **Contracts** — Return/throw semantics for all public methods
4. **Version Plan** — Table mapping versions to milestones
5. **Milestone Dependency Graph** — ASCII diagram
6. **Milestones & Task Cards** — 7 milestones, 26 tasks (uniform task card template)

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

| Code | Description | Introduced By |
|------|-------------|---------------|
| `INVALID_KEY_LENGTH` | Encryption key is not exactly 32 bytes (AES-256 requirement). Error meta includes `{ expected: 32, actual: <number> }`. | Task 1.3 |
| `INVALID_KEY_TYPE` | Encryption key is not a Buffer. | Task 1.3 |
| `INTEGRITY_ERROR` | Decryption auth-tag verification failed (wrong key, tampered ciphertext, or tampered tag), or chunk digest mismatch on restore. | Exists (decrypt); extended by Task 1.6, Task 2.1 |
| `STREAM_ERROR` | Read stream failed during `storeFile`. Partial chunks may have been written to Git ODB (unreachable; handled by `git gc`). Meta includes `{ chunksWritten: <number> }`. | Task 2.4 |
| `MISSING_KEY` | Encryption key required to restore encrypted content but none was provided. | Task 2.1 |
| `TREE_PARSE_ERROR` | `git ls-tree` output could not be parsed into valid entries. | Task 2.2 |
| `MANIFEST_NOT_FOUND` | No manifest entry (e.g. `manifest.json` / `manifest.cbor`) found in the Git tree. | Task 4.1 |
| `GIT_ERROR` | Underlying Git plumbing command failed. Wraps the original error from the plumbing layer. | Task 2.2, Task 4.1 |

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

### `deriveKey({ passphrase, salt?, algorithm?, iterations? })` *(planned — Task 7.2)*
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

---

## 4) Version Plan

| Version | Milestone | Codename | Theme | Status |
|--------:|-----------|----------|-------|--------|
| v1.1.0  | M1        | Bedrock  | Foundation hardening | ✅ |
| v1.2.0  | M2        | Boomerang| File retrieval round trip + CLI | ✅ |
| v1.3.0  | M3        | Launchpad| CI/CD pipeline | ✅ |
| v1.4.0  | M4        | Compass  | Lifecycle management | ✅ |
| v1.5.0  | M5        | Sonar    | Observability | ✅ |
| v1.6.0  | M6        | Cartographer | Documentation | ✅ |
| v2.0.0  | M7        | Horizon  | Advanced features | |

---

## 5) Milestone Dependency Graph

```text
M1 Bedrock (v1.1.0)
│
v
M2 Boomerang (v1.2.0) ───┐
│                       │
v                       v
M3 Launchpad (v1.3.0)   M4 Compass (v1.4.0)
                          │
                          v
                        M5 Sonar (v1.5.0)
                          │
                          v
                        M6 Cartographer (v1.6.0)
                          │
                          v
                        M7 Horizon (v2.0.0)
```

---

## 6) Milestones & Task Cards

### Milestones at a glance

| #  | Codename      | Theme                      | Version | Tasks | ~LoC   | ~Hours |
|---:|--------------|----------------------------|:-------:|------:|-------:|------:|
| M1 | Bedrock       | Foundation hardening       | v1.1.0  | 7     | ~475   | ~6.5h |
| M2 | Boomerang     | File retrieval round trip + CLI | v1.2.0  | 6     | ~435   | ~14h  |
| M3 | Launchpad     | CI/CD pipeline             | v1.3.0  | 2     | ~110   | ~4h   |
| M4 | Compass       | Lifecycle management       | v1.4.0  | 3     | ~180   | ~5.5h |
| M5 | Sonar         | Observability              | v1.5.0  | 2     | ~210   | ~5.5h |
| M6 | Cartographer  | Documentation              | v1.6.0  | 3     | ~750   | ~10h  |
| M7 | Horizon       | Advanced features          | v2.0.0  | 3     | ~450   | ~17h  |
|    | **Total**     |                            |         | **26**| **~2,610** | **~62.5h** |

---

# M1 — Bedrock (v1.1.0) ✅
**Theme:** Close compliance gaps, harden validation, expand test coverage. No new features.

---

## Task 1.1: Add LICENSE file (Apache-2.0)

**User Story**
As an open-source consumer, I want an Apache-2.0 LICENSE in the repo root so I can verify licensing terms quickly.

**Requirements**
- R1: Add full Apache-2.0 license text at `LICENSE` in repository root.
- R2: Include copyright line: `Copyright 2026 James Ross <james@flyingrobots.dev>`.
- R3: No code changes required if `package.json` already declares Apache-2.0.

**Acceptance Criteria**
- AC1: `LICENSE` exists in repo root and matches Apache-2.0 full text.
- AC2: Copyright line is present and correct.

**Scope**
- In scope: `LICENSE` file creation only.
- Out of scope: Adding license headers to source files (defer to M6).

**Est. Complexity (LoC)**
- Prod: ~200
- Tests: ~0
- Total: ~200

**Est. Human Working Hours**
- ~0.25h

**Test Plan**
- Golden path:
  - Verify file exists and is included in `npm pack` output.
- Failures:
  - Missing file fails CI lint step (added in M3).
- Edges:
  - None.
- Fuzz/stress:
  - None.

**Definition of Done**
- DoD1: LICENSE file added at repo root.
- DoD2: `npm pack` includes LICENSE.

**Blocking**
- Blocks: Task 3.2

**Blocked By**
- Blocked by: None

---

## Task 1.2: Add CHANGELOG.md (Keep a Changelog)

**User Story**
As a consumer upgrading versions, I want a changelog so I can assess upgrade impact and risk.

**Requirements**
- R1: Add `CHANGELOG.md` following Keep a Changelog v1.1.0 format.
- R2: Include `[Unreleased]` section.
- R3: Retroactively add v1.0.0 entry based on git history.
- R4: Use sections: Added, Changed, Fixed, Security.

**Acceptance Criteria**
- AC1: `CHANGELOG.md` exists and follows the required format.
- AC2: v1.0.0 entry exists with at least one "Added" item.
- AC3: `[Unreleased]` section exists.

**Scope**
- In scope: Manual changelog file creation.
- Out of scope: Automated changelog tooling.

**Est. Complexity (LoC)**
- Prod: ~40
- Tests: ~0
- Total: ~40

**Est. Human Working Hours**
- ~0.5h

**Test Plan**
- Golden path:
  - Ensure release workflow (M3) can extract excerpt from changelog.
- Failures:
  - Missing changelog fails release gating (M3).
- Edges:
  - None.
- Fuzz/stress:
  - None.

**Definition of Done**
- DoD1: CHANGELOG.md created and reviewed for format compliance.
- DoD2: v1.0.0 entry populated.

**Blocking**
- Blocks: Task 3.2

**Blocked By**
- Blocked by: None

---

## Task 1.3: Validate encryption key length (32 bytes for AES-256)

**User Story**
As a developer, I want invalid encryption keys rejected immediately so I don't get cryptic crypto errors later.

**Requirements**
- R1: `storeFile({ encryptionKey })` throws `CasError` with code `INVALID_KEY_LENGTH` if key length ≠ 32 bytes.
- R2: `encrypt({ key })` enforces identical validation and error contract.
- R3: Error includes expected vs actual length (message or metadata).
- R4: Validation occurs before any I/O (no persistence calls on failure).

**Acceptance Criteria**
- AC1: 32-byte Buffer key passes for both `storeFile` and `encrypt`.
- AC2: Any non-32 length throws `CasError.code === 'INVALID_KEY_LENGTH'`.
- AC3: Error includes expected=32 and actual length.
- AC4: No persistence calls occur on validation failure.

**Scope**
- In scope: Key length validation + tests.
- Out of scope: Key format rules (hex vs base64), KDF (M7).

**Est. Complexity (LoC)**
- Prod: ~15
- Tests: ~30
- Total: ~45

**Est. Human Working Hours**
- ~1h

**Test Plan**
- Golden path:
  - 32-byte key accepted in both code paths.
- Failures:
  - 16-byte key throws INVALID_KEY_LENGTH.
  - 64-byte key throws INVALID_KEY_LENGTH.
  - 0-byte key throws INVALID_KEY_LENGTH.
  - non-Buffer key throws typed error (INVALID_KEY_TYPE).
- Edges:
  - `crypto.randomBytes(32)` passes.
- Fuzz/stress:
  - Test lengths 0..128 (deterministic seed), assert only 32 passes.

**Definition of Done**
- DoD1: Shared validation helper exists and is used by both call sites.
- DoD2: Tests cover all required cases.
- DoD3: Error contract documented in API docs stub or inline comments.

**Blocking**
- Blocks: Task 1.6, Task 2.1, Task 6.2, Task 7.2

**Blocked By**
- Blocked by: None

---

## Task 1.4: Handle empty file edge case (0 bytes)

**User Story**
As a developer, I want storing a zero-byte file to produce a valid manifest so that empty assets are supported.

**Requirements**
- R1: `storeFile()` on 0-byte file returns Manifest with `size: 0` and `chunks: []`.
- R2: No chunk blob writes occur for empty content.
- R3: Works with and without encryption option enabled.

**Acceptance Criteria**
- AC1: Manifest returned has `size=0` and `chunks.length=0`.
- AC2: Persistence `writeBlob` is not called for chunk content.
- AC3: Behavior is identical with encryption enabled (manifest may include encryption metadata; chunks remain empty).

**Scope**
- In scope: Ensure empty-file store is correct + tests.
- Out of scope: Empty directory handling.

**Est. Complexity (LoC)**
- Prod: ~5
- Tests: ~25
- Total: ~30

**Est. Human Working Hours**
- ~0.75h

**Test Plan**
- Golden path:
  - Store 0-byte file → manifest size 0, chunks [].
  - Store 0-byte file with encryption option → manifest valid, chunks [].
- Failures:
  - Nonexistent input path (covered more fully in Task 1.7).
- Edges:
  - Ensure no chunk writes happen (spy/mock).
- Fuzz/stress:
  - Run repeated empty-file stores (e.g., 100) to ensure no state leakage.

**Definition of Done**
- DoD1: Unit tests added confirming behavior and persistence call counts.
- DoD2: No regression in non-empty file paths.

**Blocking**
- Blocks: Task 2.1

**Blocked By**
- Blocked by: None

---

## Task 1.5: Use realistic deterministic test digests

**User Story**
As a maintainer, I want tests to use realistic SHA-256 digests so digest-length and format bugs can't hide.

**Requirements**
- R1: Replace placeholder digests (e.g., `'a'.repeat(64)`) with deterministic realistic digests.
- R2: Add helper `digestOf(seed: string): string` that returns `sha256(seed).hex`.
- R3: Ensure tests remain deterministic (no random digests).

**Acceptance Criteria**
- AC1: No remaining `'a'.repeat(64)` / `'b'.repeat(64)` patterns in tests.
- AC2: Tests pass consistently across repeated runs.
- AC3: Digests produced are exactly 64 hex chars.

**Scope**
- In scope: Test data improvements only.
- Out of scope: Large test refactors.

**Est. Complexity (LoC)**
- Prod: ~0
- Tests: ~15
- Total: ~15

**Est. Human Working Hours**
- ~0.5h

**Test Plan**
- Golden path:
  - All unit tests pass using deterministic digests.
- Failures:
  - Helper returns wrong length → tests should fail schema validation.
- Edges:
  - Multiple seeds yield distinct digests.
- Fuzz/stress:
  - Generate 100 digests from different seeds and validate length/hex format.

**Definition of Done**
- DoD1: Digest helper added and used across tests.
- DoD2: All tests deterministic and green.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

## Task 1.6: Add encryption round-trip unit tests (encrypt/decrypt)

**User Story**
As a maintainer, I want encrypt/decrypt tested as a pair (including tamper detection) so crypto refactors are safe.

**Requirements**
- R1: Add unit tests ensuring encrypt→decrypt returns original plaintext.
- R2: Wrong key must throw `CasError('INTEGRITY_ERROR')`.
- R3: Tampered ciphertext must throw `CasError('INTEGRITY_ERROR')`.
- R4: Tampered auth tag must throw `CasError('INTEGRITY_ERROR')`.
- R5: If `meta.encrypted === false`, decrypt returns buffer unchanged.
- R6: If `meta` absent and decrypt supports passthrough, it must return unchanged (or explicitly throw; define contract).

**Acceptance Criteria**
- AC1: Multiple plaintext sizes round-trip correctly.
- AC2: Wrong-key and tamper tests fail with INTEGRITY_ERROR.
- AC3: Passthrough behavior is documented and tested.

**Scope**
- In scope: Unit tests only.
- Out of scope: storeFile encryption integration (M2).

**Est. Complexity (LoC)**
- Prod: ~0
- Tests: ~60
- Total: ~60

**Est. Human Working Hours**
- ~1.5h

**Test Plan**
- Golden path:
  - plaintext sizes: 0B, 1B, 1KB, 1MB round-trip.
- Failures:
  - wrong key throws INTEGRITY_ERROR.
  - flip one bit in ciphertext throws INTEGRITY_ERROR.
  - flip one bit in auth tag throws INTEGRITY_ERROR.
  - swap nonce (if represented) throws INTEGRITY_ERROR.
- Edges:
  - meta.encrypted=false passthrough.
  - meta undefined behavior explicitly asserted.
- Fuzz/stress:
  - 50 randomized plaintext buffers (seeded), assert round-trip holds.
  - Tamper one random byte each run, assert failure.

**Definition of Done**
- DoD1: New crypto test suite added and passing.
- DoD2: Crypto error behavior is stable and enforced by tests.

**Blocking**
- Blocks: Task 2.1, Task 6.2

**Blocked By**
- Blocked by: Task 1.3

---

## Task 1.7: Add error-path unit tests (constructors + core failures)

**User Story**
As a maintainer, I want error conditions covered by tests so regressions in validation and failure handling are caught.

**Requirements**
- R1: Add tests for CasService constructor validation (chunkSize constraints).
- R2: `storeFile` on nonexistent path rejects with error (wrapped if contract exists).
- R3: `verifyIntegrity` returns false (or throws) on digest mismatch (define contract).
- R4: `createTree` rejects invalid manifest input.
- R5: Manifest constructor rejects invalid data (missing slug, negative size, etc.).
- R6: Chunk constructor rejects invalid data (negative index, invalid digest length, etc.).

**Acceptance Criteria**
- AC1: Each listed error path is covered by a unit test.
- AC2: Error codes/messages are stable enough for consumers (typed where applicable).
- AC3: Tests fail if validation is removed or loosened.

**Scope**
- In scope: Unit-level error path tests.
- Out of scope: Integration error scenarios and retries (M2/M3).

**Est. Complexity (LoC)**
- Prod: ~0–10 (if missing typed errors)
- Tests: ~80
- Total: ~80–90

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - chunkSize=1024 passes; valid Manifest/Chunk constructors pass.
- Failures:
  - chunkSize=0/512 throws.
  - storeFile nonexistent path rejects.
  - verifyIntegrity detects mismatch (returns false per contract).
  - createTree invalid manifest throws.
  - Manifest invalid fields throw.
  - Chunk invalid fields throw.
- Edges:
  - boundary chunkSize=1024 exactly passes.
  - digest length = 63/65 fails.
- Fuzz/stress:
  - Generate malformed manifest objects (missing fields, wrong types) and ensure Zod rejects.

**Definition of Done**
- DoD1: New unit test files added and passing.
- DoD2: Failure contracts (throw vs return false) documented and consistent.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

# M2 — Boomerang (v1.2.0) ✅
**Theme:** Complete store→retrieve round trip + CLI.

---

## Task 2.1: Implement restoreFile() on CasService

**User Story**
As a developer, I want to reconstruct a file from its manifest so I can retrieve previously stored assets reliably.

**Requirements**
- R1: Add `CasService.restoreFile({ manifest, encryptionKey, outputPath })`.
- R2: Read chunk blobs via `persistence.readBlob(chunk.blob)` in index order.
- R3: Verify SHA-256 digest per chunk before writing; on mismatch throw `CasError('INTEGRITY_ERROR')`.
- R4: If encrypted: concatenate ciphertext, decrypt with manifest metadata + key, then write plaintext.
- R5: Must handle empty manifests (0 chunks) by creating an empty file.
- R6: Return `{ bytesWritten: number }`.

**Acceptance Criteria**
- AC1: Plaintext store→restore matches original bytes.
- AC2: Encrypted store→restore matches original bytes when correct key is provided.
- AC3: Wrong key throws INTEGRITY_ERROR.
- AC4: Corrupted chunk throws INTEGRITY_ERROR.
- AC5: Empty manifest produces 0-byte output.

**Scope**
- In scope: Restore + integrity verification + writing output.
- Out of scope: Streaming decryption, resume/partial restore.

**Est. Complexity (LoC)**
- Prod: ~45
- Tests: ~80
- Total: ~125

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - store 10KB plaintext → restore → byte-for-byte compare.
  - store 10KB encrypted → restore with key → compare.
- Failures:
  - wrong key → INTEGRITY_ERROR.
  - digest mismatch → INTEGRITY_ERROR.
  - outputPath unwritable surfaces error (typed if contract added).
- Edges:
  - empty manifest restores empty file.
  - single-chunk file (< chunkSize).
  - exact multiple of chunkSize.
- Fuzz/stress:
  - 200 file sizes (seeded) around boundaries (0..3*chunkSize) ensure correctness.
  - Optional local-only stress: 50MB restore.

**Definition of Done**
- DoD1: restoreFile implemented and exported via facade.
- DoD2: Unit/integration tests added and passing.
- DoD3: Encrypted restore memory behavior documented (SECURITY.md in M6; add stub note now).

**Blocking**
- Blocks: Task 2.3, Task 5.1, Task 5.2, Task 4.1

**Blocked By**
- Blocked by: Task 1.3, Task 1.4

---

## Task 2.2: Add readTree() to GitPersistencePort and GitPersistenceAdapter

**User Story**
As the CAS system, I want to parse a Git tree into entries so I can locate manifest and chunk blobs for lifecycle operations.

**Requirements**
- R1: Add `readTree(treeOid)` to GitPersistencePort.
- R2: Implement adapter via `git ls-tree <treeOid>`.
- R3: Parse each line: `<mode> <type> <oid>\t<name>` into `{ mode, type, oid, name }`.
- R4: Malformed output throws typed error `CasError('TREE_PARSE_ERROR')`.

**Acceptance Criteria**
- AC1: Typical ls-tree output parses correctly into expected fields.
- AC2: Empty output returns [].
- AC3: Malformed output throws TREE_PARSE_ERROR.

**Scope**
- In scope: Non-recursive tree parsing.
- Out of scope: Tree walking / recursion.

**Est. Complexity (LoC)**
- Prod: ~20
- Tests: ~25
- Total: ~45

**Est. Human Working Hours**
- ~1.5h

**Test Plan**
- Golden path:
  - parse output containing manifest + 2 chunk blobs.
- Failures:
  - malformed line triggers TREE_PARSE_ERROR.
  - plumbing failure propagates or wraps as GIT_ERROR (define contract).
- Edges:
  - filename contains spaces (tab delimiter must be honored).
- Fuzz/stress:
  - parse synthetic output with 1,000 entries.

**Definition of Done**
- DoD1: Port and adapter methods implemented.
- DoD2: Parser tests added and green.
- DoD3: No breaking API changes (additive only).

**Blocking**
- Blocks: Task 2.3, Task 4.1

**Blocked By**
- Blocked by: None

---

## Task 2.3: Integration tests (store + restore round trip)

**User Story**
As a maintainer, I want end-to-end tests against real Git so the system is validated beyond mocks.

**Requirements**
- R1: Add integration test suite that runs against a real Git repo.
- R2: Test uses a temp bare repo (`git init --bare`) as ODB.
- R3: Exercises: storeFile → createTree → readTree → readManifest/restoreFile.
- R4: Test both JSON and CBOR codec paths.
- R5: Test encrypted and unencrypted paths.
- R6: Integration tests run in Docker to ensure consistent Git availability.

**Acceptance Criteria**
- AC1: Integration suite passes locally and in CI (M3).
- AC2: Round-trip comparisons are byte-for-byte equal.
- AC3: Both codecs validated end-to-end.

**Scope**
- In scope: Integration test harness + docker runner + scenarios.
- Out of scope: Performance benchmarks (M5).

**Est. Complexity (LoC)**
- Prod: ~0
- Tests: ~120
- Total: ~120

**Est. Human Working Hours**
- ~4h

**Test Plan**
- Golden path:
  - 10KB plaintext → round trip.
  - 10KB encrypted → round trip with key.
  - CBOR codec round trip.
- Failures:
  - wrong key restore fails with INTEGRITY_ERROR.
- Edges:
  - 0-byte file round trip.
  - exact chunkSize file round trip.
  - exact 3*chunkSize file round trip.
- Fuzz/stress:
  - 50 random file sizes (seeded) around chunk boundaries.
  - Optional local-only: 100MB store/restore smoke (not CI).

**Definition of Done**
- DoD1: Integration tests runnable via npm script.
- DoD2: Docker harness documented in test README or comments.
- DoD3: Integration tests pass in CI once M3 lands.

**Blocking**
- Blocks: Task 3.1

**Blocked By**
- Blocked by: Task 2.1, Task 2.2

---

## Task 2.4: Stream error recovery — wrap and document partial writes

**User Story**
As a developer, I want storeFile to fail safely on stream errors so partial stores don't produce misleading manifests.

**Requirements**
- R1: If stream errors mid-store, storeFile rejects and does not return a Manifest.
- R2: Wrap stream errors as `CasError('STREAM_ERROR')` including partial chunks written count.
- R3: Document that orphaned chunk blobs may remain, and are handled by Git GC if unreachable.
- R4: Ensure manifest is not written/returned on partial store.

**Acceptance Criteria**
- AC1: Simulated stream failure returns STREAM_ERROR with metadata `{ chunksWritten }`.
- AC2: No manifest is returned/created on failure.
- AC3: Documentation note exists (inline or docs placeholder).

**Scope**
- In scope: Error wrapping + tests + documentation note.
- Out of scope: Deleting blobs, resume functionality.

**Est. Complexity (LoC)**
- Prod: ~15
- Tests: ~20
- Total: ~35

**Est. Human Working Hours**
- ~1h

**Test Plan**
- Golden path:
  - No change to successful stores.
- Failures:
  - stream emits error after N chunks → STREAM_ERROR and metadata correct.
- Edges:
  - error occurs before any chunks written → chunksWritten=0.
- Fuzz/stress:
  - randomized failure point across 0..N chunks (seeded) to ensure metadata correctness.

**Definition of Done**
- DoD1: storeFile wraps stream errors consistently.
- DoD2: Tests prove manifest is not produced.
- DoD3: Partial-write behavior documented.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

## Task 2.5: CLI scaffold + `store` and `tree` subcommands

**User Story**
As a developer, I want `git cas store` and `git cas tree` commands so I can use CAS from the terminal without writing Node scripts.

**Requirements**
- R1: Add `bin/git-cas.js` entry point (Git discovers `git-cas` on PATH for `git cas` subcommands).
- R2: Add `"bin": { "git-cas": "./bin/git-cas.js" }` to `package.json`.
- R3: Use a lightweight CLI framework (e.g., `commander`) for subcommand routing.
- R4: `git cas store <file> --slug <slug> [--key-file <path>] [--tree]`:
  - Reads the file, calls `storeFile()`.
  - Prints manifest JSON to stdout by default.
  - If `--tree` is passed, also calls `createTree()` and prints tree OID.
  - `--key-file` reads a 32-byte raw key from a file for encryption.
- R5: `git cas tree --manifest <path>`:
  - Reads a manifest JSON from file/stdin, calls `createTree()`.
  - Prints tree OID to stdout.
- R6: Exit 0 on success, exit 1 on error with message to stderr.
- R7: `--cwd` flag to set Git working directory (defaults to `.`).

**Acceptance Criteria**
- AC1: `npx git-cas store ./test.txt --slug test` prints manifest JSON.
- AC2: `npx git-cas store ./test.txt --slug test --tree` prints tree OID.
- AC3: `npx git-cas tree --manifest manifest.json` prints tree OID.
- AC4: Invalid arguments produce helpful usage message and exit 1.
- AC5: `--key-file` with valid 32-byte file encrypts successfully.
- AC6: `--key-file` with wrong-size file exits 1 with clear error.

**Scope**
- In scope: CLI scaffold, store subcommand, tree subcommand, key-file reading.
- Out of scope: `restore` subcommand (Task 2.6), shell completions, config files.

**Est. Complexity (LoC)**
- Prod: ~80
- Tests: ~30
- Total: ~110

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - store a file via CLI → valid manifest JSON on stdout.
  - store with `--tree` → tree OID on stdout.
  - tree from manifest file → tree OID on stdout.
- Failures:
  - missing file → exit 1 with error.
  - missing `--slug` → exit 1 with usage message.
  - bad key file → exit 1 with INVALID_KEY_LENGTH/TYPE error.
- Edges:
  - 0-byte file store.
  - manifest piped via stdin (if supported).
- Fuzz/stress:
  - None (thin wrapper over tested API).

**Definition of Done**
- DoD1: `bin/git-cas.js` exists with store and tree subcommands.
- DoD2: `package.json` declares bin entry.
- DoD3: `npx git-cas --help` prints usage.
- DoD4: Integration smoke test passes against real Git repo.

**Blocking**
- Blocks: Task 2.6

**Blocked By**
- Blocked by: None

---

## Task 2.6: CLI `restore` subcommand

**User Story**
As a developer, I want `git cas restore <tree-oid> --out <path>` so I can retrieve stored assets from the terminal.

**Requirements**
- R1: `git cas restore <tree-oid> --out <path> [--key-file <path>]`:
  - Reads the tree, extracts the manifest, restores the file to `--out`.
  - Prints bytes written to stdout on success.
  - `--key-file` supplies decryption key for encrypted assets.
- R2: Exit 0 on success, exit 1 on error (INTEGRITY_ERROR, MANIFEST_NOT_FOUND, etc.) with message to stderr.
- R3: Requires `restoreFile()` (Task 2.1) and `readManifest()` or equivalent tree-reading capability.

**Acceptance Criteria**
- AC1: `npx git-cas restore <oid> --out ./restored.txt` writes correct file.
- AC2: Encrypted asset with `--key-file` restores correctly.
- AC3: Wrong key exits 1 with INTEGRITY_ERROR message.
- AC4: Invalid tree OID exits 1 with clear error.

**Scope**
- In scope: restore subcommand wired to restoreFile API.
- Out of scope: Streaming output to stdout, partial restore, resume.

**Est. Complexity (LoC)**
- Prod: ~30
- Tests: ~20
- Total: ~50

**Est. Human Working Hours**
- ~1.5h

**Test Plan**
- Golden path:
  - store → tree → restore → byte-compare original.
  - encrypted store → tree → restore with key → byte-compare.
- Failures:
  - wrong key → exit 1 INTEGRITY_ERROR.
  - nonexistent tree OID → exit 1.
  - missing `--out` → exit 1 with usage.
- Edges:
  - 0-byte file round-trip via CLI.
- Fuzz/stress:
  - None (thin wrapper over tested API).

**Definition of Done**
- DoD1: `restore` subcommand added to `bin/git-cas.js`.
- DoD2: Full CLI round-trip (store → tree → restore) documented and tested.
- DoD3: README CLI section is now accurate and deliverable.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 2.1, Task 2.5

---

# M3 — Launchpad (v1.3.0) ✅
**Theme:** Automated quality gates and release process.

---

## Task 3.1: GitHub Actions CI workflow

**User Story**
As a maintainer, I want CI to run lint + unit + integration tests on every push/PR so regressions are caught early.

**Requirements**
- R1: Add `.github/workflows/ci.yml`.
- R2: Triggers on push to main and pull_request to main.
- R3: Uses Node 22.
- R4: Steps: checkout, install, lint, unit tests, integration tests.
- R5: Integration tests run via Docker harness.
- R6: Cache dependencies for speed.

**Acceptance Criteria**
- AC1: CI runs automatically on PRs and pushes.
- AC2: CI fails if lint/tests fail.
- AC3: Integration tests execute in CI and pass.

**Scope**
- In scope: CI workflow only.
- Out of scope: CD publishing (Task 3.2), multi-OS matrix.

**Est. Complexity (LoC)**
- Prod: ~60
- Tests: ~0
- Total: ~60

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - Push branch → CI green.
- Failures:
  - Intentionally break a unit test → CI red.
  - Intentionally break integration test → CI red.
- Edges:
  - Cache miss still succeeds.
- Fuzz/stress:
  - Run CI twice with different dependency states (lockfile change) to validate caching behavior.

**Definition of Done**
- DoD1: CI workflow merged and green on main.
- DoD2: CI clearly reports which step failed.

**Blocking**
- Blocks: Task 3.2

**Blocked By**
- Blocked by: Task 2.3

---

## Task 3.2: npm publish workflow (tag-driven releases)

**User Story**
As a maintainer, I want releases published automatically on version tags so publishing is reproducible and low-friction.

**Requirements**
- R1: Add `.github/workflows/release.yml`.
- R2: Trigger on tag push matching `v*`.
- R3: Run full CI gates before publish.
- R4: Publish to npm with `--access public`.
- R5: Requires `NPM_TOKEN` secret.
- R6: Create GitHub Release from tag and include CHANGELOG excerpt.

**Acceptance Criteria**
- AC1: Tag push triggers release workflow.
- AC2: Workflow fails if CI fails.
- AC3: Successful workflow publishes package and creates GitHub Release.

**Scope**
- In scope: Tag-based publish workflow.
- Out of scope: Auto version bumping, changelog generation tooling.

**Est. Complexity (LoC)**
- Prod: ~50
- Tests: ~0
- Total: ~50

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - Create tag in test repo → workflow runs through dry-run or publish to test namespace.
- Failures:
  - Missing NPM_TOKEN → workflow fails with clear message.
  - CHANGELOG missing → workflow fails.
- Edges:
  - Tag format mismatch does not trigger.
- Fuzz/stress:
  - Tag multiple versions sequentially (v1.1.0, v1.1.1) in fork to ensure idempotent behavior.

**Definition of Done**
- DoD1: Release workflow exists and passes in a fork/test environment.
- DoD2: Release notes include changelog excerpt.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 3.1, Task 1.1, Task 1.2

---

# M4 — Compass (v1.4.0) ✅
**Theme:** Read manifests from Git, manage stored assets, analyze storage.

---

## Task 4.1: Implement readManifest() on CasService ✅

**User Story**
As a developer, I want to reconstruct a Manifest from a Git tree OID so I can inspect and restore assets without holding manifests in memory.

**Requirements**
- R1: Add `CasService.readManifest({ treeOid })`.
- R2: Use `persistence.readTree(treeOid)` to list entries.
- R3: Locate manifest entry based on codec (e.g., `manifest.json` / `manifest.cbor`).
- R4: Read manifest blob via `persistence.readBlob(oid)`.
- R5: Decode via `codec.decode(blob)` and validate via Manifest schema.
- R6: Throw `CasError('MANIFEST_NOT_FOUND')` if missing.

**Acceptance Criteria**
- AC1: Returns valid Manifest value object for correct tree.
- AC2: Missing manifest entry throws MANIFEST_NOT_FOUND.
- AC3: Corrupt manifest fails validation (typed error or schema error).

**Scope**
- In scope: Read+decode+validate single manifest.
- Out of scope: Multi-manifest trees, recursion.

**Est. Complexity (LoC)**
- Prod: ~30
- Tests: ~40
- Total: ~70

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - mock readTree includes manifest entry; mock readBlob returns encoded manifest; returns Manifest.
- Failures:
  - no manifest entry → MANIFEST_NOT_FOUND.
  - corrupt JSON/CBOR → decode/validation error thrown.
- Edges:
  - codec switch determines expected filename.
- Fuzz/stress:
  - generate malformed manifest blobs and ensure validation rejects consistently.

**Definition of Done**
- DoD1: readManifest implemented and exported via facade.
- DoD2: Unit tests cover missing/corrupt cases.
- DoD3: Manifest filename behavior documented (or CodecPort exposes manifest filename).

**Blocking**
- Blocks: Task 4.2, Task 4.3, Task 6.1

**Blocked By**
- Blocked by: Task 2.2

---

## Task 4.2: Implement deleteAsset() (logical unlink info) ✅

**User Story**
As a developer, I want to "delete" an asset logically so I can manage lifecycle even though Git GC handles physical deletion.

**Requirements**
- R1: Add `CasService.deleteAsset({ treeOid })`.
- R2: Read manifest, return deletion metadata `{ chunksOrphaned, slug }`.
- R3: Document that caller must remove refs/commits pointing to tree; physical deletion requires `git gc --prune`.
- R4: No destructive Git operations performed by CAS.

**Acceptance Criteria**
- AC1: Returns slug and chunk count from manifest.
- AC2: Does not invoke Git ref updates or gc.
- AC3: Documentation clearly describes expected caller action.

**Scope**
- In scope: Logical deletion metadata only.
- Out of scope: Ref management, physical deletion.

**Est. Complexity (LoC)**
- Prod: ~15
- Tests: ~20
- Total: ~35

**Est. Human Working Hours**
- ~1.5h

**Test Plan**
- Golden path:
  - deleteAsset returns expected slug and chunksOrphaned.
- Failures:
  - missing manifest propagates MANIFEST_NOT_FOUND.
- Edges:
  - empty manifest returns chunksOrphaned=0.
- Fuzz/stress:
  - run deleteAsset across N manifests (seeded) ensure stable aggregation.

**Definition of Done**
- DoD1: deleteAsset implemented and exported.
- DoD2: Unit tests pass.
- DoD3: Documentation note added.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 4.1

---

## Task 4.3: Implement orphaned chunk analysis ✅

**User Story**
As an operator, I want to identify referenced chunks across many assets so I can assess storage waste.

**Requirements**
- R1: Add `CasService.findOrphanedChunks({ treeOids })`.
- R2: For each treeOid, read manifest and collect all referenced chunk blob OIDs.
- R3: Return report `{ referenced: Set<string>, total: number }` where total is total referenced chunk count.
- R4: Analysis only; does not delete or invoke git gc.

**Acceptance Criteria**
- AC1: Given treeOids, returns a Set of referenced blob OIDs.
- AC2: total equals sum of chunks across manifests.
- AC3: Does not perform destructive operations.

**Scope**
- In scope: Analysis and aggregation.
- Out of scope: Physical deletion, git gc invocation.

**Est. Complexity (LoC)**
- Prod: ~25
- Tests: ~30
- Total: ~55

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - two manifests share some chunk oids → referenced set dedupes correctly.
- Failures:
  - one treeOid missing manifest → throws MANIFEST_NOT_FOUND (fail closed).
- Edges:
  - empty treeOids list returns referenced empty set, total=0.
- Fuzz/stress:
  - simulate 1,000 manifests with 10 chunks each in-memory, validate set size and performance.

**Definition of Done**
- DoD1: findOrphanedChunks implemented and exported.
- DoD2: Tests cover dedupe + empty input.
- DoD3: Contract documented (throw on missing manifests — fail closed).

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 4.1

---

# M5 — Sonar (v1.5.0) ✅
**Theme:** Events, hooks, and benchmarks.

---

## Task 5.1: EventEmitter integration (progress + observability hooks) ✅

**User Story**
As an application developer, I want progress and lifecycle events so I can build logging, progress bars, and monitoring.

**Requirements**
- R1: CasService extends EventEmitter.
- R2: Emit events with object payloads:
  - `chunk:stored` { index, size, digest, blob }
  - `chunk:restored` { index, size, digest }
  - `file:stored` { slug, size, chunkCount, encrypted }
  - `file:restored` { slug, size, chunkCount }
  - `integrity:pass` { slug }
  - `integrity:fail` { slug, chunkIndex, expected, actual }
  - `error` { code, message }
- R3: No breaking API changes.
- R4: Emissions must not violate lint limits (single object arg).

**Acceptance Criteria**
- AC1: storeFile emits chunk:stored per chunk and file:stored once.
- AC2: restoreFile emits chunk:restored per chunk and file:restored once.
- AC3: verifyIntegrity emits integrity:pass/fail accordingly.
- AC4: Error paths emit `error` with typed code.

**Scope**
- In scope: Event emission and tests.
- Out of scope: Logging implementation, metrics exporter.

**Est. Complexity (LoC)**
- Prod: ~20
- Tests: ~40
- Total: ~60

**Est. Human Working Hours**
- ~2.5h

**Test Plan**
- Golden path:
  - attach listeners; storeFile emits expected sequence and payload shapes.
  - restoreFile emits expected sequence.
- Failures:
  - trigger integrity failure; assert integrity:fail emitted and error emitted.
- Edges:
  - no listeners attached; no errors and no observable overhead assumptions violated.
- Fuzz/stress:
  - store/restore across 200 randomized file sizes; ensure event counts match chunk counts.

**Definition of Done**
- DoD1: CasService inherits EventEmitter and emits events consistently.
- DoD2: Tests validate payload shape contracts.
- DoD3: API docs updated later (M6) but event names frozen here.

**Blocking**
- Blocks: Task 6.1, Task 6.3

**Blocked By**
- Blocked by: Task 2.1

---

## Task 5.2: Comprehensive benchmark suite ✅

**User Story**
As a maintainer, I want benchmarks for critical operations so I can detect regressions and make optimization decisions.

**Requirements**
- R1: Replace trivial bench with comprehensive suite using vitest bench.
- R2: Benchmark:
  - storeFile 1MB/10MB/100MB plaintext
  - storeFile 1MB/10MB encrypted
  - restoreFile 1MB/10MB plaintext + encrypted
  - createTree 10/100/1000 chunks
  - verifyIntegrity 10/100/1000 chunks
  - encrypt/decrypt 1KB/1MB/10MB
  - JsonCodec vs CborCodec encode/decode
- R3: Use mock persistence (in-memory Map) to avoid git variability.
- R4: Output is human-readable (ops/sec or MB/s).

**Acceptance Criteria**
- AC1: Bench suite runs without errors.
- AC2: Report includes all required cases.
- AC3: Results are reasonably stable run-to-run (variance target < 20% in local runs).

**Scope**
- In scope: Synthetic benchmarks with mock persistence.
- Out of scope: CI benchmark tracking, real Git benchmarking.

**Est. Complexity (LoC)**
- Prod: ~0
- Tests: ~150
- Total: ~150

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - bench suite executes and prints results.
- Failures:
  - missing restoreFile or encrypt paths fail suite (ensures dependencies).
- Edges:
  - include empty buffer case in encrypt/decrypt bench.
- Fuzz/stress:
  - run suite 3 times; check variance bounds informally (document expected variability).

**Definition of Done**
- DoD1: Bench suite includes all required scenarios.
- DoD2: Bench is isolated from Git and deterministic enough for comparisons.
- DoD3: Docs note how to run benches and interpret output.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 2.1

---

# M6 — Cartographer (v1.6.0) ✅
**Theme:** Documentation that makes the library usable and trustworthy.

---

## Task 6.1: API reference documentation ✅

**User Story**
As a developer evaluating this library, I want complete API docs so I can integrate without reading source.

**Requirements**
- R1: Add `docs/API.md` covering all public methods and types.
- R2: For each method: signature, parameters, returns, throws, example.
- R3: Document Manifest and Chunk fields.
- R4: Document ports: GitPersistencePort and CodecPort contracts.

**Acceptance Criteria**
- AC1: API.md includes every public method listed in requirements.
- AC2: Examples are runnable or obviously correct pseudo-code.
- AC3: Error contracts are documented (CasError codes).

**Scope**
- In scope: Markdown docs.
- Out of scope: Generated HTML docs, full JSDoc automation.

**Est. Complexity (LoC)**
- Prod: ~0
- Tests: ~0
- Total: ~300 (docs)

**Est. Human Working Hours**
- ~4h

**Test Plan**
- Golden path:
  - Copy examples into examples scripts; verify they run (manual).
- Failures:
  - Missing method documentation flagged in review checklist.
- Edges:
  - Document behavior differences for encrypted vs plaintext restore.
- Fuzz/stress:
  - None (documentation).

**Definition of Done**
- DoD1: API.md complete and reviewed.
- DoD2: Examples compile/run where applicable.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 4.1, Task 5.1

---

## Task 6.2: Security model documentation ✅

**User Story**
As a security reviewer, I want a clear threat model and crypto design description so I can assess safety and limitations.

**Requirements**
- R1: Add `docs/SECURITY.md` covering:
  - threat model
  - AES-256-GCM design (nonce, tag)
  - key handling expectations (CAS never stores keys)
  - limitations (encrypted restore memory)
  - chunk digest verification behavior
  - Git object immutability and GC behavior
- R2: Document CasError codes relevant to security/integrity.

**Acceptance Criteria**
- AC1: SECURITY.md covers all required sections.
- AC2: Limitations are explicit and unambiguous.
- AC3: Crypto invariants align with implementation and tests.

**Scope**
- In scope: Documentation.
- Out of scope: Formal audit, pentesting.

**Est. Complexity (LoC)**
- Prod: ~0
- Tests: ~0
- Total: ~200 (docs)

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - Cross-check doc claims against unit tests (Task 1.6) and restore behavior (Task 2.1).
- Failures:
  - Doc contradicts implementation → fix either code or doc before release.
- Edges:
  - Spell out what "integrity" means for plaintext vs encrypted.
- Fuzz/stress:
  - None (documentation).

**Definition of Done**
- DoD1: SECURITY.md complete and reviewed.
- DoD2: All claims are consistent with code/tests.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 1.3, Task 1.6

---

## Task 6.3: Usage examples (cookbook) ✅

**User Story**
As a new user, I want runnable examples so I can integrate quickly and correctly.

**Requirements**
- R1: Add `examples/` scripts:
  - `store-and-restore.js`
  - `encrypted-workflow.js`
  - `custom-codec.js`
  - `progress-tracking.js`
- R2: Add examples README with prerequisites and commands.
- R3: Examples are self-contained and runnable.

**Acceptance Criteria**
- AC1: All scripts run successfully with expected output.
- AC2: README explains setup clearly.
- AC3: Examples use public API only (no internals).

**Scope**
- In scope: Example scripts + README.
- Out of scope: Advanced feature examples (M7).

**Est. Complexity (LoC)**
- Prod: ~0
- Tests: ~0
- Total: ~250 (examples+docs)

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - run each example script and verify outputs manually.
- Failures:
  - invalid key example demonstrates correct failure and error code.
- Edges:
  - include a 0-byte file example in store-and-restore.
- Fuzz/stress:
  - None (examples).

**Definition of Done**
- DoD1: Examples directory added with runnable scripts.
- DoD2: README present and accurate.
- DoD3: Scripts align with API docs.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 5.1

---

# M7 — Horizon (v2.0.0)
**Theme:** Advanced capabilities that may change manifest format; major version bump.

---

## Task 7.1: Compression support (gzip; pipeline design)

**User Story**
As a developer storing compressible data, I want optional compression before encryption so I can reduce storage size.

**Requirements**
- R1: Add optional compression pipeline step prior to encryption.
- R2: Decide compression granularity:
  - Default: per-chunk compression (stream-friendly).
- R3: Manifest adds optional `compression` field `{ algorithm, level }`.
- R4: storeFile and restoreFile support compression+encryption combination.
- R5: gzip implementation using zlib streams.

**Acceptance Criteria**
- AC1: store+restore with compression yields byte-identical original output.
- AC2: compression+encryption works together.
- AC3: For compressible input, compressed storage is smaller than uncompressed (within reason).

**Scope**
- In scope: gzip compression + schema update + tests.
- Out of scope: Brotli, custom compression plugins (future).

**Est. Complexity (LoC)**
- Prod: ~60
- Tests: ~40
- Total: ~100

**Est. Human Working Hours**
- ~5h

**Test Plan**
- Golden path:
  - compressible text file compress+restore round trip.
  - compress+encrypt+restore round trip.
- Failures:
  - corrupted compressed chunk fails restore (typed error).
- Edges:
  - incompressible data does not break; may grow slightly.
  - empty file with compression.
- Fuzz/stress:
  - random buffers at multiple sizes (seeded), ensure round-trip correctness.

**Definition of Done**
- DoD1: Compression pipeline implemented and documented.
- DoD2: Schema updated with optional compression field.
- DoD3: Tests cover plaintext + encrypted paths.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 2.1

---

## Task 7.2: KDF support (PBKDF2/scrypt)

**User Story**
As a developer, I want passphrase-based encryption using standard KDFs so I don't need to manage raw 32-byte keys.

**Requirements**
- R1: Add `CasService.deriveKey({ passphrase, salt, algorithm, iterations })`.
- R2: Support algorithms: pbkdf2, scrypt (Node built-ins).
- R3: Return `{ key: Buffer, salt: Buffer, params: object }`.
- R4: Manifest encryption metadata optionally includes `kdf` params.
- R5: storeFile/restoreFile can accept passphrase (derive key) instead of raw key.

**Acceptance Criteria**
- AC1: Passphrase store+restore succeeds and matches original content.
- AC2: Wrong passphrase fails restore with INTEGRITY_ERROR.
- AC3: Different salts yield different keys for same passphrase.

**Scope**
- In scope: KDF support + schema + tests.
- Out of scope: Argon2 (native dependency), formal KDF benchmarking.

**Est. Complexity (LoC)**
- Prod: ~50
- Tests: ~40
- Total: ~90

**Est. Human Working Hours**
- ~4h

**Test Plan**
- Golden path:
  - derive key with stored salt/params; restore succeeds.
- Failures:
  - wrong passphrase → decrypt fails INTEGRITY_ERROR.
- Edges:
  - ensure derived key validated by existing key length validation.
- Fuzz/stress:
  - run multiple passphrases and salts (seeded) ensure stability and no collisions in test space.

**Definition of Done**
- DoD1: deriveKey implemented for pbkdf2 and scrypt.
- DoD2: Manifest schema supports kdf metadata.
- DoD3: Passphrase workflow documented in SECURITY.md and API.md.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 1.3

---

## Task 7.3: Merkle tree manifests for very large files

**User Story**
As a developer storing extremely large files, I want manifests to scale by using a Merkle structure so the manifest itself doesn't become a bottleneck.

**Requirements**
- R1: Add manifest versioning: v1 flat vs v2 merkle.
- R2: When chunk count exceeds threshold (configurable), split into sub-manifests each referencing up to N chunks.
- R3: Root manifest references sub-manifest OIDs.
- R4: restoreFile and readManifest transparently handle both v1 and v2 manifests.
- R5: Backward compatibility: v2 code reads v1 manifests.

**Acceptance Criteria**
- AC1: Large simulated file produces v2 manifest structure.
- AC2: restore from v2 manifest matches original bytes.
- AC3: v1 manifest still restores successfully under v2 code.

**Scope**
- In scope: Merkle manifest implementation + schema versioning + tests.
- Out of scope: Parallel chunk reads, content-defined chunking (CDC).

**Est. Complexity (LoC)**
- Prod: ~100
- Tests: ~80
- Total: ~180

**Est. Human Working Hours**
- ~8h

**Test Plan**
- Golden path:
  - exceed threshold → store returns v2 manifest; restore succeeds.
  - backward compat: v1 manifest restore succeeds.
- Failures:
  - missing sub-manifest blob → typed failure.
- Edges:
  - exactly at threshold boundary uses v1 or v2 per spec (define and test).
- Fuzz/stress:
  - simulate 100k chunk references via generated sub-manifests and ensure traversal remains correct and bounded.

**Definition of Done**
- DoD1: Manifest versioning implemented and documented.
- DoD2: restoreFile/readManifest support both versions.
- DoD3: Tests cover v1/v2 + failure modes.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 2.1, Task 4.1
