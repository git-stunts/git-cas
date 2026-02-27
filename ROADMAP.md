# @git-stunts/cas — ROADMAP

Content-addressed storage backed by Git's object database (ODB), with optional encryption and pluggable codecs.

This roadmap is structured as:

1. **Header** — Platform, dependencies, supported environments
2. **Canonical CasError Codes** — Single registry of all error codes referenced by tasks
3. **Contracts** — Return/throw semantics for all public methods
4. **Version Plan** — Table mapping versions to milestones
5. **Milestone Dependency Graph** — ASCII diagram
6. **Milestones & Task Cards** — 5 milestones, 20 tasks (uniform task card template)
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
| `INVALID_KEY_TYPE` | Encryption key is not a Buffer. | v1.1.0 |
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

### `restoreStream({ manifest, encryptionKey?, passphrase? })` *(planned — Task 8.1)*
- **Returns:** `AsyncIterable<Buffer>` — verified, decrypted, decompressed chunks in index order.
- **Throws:** `CasError('INTEGRITY_ERROR')` if any chunk fails verification (iteration stops).
- **Throws:** `CasError('MISSING_KEY')` if encrypted and no key provided.
- **Memory:** O(chunkSize) — never buffers full file.

### `rotateKey({ manifest, oldKey, newKey, label? })` *(planned — Task 12.1)*
- **Returns:** `Promise<Manifest>` — updated manifest with re-wrapped DEK and incremented `keyVersion`.
- **Throws:** `CasError('DEK_UNWRAP_FAILED')` if `oldKey` cannot unwrap the DEK.
- **Throws:** `CasError('ROTATION_NOT_SUPPORTED')` if manifest uses legacy (non-envelope) encryption.
- **Side effects:** None. Caller must persist via `createTree()`.

### `addRecipient({ manifest, existingKey, newRecipientKey, label })` *(planned — Task 11.2)*
- **Returns:** `Promise<Manifest>` — updated manifest with additional recipient entry.
- **Throws:** `CasError('DEK_UNWRAP_FAILED')` if `existingKey` is wrong.
- **Throws:** `CasError('RECIPIENT_ALREADY_EXISTS')` if `label` already exists.
- **Side effects:** None. Caller must persist.

### `removeRecipient({ manifest, label })` *(planned — Task 11.2)*
- **Returns:** `Promise<Manifest>` — updated manifest without the named recipient.
- **Throws:** `CasError('RECIPIENT_NOT_FOUND')` if `label` not in recipient list.
- **Throws:** `CasError('CANNOT_REMOVE_LAST_RECIPIENT')` if only 1 recipient remains.

### CLI: `git cas verify --oid <tree-oid> | --slug <slug>` *(planned — Task 9.2)*
- **Output:** `ok` on success, `fail` on failure.
- **Exit 0:** All chunks verified.
- **Exit 1:** Verification failed or error.

### CLI: `git cas rotate --slug <slug> --old-key-file <path> --new-key-file <path>` *(planned — Task 12.3)*
- **Output:** New tree OID on success.
- **Exit 0:** Rotation succeeded, vault updated.
- **Exit 1:** Wrong old key, unsupported manifest, or vault error.

### CLI: `git cas vault dashboard` *(planned — Task 13.2)*
- **Output:** Interactive full-screen TUI in TTY mode; static table in non-TTY.
- **Exit 0:** User quit normally.
- **Exit 1:** Vault ref missing or error.

### CLI: `git cas inspect --slug <slug> | --oid <tree-oid> [--heatmap]` *(planned — Tasks 13.4, 13.5)*
- **Output:** Structured manifest anatomy view in TTY; JSON dump in non-TTY.
- **Exit 0:** Manifest read and displayed.
- **Exit 1:** Manifest not found or error.

### CLI: `git cas vault history --pretty` *(planned — Task 13.3)*
- **Output:** Color-coded timeline in TTY; plain `git log --oneline` without `--pretty`.
- **Exit 0:** History displayed.
- **Exit 1:** Vault ref missing or error.

---

## 4) Version Plan

| Version | Milestone | Codename | Theme | Status |
|--------:|-----------|----------|-------|--------|
| v2.1.0  | M8        | Spit Shine | Review fixups | |
| v2.2.0  | M9        | Cockpit  | CLI improvements | |
| v3.0.0  | M10       | Hydra    | Content-defined chunking | |
| v3.1.0  | M11       | Locksmith | Multi-recipient encryption | |
| v3.2.0  | M12       | Carousel | Key rotation | |
| v3.3.0  | M13       | Bijou    | TUI dashboard & progress | |

---

## 5) Milestone Dependency Graph

```text
M7 Horizon (v2.0.0) ✅ ──────────────────────────┐
  │                                               │
  ├──────┬──────────┐                              │
  v      v          v                              v
M8 Spit  M9 Cockpit  M10 Hydra (v3.0.0)   M11 Locksmith (v3.1.0)
Shine    (v2.2.0)       │                          │
(v2.1.0)   │            │                          v
           │            v                  M12 Carousel (v3.2.0)
           │     (CDC benchmarks)
           │
           v
    M13 Bijou (v3.3.0)
    (TUI dashboard & progress)
```

---

## 6) Milestones & Task Cards

### Milestones at a glance

| #  | Codename      | Theme                      | Version | Tasks | ~LoC   | ~Hours |
|---:|--------------|----------------------------|:-------:|------:|-------:|------:|
| M8 | Spit Shine    | Review fixups              | v2.1.0  | 3     | ~290   | ~7h   |
| M9 | Cockpit       | CLI improvements           | v2.2.0  | 5     | ~260   | ~7h   |
| M10| Hydra         | Content-defined chunking   | v3.0.0  | 4     | ~690   | ~22h  |
| M11| Locksmith     | Multi-recipient encryption | v3.1.0  | 4     | ~580   | ~20h  |
| M12| Carousel      | Key rotation               | v3.2.0  | 4     | ~400   | ~13h  |
| M13| Bijou         | TUI dashboard & progress   | v3.3.0  | 6     | ~650   | ~20h  |
|    | **Total**     |                            |         | **26**| **~2,870** | **~89h** |

---

# M8 — Spit Shine (v2.1.0)
**Theme:** Polish and harden based on code review findings. Fix asymmetries, eliminate duplication, improve docs. No new features.

---

## Task 8.1: Streaming restore

**User Story**
As a developer restoring large files, I want a streaming restore path so I don't buffer the entire file in memory.

**Requirements**
- R1: Add `CasService.restoreStream({ manifest, encryptionKey, passphrase })` returning `AsyncIterable<Buffer>`.
- R2: Each yielded buffer is one verified, decrypted, decompressed chunk — ready to write.
- R3: Integrity verified per-chunk before yield (not after full reassembly).
- R4: Decompression and decryption applied per-chunk in streaming fashion.
- R5: `restoreFile()` in the facade uses `restoreStream()` internally with `createWriteStream()` instead of `writeFileSync()`.
- R6: Existing `restore()` method remains unchanged (returns `{ buffer, bytesWritten }`) for backward compat.

**Acceptance Criteria**
- AC1: `restoreStream()` yields chunks that, when concatenated, match the original file byte-for-byte.
- AC2: Memory usage during streaming restore is O(chunkSize), not O(fileSize).
- AC3: `restoreFile()` writes via stream and does not call `writeFileSync()`.
- AC4: Encrypted + compressed files round-trip correctly via streaming restore.
- AC5: Existing `restore()` method behavior unchanged.

**Scope**
- In scope: `restoreStream()` on CasService + facade, refactor `restoreFile()` to use streaming writes.
- Out of scope: Parallel chunk reads, resume/partial restore, streaming decrypt rearchitecture.

**Est. Complexity (LoC)**
- Prod: ~60
- Tests: ~80
- Total: ~140

**Est. Human Working Hours**
- ~4h

**Test Plan**
- Golden path:
  - Store 10KB → restoreStream → collect → byte-compare original.
  - Store encrypted + compressed → restoreStream → collect → compare.
  - restoreFile writes correct file via streaming (spy confirms no writeFileSync).
- Failures:
  - Corrupted chunk mid-stream → throws INTEGRITY_ERROR, iteration stops.
  - Wrong key → throws INTEGRITY_ERROR on first encrypted chunk.
- Edges:
  - 0-byte manifest yields empty iterable.
  - Single-chunk file yields exactly 1 buffer.
  - Exact multiple of chunkSize yields expected count.
- Fuzz/stress:
  - 50 random file sizes (seeded) — streaming restore matches buffered restore byte-for-byte.
  - Memory profiling: restoreStream on 10MB file stays under 2× chunkSize peak.

**Definition of Done**
- DoD1: `restoreStream()` implemented on CasService and exposed via facade.
- DoD2: `restoreFile()` refactored to use streaming writes.
- DoD3: All existing restore tests still pass.
- DoD4: New streaming tests added and green.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

## Task 8.2: Extract shared crypto helpers to CryptoPort base class

**User Story**
As a maintainer, I want duplicated crypto helpers consolidated so changes to validation or metadata format are made in one place.

**Requirements**
- R1: Move key validation to `CryptoPort` as concrete `_validateKey(key)`. Adapters call `super._validateKey(key)` or inherit directly.
- R2: Move `buildMeta(nonce, tag)` to `CryptoPort` as concrete `_buildMeta(nonce, tag)`. Returns `{ algorithm: 'aes-256-gcm', nonce: string, tag: string, encrypted: true }`.
- R3: Move KDF parameter defaults to `CryptoPort.deriveKey()` as a concrete method that normalizes parameters, then calls abstract `_doDeriveKey(passphrase, salt, normalizedParams)` template method.
- R4: Remove `CasService._validateKey()` — service delegates to `crypto._validateKey()`.
- R5: All 3 adapters use inherited helpers. No behavioral change.

**Acceptance Criteria**
- AC1: `CryptoPort` has concrete `_validateKey()`, `_buildMeta()`, and `deriveKey()` methods.
- AC2: `NodeCryptoAdapter`, `BunCryptoAdapter`, `WebCryptoAdapter` no longer duplicate these methods.
- AC3: `CasService._validateKey()` is removed; key validation delegates to crypto port.
- AC4: All existing tests pass without modification (behavior unchanged).

**Scope**
- In scope: Refactor crypto helpers into base class + remove CasService duplication.
- Out of scope: Changing validation rules, adding new key types.

**Est. Complexity (LoC)**
- Prod: ~40 (add to base, remove from 4 sites)
- Tests: ~20 (base class unit tests)
- Total: ~60

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - All existing crypto round-trip tests pass unchanged.
  - All existing KDF tests pass unchanged.
- Failures:
  - Invalid key type/length still throws same CasError codes.
- Edges:
  - NodeCryptoAdapter strict Buffer validation still enforced (override `_validateKey` if needed).
- Fuzz/stress:
  - Run full existing crypto fuzz suite — no regressions.

**Definition of Done**
- DoD1: Shared helpers live on CryptoPort.
- DoD2: All duplicated code removed from adapters and CasService.
- DoD3: Full test suite green.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

## Task 8.3: README polish and architectural decision record

**User Story**
As a new user, I want the README to get me started quickly. As a contributor, I want to understand why vault lives in the facade.

**Requirements**
- R1: Add installation instructions to README.md (`npm install @git-stunts/git-cas @git-stunts/plumbing`).
- R2: Add links to GUIDE.md and API.md in README.md.
- R3: Add `docs/ADR-001-vault-in-facade.md` documenting the decision to place vault logic in `ContentAddressableStore` rather than `CasService`, including rationale, alternatives considered, and trade-offs.

**Acceptance Criteria**
- AC1: README contains install command.
- AC2: README links to GUIDE.md ("Getting Started") and API.md ("API Reference").
- AC3: ADR exists and explains the vault-in-facade decision with alternatives considered.

**Scope**
- In scope: README edits + ADR document.
- Out of scope: Full README rewrite, new documentation pages.

**Est. Complexity (LoC)**
- Prod: ~0
- Docs: ~90 (README edits ~30, ADR ~60)
- Total: ~90

**Est. Human Working Hours**
- ~1h

**Test Plan**
- Golden path:
  - Verify install command is correct by running it in a fresh project.
  - Verify links resolve to existing files.
- Failures:
  - Dead link in README → fix before merge.
- Edges:
  - None.
- Fuzz/stress:
  - None (documentation).

**Definition of Done**
- DoD1: README updated with install instructions and doc links.
- DoD2: ADR-001 created in `docs/` directory.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

# M9 — Cockpit (v2.2.0)
**Theme:** CLI polish — progress feedback, structured output, better errors, and new commands. Make the terminal experience match the API's capability.

---

## Task 9.1: CLI progress feedback

**User Story**
As a CLI user storing or restoring large files, I want visible progress so I know the operation is working and not hung.

**Requirements**
- R1: Wire `CasService` events (`chunk:stored`, `chunk:restored`, `file:stored`, `file:restored`) to CLI output.
- R2: Display a progress counter during store/restore: `Storing chunk 5/12…` or similar.
- R3: Progress output goes to stderr (stdout reserved for structured output).
- R4: Progress suppressed when stdout is not a TTY (piped mode) or when `--quiet` is passed.
- R5: Add `--quiet` global flag to suppress progress output.

**Acceptance Criteria**
- AC1: `git cas store` shows per-chunk progress on stderr in TTY mode.
- AC2: `git cas restore` shows per-chunk progress on stderr in TTY mode.
- AC3: Piped mode (`git cas store … | jq`) shows no progress.
- AC4: `--quiet` suppresses all progress output.

**Scope**
- In scope: Progress display for store and restore.
- Out of scope: Progress bars with ETA, spinners, color output, verbose debug logging.

**Est. Complexity (LoC)**
- Prod: ~50
- Tests: ~20
- Total: ~70

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - Store 3-chunk file in TTY mode → stderr shows 3 progress messages.
  - Restore → stderr shows 3 progress messages.
- Failures:
  - None expected (progress is best-effort, non-blocking).
- Edges:
  - 0-chunk file (empty) → no progress messages.
  - 1-chunk file → exactly 1 progress message.
  - Non-TTY mode → no progress on stderr.
  - `--quiet` → no progress on stderr.
- Fuzz/stress:
  - None (thin display layer).

**Definition of Done**
- DoD1: Progress feedback visible in CLI during store and restore.
- DoD2: `--quiet` flag implemented and functional.
- DoD3: Non-TTY detection works correctly.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

## Task 9.2: CLI `verify` command

**User Story**
As an operator, I want to verify stored asset integrity from the command line without restoring the file.

**Requirements**
- R1: Add `git cas verify` subcommand.
- R2: Accept `--oid <tree-oid>` or `--slug <slug>` (exactly one required, same mutual-exclusion validation as `restore`).
- R3: Read manifest from tree, call `verifyIntegrity(manifest)`.
- R4: Print `ok` and exit 0 on success. Print `fail` with details and exit 1 on failure.
- R5: Supports `--cwd` and `--json` (if Task 9.3 is complete) flags.

**Acceptance Criteria**
- AC1: Valid asset → prints `ok`, exits 0.
- AC2: Corrupted asset → prints `fail`, exits 1.
- AC3: Nonexistent OID/slug → prints error, exits 1.

**Scope**
- In scope: `verify` subcommand wired to existing `verifyIntegrity()`.
- Out of scope: Repair, per-chunk corruption report, re-verification against original file.

**Est. Complexity (LoC)**
- Prod: ~25
- Tests: ~15
- Total: ~40

**Est. Human Working Hours**
- ~1h

**Test Plan**
- Golden path:
  - Store file, verify via CLI → exit 0.
- Failures:
  - Verify with bad OID → exit 1.
  - Verify with both --slug and --oid → exit 1 (mutual exclusion).
  - Neither --slug nor --oid → exit 1.
- Edges:
  - 0-chunk manifest verifies successfully (vacuously true).
- Fuzz/stress:
  - None (thin wrapper over tested API).

**Definition of Done**
- DoD1: `verify` subcommand added and functional.
- DoD2: Unit tests cover pass and fail paths.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

## Task 9.3: CLI `--json` output mode

**User Story**
As a CI/CD pipeline author, I want structured JSON output from the CLI so I can parse results programmatically.

**Requirements**
- R1: Add `--json` global flag.
- R2: When `--json` is passed, all command output is valid JSON on stdout:
  - `store`: `{ "manifest": {...} }` or `{ "treeOid": "..." }` (with `--tree`).
  - `restore`: `{ "bytesWritten": N }`.
  - `verify`: `{ "ok": true|false, "slug": "...", "chunks": N }`.
  - `vault list`: `[{ "slug": "...", "treeOid": "..." }, ...]`.
  - `vault init`: `{ "commitOid": "..." }`.
  - `vault remove`: `{ "commitOid": "...", "removedTreeOid": "..." }`.
- R3: Errors in JSON mode: `{ "error": "...", "code": "..." }` on stderr with non-zero exit.
- R4: Non-JSON mode behavior unchanged.

**Acceptance Criteria**
- AC1: `git cas store --json …` outputs parseable JSON.
- AC2: `git cas vault list --json` outputs JSON array.
- AC3: `git cas store --json … | jq .treeOid` works end-to-end.
- AC4: Error in JSON mode is valid JSON with error and code fields.

**Scope**
- In scope: JSON output for all existing commands.
- Out of scope: NDJSON streaming, custom output format templates.

**Est. Complexity (LoC)**
- Prod: ~30
- Tests: ~20
- Total: ~50

**Est. Human Working Hours**
- ~1.5h

**Test Plan**
- Golden path:
  - Each command with `--json` → output is valid JSON (`JSON.parse` succeeds).
- Failures:
  - Error with `--json` → valid JSON error object.
- Edges:
  - Empty vault list → `[]`.
  - 0-byte store → valid JSON manifest with empty chunks array.
- Fuzz/stress:
  - None (formatting layer).

**Definition of Done**
- DoD1: All commands support `--json`.
- DoD2: Tests validate JSON output is parseable.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

## Task 9.4: CLI error handler DRY cleanup + actionable error messages

**User Story**
As a CLI user, I want error messages that suggest what to do next. As a maintainer, I want error handling to live in one place.

**Requirements**
- R1: Extract shared `runAction(fn)` wrapper that handles try/catch, stderr output, and `process.exit(1)`.
- R2: All 6 command actions use `runAction()` instead of inline try/catch.
- R3: Error messages include the CasError `code` when available: `error [INTEGRITY_ERROR]: message`.
- R4: Add actionable hints for common errors:
  - `MISSING_KEY` → "Provide --key-file or --vault-passphrase"
  - `MANIFEST_NOT_FOUND` → "Verify the tree OID contains a manifest"
  - `VAULT_ENTRY_NOT_FOUND` → "Run 'git cas vault list' to see available entries"
  - `VAULT_ENTRY_EXISTS` → "Use --force to overwrite"
  - `INTEGRITY_ERROR` → "Check that the correct key or passphrase was used"

**Acceptance Criteria**
- AC1: All command actions delegate to `runAction()`.
- AC2: Error output includes CasError code when present.
- AC3: At least 5 common errors include actionable hints.
- AC4: No behavioral change for non-error paths.

**Scope**
- In scope: Error handler extraction + actionable hints.
- Out of scope: Verbose/debug mode, error logging to file.

**Est. Complexity (LoC)**
- Prod: ~45
- Tests: ~0 (existing tests cover error paths; hints verified manually)
- Total: ~45

**Est. Human Working Hours**
- ~1h

**Test Plan**
- Golden path:
  - All existing CLI tests pass unchanged.
- Failures:
  - Trigger each hinted error → verify hint appears in stderr.
- Edges:
  - Non-CasError (e.g., ENOENT) → generic message, no hint.
- Fuzz/stress:
  - None.

**Definition of Done**
- DoD1: `runAction()` wrapper used by all commands.
- DoD2: Error output includes codes and hints.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

## Task 9.5: Vault list filtering and table formatting

**User Story**
As a user with many vault entries, I want to filter and scan the list quickly.

**Requirements**
- R1: Add `--filter <pattern>` option to `vault list`. Glob-style matching against slugs (e.g., `photos/*`, `*.bin`).
- R2: Default output is table-formatted (aligned columns) when stdout is a TTY. Header row: `SLUG  TREE OID`.
- R3: Pipe-friendly: tab-separated output when stdout is not a TTY (existing behavior preserved).
- R4: `--json` mode outputs filtered JSON array (if Task 9.3 is complete).

**Acceptance Criteria**
- AC1: `vault list --filter "photos/*"` shows only matching entries.
- AC2: TTY output shows aligned table with headers.
- AC3: Non-TTY output is tab-separated (backward compatible).

**Scope**
- In scope: Glob filtering + TTY-aware table formatting.
- Out of scope: Sort options, metadata columns (size, date), pagination.

**Est. Complexity (LoC)**
- Prod: ~35
- Tests: ~20
- Total: ~55

**Est. Human Working Hours**
- ~1.5h

**Test Plan**
- Golden path:
  - 5 entries, filter matches 2 → 2 shown.
  - TTY mode → table with headers.
- Failures:
  - No matches → empty output, exit 0.
  - Invalid glob syntax → exit 1 with error.
- Edges:
  - No `--filter` → show all (default behavior preserved).
  - Single entry → table still formatted correctly.
- Fuzz/stress:
  - None.

**Definition of Done**
- DoD1: `--filter` flag functional.
- DoD2: TTY-aware table formatting implemented.
- DoD3: Backward-compatible pipe behavior preserved.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None

---

# M10 — Hydra (v3.0.0)
**Theme:** Content-defined chunking for dramatically better dedup on versioned files. Fixed-size chunking invalidates every chunk after an edit; CDC limits the blast radius to 1–2 chunks. Major version bump for new chunking port and manifest metadata.

---

## Task 10.1: Buzhash rolling hash + CDC chunking engine

**User Story**
As a developer storing versioned files, I want content-defined chunk boundaries so incremental changes don't invalidate every chunk downstream of the edit point.

**Requirements**
- R1: Implement Buzhash rolling hash algorithm with a 256-entry random byte table (deterministic seed).
- R2: Implement CDC chunker that uses rolling hash to find chunk boundaries.
- R3: Configurable parameters: `minChunkSize` (default 64 KiB), `maxChunkSize` (default 1 MiB), `targetChunkSize` (default 256 KiB).
- R4: Chunk boundary determined when `hash & mask === 0`, where mask is derived from `targetChunkSize` (e.g., `targetChunkSize - 1` for power-of-2 targets).
- R5: Force boundary at `maxChunkSize` if no natural boundary found (prevent unbounded chunks).
- R6: Force minimum chunk size: never split below `minChunkSize` (prevent tiny chunks).
- R7: Deterministic: same input always produces same chunks regardless of runtime.
- R8: Streaming: operates on `AsyncIterable<Buffer>` with O(1) memory.

**Acceptance Criteria**
- AC1: CDC chunker produces variable-size chunks bounded by min/max.
- AC2: Identical input always produces identical chunks (deterministic).
- AC3: Inserting 10 bytes in the middle of a 1MB file changes only 1–2 chunks (not all downstream chunks).
- AC4: Average chunk size approximates `targetChunkSize`.
- AC5: No chunk smaller than `minChunkSize` (except final chunk of file).
- AC6: No chunk larger than `maxChunkSize`.

**Scope**
- In scope: Rolling hash + CDC chunker implementation + unit tests.
- Out of scope: Integration with CasService (Task 10.2), Rabin fingerprinting (Buzhash is simpler and sufficient), gear-based CDC.

**Est. Complexity (LoC)**
- Prod: ~200 (Buzhash table + rolling hash + CDC logic)
- Tests: ~150 (determinism, boundary detection, size bounds, dedup)
- Total: ~350

**Est. Human Working Hours**
- ~12h

**Test Plan**
- Golden path:
  - 1MB buffer → produces ~4 chunks (target 256KB).
  - Same buffer → same chunks every time.
  - Modify 10 bytes at offset 500KB → only 1–2 chunks differ vs. original.
- Failures:
  - minChunkSize > maxChunkSize → throws configuration error.
  - targetChunkSize outside [min, max] → throws.
- Edges:
  - File smaller than minChunkSize → single chunk.
  - File exactly maxChunkSize → single chunk.
  - All-zero file (degenerate hash behavior) → chunks bounded by max.
  - File = 1 byte → single chunk.
- Fuzz/stress:
  - 100 random buffers (1KB–10MB, seeded): verify all chunks satisfy min/max bounds.
  - Determinism: chunk same buffer 100 times, assert identical output.
  - Dedup test: insert/delete 1–100 bytes at random offsets, measure % of chunks unchanged (expect >80% for small edits).

**Definition of Done**
- DoD1: Buzhash + CDC chunker implemented as standalone module under `src/infrastructure/chunkers/`.
- DoD2: All boundary and determinism tests pass.
- DoD3: Performance: >100 MB/s throughput on chunking alone (no I/O).

**Blocking**
- Blocks: Task 10.2, Task 10.4

**Blocked By**
- Blocked by: None

---

## Task 10.2: ChunkingPort abstraction

**User Story**
As an architect, I want chunking strategy behind a port so fixed-size and CDC can be swapped without modifying the domain service.

**Requirements**
- R1: Add `src/ports/ChunkingPort.js` with abstract method `chunk(source: AsyncIterable<Buffer>): AsyncIterable<Buffer>`.
- R2: Implement `FixedChunker` adapter wrapping existing `_chunkAndStore` buffer-slicing logic.
- R3: Implement `CdcChunker` adapter wrapping Task 10.1's CDC engine.
- R4: `CasService` constructor accepts optional `chunker` port. Defaults to `FixedChunker(chunkSize)`.
- R5: Refactor `CasService._chunkAndStore()` to use the chunking port instead of inline buffer slicing.
- R6: `ContentAddressableStore` constructor accepts optional `chunking` config: `{ strategy: 'fixed' | 'cdc', …params }`.

**Acceptance Criteria**
- AC1: `CasService({ chunker: new CdcChunker(…) })` uses CDC.
- AC2: Default behavior (no chunker specified) is identical to current fixed-size chunking.
- AC3: All existing store/restore tests pass without modification.
- AC4: CDC chunker plugs in and produces valid manifests that restore correctly.

**Scope**
- In scope: Port + 2 adapters + CasService refactor + facade config.
- Out of scope: Additional chunking strategies, auto-detection of optimal strategy.

**Est. Complexity (LoC)**
- Prod: ~80 (port + 2 adapters + service refactor + facade config)
- Tests: ~40 (port contract tests, integration with both chunkers)
- Total: ~120

**Est. Human Working Hours**
- ~4h

**Test Plan**
- Golden path:
  - Store with FixedChunker → same behavior as before (byte-identical manifests).
  - Store with CdcChunker → valid manifest, restore succeeds.
- Failures:
  - Chunker that yields empty buffers → handled gracefully (skip empty).
- Edges:
  - Switch chunker between store and restore → restore still works (chunking strategy doesn't affect restore — chunks are self-describing via manifest).
- Fuzz/stress:
  - 50 random files stored with both chunkers → all restore correctly.

**Definition of Done**
- DoD1: ChunkingPort, FixedChunker, CdcChunker implemented.
- DoD2: CasService uses chunking port.
- DoD3: All existing tests pass (no regression).

**Blocking**
- Blocks: Task 10.3

**Blocked By**
- Blocked by: Task 10.1

---

## Task 10.3: CDC manifest metadata + backward compatibility

**User Story**
As a user, I want CDC manifests to record their chunking strategy so future tools can understand or reproduce the chunk boundaries.

**Requirements**
- R1: Add optional `chunking` field to ManifestSchema: `{ strategy: 'fixed' | 'cdc', params: { … } }`.
- R2: Fixed-size manifests omit the field (backward compatible with all existing manifests).
- R3: CDC manifests include `{ strategy: 'cdc', params: { target: N, min: N, max: N } }`.
- R4: `readManifest()` handles manifests with or without `chunking` field.
- R5: v1 and v2 manifests remain valid (no migration required).
- R6: Add `INVALID_CHUNKING_STRATEGY` error code for unrecognized strategies.

**Acceptance Criteria**
- AC1: CDC store produces manifest with `chunking` field.
- AC2: Fixed-size store produces manifests without `chunking` field (backward compatible).
- AC3: Old manifests (no `chunking` field) read correctly on new code.
- AC4: Unrecognized strategy in manifest throws `INVALID_CHUNKING_STRATEGY`.

**Scope**
- In scope: Schema extension, backward compat, error code.
- Out of scope: Migration tooling for old manifests, manifest version bump (chunking field is additive).

**Est. Complexity (LoC)**
- Prod: ~40 (schema + Manifest value object + error code)
- Tests: ~60 (round-trip, backward compat, unknown strategy)
- Total: ~100

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - CDC store → manifest includes `chunking.strategy === 'cdc'`.
  - Fixed store → manifest has no `chunking` field.
  - Read old manifest without `chunking` → works fine.
- Failures:
  - Manifest with `chunking.strategy === 'unknown'` → throws INVALID_CHUNKING_STRATEGY.
- Edges:
  - v1 manifest with compression + encryption + no chunking field → still valid.
  - v2 merkle manifest with CDC → both `subManifests` and `chunking` fields present.
- Fuzz/stress:
  - Generate 100 manifests with random valid/invalid chunking fields → validate schema behavior.

**Definition of Done**
- DoD1: ManifestSchema extended with optional chunking field.
- DoD2: Backward compatibility verified across v1/v2 manifests.
- DoD3: Error code registered and tested.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 10.2

---

## Task 10.4: CDC benchmarks + dedup efficiency comparison

**User Story**
As a maintainer, I want empirical data comparing CDC vs fixed chunking so I can document trade-offs and tune defaults.

**Requirements**
- R1: Add benchmark suite comparing fixed vs CDC chunking across file sizes (1MB, 10MB, 100MB).
- R2: Measure chunking throughput (MB/s) for both strategies.
- R3: Measure dedup efficiency: for a file modified by N random byte insertions, what % of chunks remain unchanged?
- R4: Output results as a comparison table (console).

**Acceptance Criteria**
- AC1: Benchmark suite runs without errors.
- AC2: CDC shows significantly better dedup for incrementally modified files (>80% chunk reuse for small edits vs. ~0% for fixed).
- AC3: CDC throughput is within 2× of fixed chunking (rolling hash overhead is bounded).

**Scope**
- In scope: Synthetic benchmarks with in-memory data.
- Out of scope: CI benchmark tracking, real-world file corpus, regression detection.

**Est. Complexity (LoC)**
- Prod: ~0
- Tests/Bench: ~120
- Total: ~120

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - Bench suite completes and prints results table.
- Failures:
  - N/A (benchmarks are informational).
- Edges:
  - Include 0-byte and 1-byte files in benchmark.
- Fuzz/stress:
  - Run 3 times; verify <20% variance in throughput measurements.

**Definition of Done**
- DoD1: Benchmark suite added to `test/benchmark/`.
- DoD2: Results documented in commit message or GUIDE.md addendum.
- DoD3: Default CDC parameters tuned based on results if needed.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 10.1

---

# M11 — Locksmith (v3.1.0)
**Theme:** Multi-recipient encryption via envelope encryption (DEK/KEK model). Each file is encrypted with a random Data Encryption Key; the DEK is wrapped per-recipient. Adding or removing access never re-encrypts the data.

---

## Task 11.1: Envelope encryption (DEK/KEK model)

**User Story**
As a team member, I want each file encrypted with a random data key so that access control is managed by wrapping that key, not by re-encrypting the file.

**Requirements**
- R1: On encrypted store, generate a random 32-byte Data Encryption Key (DEK).
- R2: Encrypt file content with the DEK using existing AES-256-GCM pipeline.
- R3: Wrap (encrypt) the DEK with each recipient's Key Encryption Key (KEK) using AES-256-GCM key-wrapping.
- R4: Store wrapped DEKs in manifest under `encryption.recipients: [{ label, wrappedDek, nonce, tag }]`.
- R5: On restore, caller provides their KEK; system tries each recipient entry, unwraps DEK, then decrypts content.
- R6: Single-recipient mode (existing behavior) remains a special case: 1 recipient, no label required.
- R7: Backward compatible: old manifests (direct key encryption, no `recipients` field) still restore correctly using the existing code path.

**Acceptance Criteria**
- AC1: Multi-recipient store → restore with any recipient's KEK succeeds.
- AC2: Restore with a non-recipient KEK throws `NO_MATCHING_RECIPIENT`.
- AC3: Old-style manifests (no `recipients` field) restore as before.
- AC4: DEK never appears in plaintext in the manifest.

**Scope**
- In scope: DEK/KEK model, wrap/unwrap, manifest schema changes, backward compat.
- Out of scope: Asymmetric KEKs (X25519), key exchange protocols, KMS integration, HSM support.

**Est. Complexity (LoC)**
- Prod: ~120 (envelope encrypt/decrypt + CasService changes + schema)
- Tests: ~100 (multi-recipient round-trip, wrong key, backward compat)
- Total: ~220

**Est. Human Working Hours**
- ~8h

**Test Plan**
- Golden path:
  - Store with 2 recipients → restore with recipient A → byte-compare original.
  - Store with 2 recipients → restore with recipient B → byte-compare original.
  - Single-recipient store → restore as before.
- Failures:
  - Restore with non-recipient key → NO_MATCHING_RECIPIENT.
  - Tampered wrappedDek → DEK_UNWRAP_FAILED.
- Edges:
  - 1 recipient (degenerate multi-recipient = current behavior).
  - 10 recipients → all can restore.
  - Old manifest without recipients field → restore unchanged.
- Fuzz/stress:
  - 50 random plaintexts × 3 random KEKs → all round-trip correctly.
  - Tamper each recipient entry independently → correct error for each.

**Definition of Done**
- DoD1: Envelope encryption implemented in CasService.
- DoD2: Schema updated with recipients field.
- DoD3: Backward compatibility tested with v1/v2 manifests.
- DoD4: Security design documented in SECURITY.md addendum.

**Blocking**
- Blocks: Task 11.2, Task 11.4, Task 12.1

**Blocked By**
- Blocked by: None

---

## Task 11.2: Recipient management API

**User Story**
As a developer, I want to add and remove recipients from an existing encrypted asset without re-encrypting the data.

**Requirements**
- R1: Add `CasService.addRecipient({ manifest, existingKey, newRecipientKey, label })`.
  - Unwrap DEK with `existingKey`, re-wrap with `newRecipientKey`, append to recipients list.
  - Return updated Manifest (new value object — manifests are immutable).
- R2: Add `CasService.removeRecipient({ manifest, label })`.
  - Remove recipient entry by label.
  - Return updated Manifest.
- R3: Removing last recipient throws `CasError('CANNOT_REMOVE_LAST_RECIPIENT')`.
- R4: Adding duplicate label throws `CasError('RECIPIENT_ALREADY_EXISTS')`.
- R5: Updated manifest must be re-persisted (`createTree` + vault update) by the caller.

**Acceptance Criteria**
- AC1: addRecipient → new manifest has additional recipient entry.
- AC2: removeRecipient → manifest has one fewer recipient entry.
- AC3: Data is never re-encrypted (only DEK is re-wrapped).
- AC4: All existing recipients can still restore after addRecipient.

**Scope**
- In scope: Add/remove recipient methods + manifest mutation + validation.
- Out of scope: Batch operations, per-recipient permissions, key escrow.

**Est. Complexity (LoC)**
- Prod: ~100 (add/remove methods + validation)
- Tests: ~80 (add, remove, edge cases, round-trips)
- Total: ~180

**Est. Human Working Hours**
- ~6h

**Test Plan**
- Golden path:
  - Store with 1 recipient → addRecipient → both can restore.
  - Store with 2 recipients → removeRecipient → remaining recipient restores.
- Failures:
  - addRecipient with wrong existingKey → DEK_UNWRAP_FAILED.
  - Add duplicate label → RECIPIENT_ALREADY_EXISTS.
  - Remove last recipient → CANNOT_REMOVE_LAST_RECIPIENT.
  - Remove nonexistent label → RECIPIENT_NOT_FOUND.
- Edges:
  - Add 100 recipients → all can restore.
  - Remove all but 1 → that 1 still works.
- Fuzz/stress:
  - Repeatedly add/remove recipients (100 cycles) → final recipient set is correct.

**Definition of Done**
- DoD1: addRecipient and removeRecipient implemented and exposed via facade.
- DoD2: Edge cases tested.
- DoD3: API documented in API.md.

**Blocking**
- Blocks: Task 11.4

**Blocked By**
- Blocked by: Task 11.1

---

## Task 11.3: Manifest schema for multi-recipient metadata

**User Story**
As a maintainer, I want the multi-recipient manifest structure validated by Zod schema so malformed recipient entries are caught early.

**Requirements**
- R1: Add `RecipientSchema` to ManifestSchema.js: `{ label: string, wrappedDek: base64 string, nonce: base64 string, tag: base64 string, kekType?: string }`.
- R2: Extend `EncryptionSchema` with optional `recipients: z.array(RecipientSchema)`.
- R3: Existing encryption metadata (nonce, tag on the outer level) represents the DEK encryption of the file content.
- R4: Validate: if `recipients` is present and non-empty, at least one entry must exist.
- R5: Register error codes: `NO_MATCHING_RECIPIENT`, `DEK_UNWRAP_FAILED`, `RECIPIENT_NOT_FOUND`, `RECIPIENT_ALREADY_EXISTS`, `CANNOT_REMOVE_LAST_RECIPIENT`.

**Acceptance Criteria**
- AC1: Manifest with valid recipients passes schema validation.
- AC2: Manifest with malformed recipient (missing label, bad wrappedDek) fails validation.
- AC3: Manifest without recipients field passes (backward compat).

**Scope**
- In scope: Schema definitions + error code registration.
- Out of scope: Runtime encryption logic (covered by Tasks 11.1 and 11.2).

**Est. Complexity (LoC)**
- Prod: ~40 (schema definitions)
- Tests: ~50 (schema validation positive/negative)
- Total: ~90

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - Valid manifest with 2 recipients → schema passes.
- Failures:
  - Missing label → schema rejects.
  - Missing wrappedDek → schema rejects.
  - Non-string wrappedDek → schema rejects.
- Edges:
  - Empty recipients array → passes schema (runtime validates separately).
  - Recipients with unknown extra fields → stripped by schema.
- Fuzz/stress:
  - 100 random malformed recipient objects → all correctly rejected.

**Definition of Done**
- DoD1: RecipientSchema and error codes added.
- DoD2: Schema tests cover positive and negative paths.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: None (can be done in parallel with Task 11.1)

---

## Task 11.4: CLI multi-recipient support

**User Story**
As a CLI user, I want to encrypt assets for multiple recipients and manage the recipient list from the terminal.

**Requirements**
- R1: Add `--recipient <label:keyfile>` repeatable flag to `git cas store`. Each occurrence adds a recipient KEK.
- R2: Add `git cas recipient add <slug> --label <label> --key-file <path> --existing-key-file <path>`.
- R3: Add `git cas recipient remove <slug> --label <label>`.
- R4: Add `git cas recipient list <slug>` — shows recipient labels.
- R5: `git cas restore --key-file <path>` automatically scans recipient list for a matching KEK.

**Acceptance Criteria**
- AC1: Store with 2 `--recipient` flags → manifest has 2 recipients.
- AC2: `recipient add` → manifest updated in vault (new tree OID committed).
- AC3: `recipient remove` → manifest updated in vault.
- AC4: `recipient list` → shows labels.
- AC5: Restore with any recipient's key file → succeeds.

**Scope**
- In scope: CLI commands for multi-recipient workflows.
- Out of scope: Passphrase-based recipients (key-file only), interactive key generation.

**Est. Complexity (LoC)**
- Prod: ~60 (new subcommands + flag handling)
- Tests: ~30
- Total: ~90

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - Store with 2 recipients → restore with each → success.
  - Add recipient → restore with new key → success.
  - Remove recipient → restore with removed key → fails.
  - List → shows expected labels.
- Failures:
  - Add with wrong existing key → exit 1.
  - Remove last recipient → exit 1 with CANNOT_REMOVE_LAST_RECIPIENT.
- Edges:
  - Single recipient via CLI → same as current behavior.
- Fuzz/stress:
  - None (thin CLI wrapper over tested API).

**Definition of Done**
- DoD1: Multi-recipient CLI commands implemented.
- DoD2: Full CLI round-trip tested.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 11.2

---

# M12 — Carousel (v3.2.0)
**Theme:** Key rotation without re-encrypting data. The DEK/KEK model from M11 makes this possible — rotating a key means re-wrapping the DEK, not re-encrypting blobs. Includes vault-level rotation for changing the master passphrase.

---

## Task 12.1: Key rotation workflow

**User Story**
As an operator, I want to rotate encryption keys without re-encrypting the actual data, so key compromise doesn't require re-storing all assets.

**Requirements**
- R1: Add `CasService.rotateKey({ manifest, oldKey, newKey, label? })`.
- R2: Unwrap DEK using `oldKey`, re-wrap with `newKey`, update recipient entry (or all entries if no label specified).
- R3: Return updated Manifest. Caller must persist via `createTree()` + vault update.
- R4: Data blobs are never re-read or re-encrypted — only the DEK wrapping changes.
- R5: Track rotation with `keyVersion` counter in manifest encryption metadata.
- R6: If the manifest uses legacy (non-envelope) encryption, throw `ROTATION_NOT_SUPPORTED` with hint to re-store using envelope encryption.

**Acceptance Criteria**
- AC1: rotateKey → restore with new key succeeds, old key fails.
- AC2: `keyVersion` increments after rotation.
- AC3: Data blobs are never accessed during rotation (spy: zero readBlob calls).
- AC4: Legacy manifest → `ROTATION_NOT_SUPPORTED` error.

**Scope**
- In scope: Key rotation method + key version tracking.
- Out of scope: Automatic vault-wide rotation (Task 12.4), key version history/audit log, scheduled rotation policies.

**Est. Complexity (LoC)**
- Prod: ~80 (rotation logic + version tracking)
- Tests: ~60 (round-trip, old-key-fails, version increment, legacy error)
- Total: ~140

**Est. Human Working Hours**
- ~5h

**Test Plan**
- Golden path:
  - Store → rotateKey → restore with new key → byte-compare original.
  - Verify old key no longer works after rotation.
  - Verify keyVersion incremented.
- Failures:
  - rotateKey with wrong oldKey → DEK_UNWRAP_FAILED.
  - rotateKey on legacy manifest → ROTATION_NOT_SUPPORTED.
- Edges:
  - Rotate twice → keyVersion = 2, both old keys fail.
  - Rotate with label → only that recipient updated, others unchanged.
- Fuzz/stress:
  - 20 sequential rotations → final key works, all 19 previous keys fail, keyVersion = 20.

**Definition of Done**
- DoD1: rotateKey implemented and exposed via facade.
- DoD2: keyVersion tracking in manifest.
- DoD3: Legacy manifest guard in place.
- DoD4: Security implications documented in SECURITY.md.

**Blocking**
- Blocks: Task 12.3, Task 12.4

**Blocked By**
- Blocked by: Task 11.1

---

## Task 12.2: Key version tracking in manifest

**User Story**
As a security auditor, I want to see which key version was used for each recipient so I can verify rotation compliance.

**Requirements**
- R1: Add `keyVersion` field (non-negative integer, default 0) to manifest `encryption` metadata.
- R2: Each recipient entry carries `keyVersion` indicating which KEK version was used to wrap the DEK.
- R3: `rotateKey()` increments manifest-level `keyVersion` and updates the rotated recipient's `keyVersion`.
- R4: Extend ManifestSchema `EncryptionSchema` to include optional `keyVersion` field.
- R5: Old manifests without `keyVersion` treated as version 0 (backward compatible).

**Acceptance Criteria**
- AC1: New manifests include `keyVersion: 0` by default (or omit for backward compat).
- AC2: After rotation, manifest `keyVersion` increments.
- AC3: Each recipient's `keyVersion` reflects when their wrapping was last updated.
- AC4: Old manifests without `keyVersion` read correctly (treated as 0).

**Scope**
- In scope: Schema extension + version tracking logic.
- Out of scope: Version history/audit log, policy enforcement (e.g., "rotate after N days"), automated compliance checks.

**Est. Complexity (LoC)**
- Prod: ~30 (schema + version logic in rotateKey)
- Tests: ~40 (version increment, backward compat, per-recipient version)
- Total: ~70

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - Store → keyVersion 0. Rotate → keyVersion 1.
- Failures:
  - Manually set negative keyVersion → schema rejects.
- Edges:
  - Old manifest with no keyVersion → treated as 0.
  - Multi-recipient: rotate one recipient → only that recipient's keyVersion changes.
- Fuzz/stress:
  - 100 sequential version increments → correct final version value.

**Definition of Done**
- DoD1: keyVersion in schema and runtime.
- DoD2: Version tracking tested.
- DoD3: Backward compatibility verified.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 11.1 (needs recipients in schema)

---

## Task 12.3: CLI key rotation commands

**User Story**
As an operator, I want to rotate keys from the command line so I can perform routine key maintenance without writing scripts.

**Requirements**
- R1: Add `git cas rotate --slug <slug> --old-key-file <path> --new-key-file <path> [--label <label>]`.
- R2: Reads manifest from vault, calls `rotateKey()`, persists updated manifest (createTree + vault update with `--force`).
- R3: Prints new tree OID on success.
- R4: Add `--oid <tree-oid>` as alternative to `--slug` (prints updated manifest, doesn't touch vault).

**Acceptance Criteria**
- AC1: `git cas rotate --slug myfile --old-key-file old.key --new-key-file new.key` → vault updated.
- AC2: Subsequent restore with new key succeeds; old key fails.
- AC3: keyVersion printed or included in JSON output.

**Scope**
- In scope: `rotate` CLI command.
- Out of scope: Interactive key generation, passphrase-based rotation (use `vault rotate` for that).

**Est. Complexity (LoC)**
- Prod: ~50 (new subcommand)
- Tests: ~30
- Total: ~80

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - Store → rotate via CLI → restore with new key → success.
- Failures:
  - Wrong old key → exit 1 with DEK_UNWRAP_FAILED.
  - Legacy (non-envelope) manifest → exit 1 with ROTATION_NOT_SUPPORTED.
- Edges:
  - Rotate with --label → only named recipient updated.
- Fuzz/stress:
  - None (thin wrapper over tested API).

**Definition of Done**
- DoD1: `rotate` command added.
- DoD2: Full CLI round-trip tested.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 12.1

---

## Task 12.4: Vault-level key rotation

**User Story**
As an operator, I want to rotate the vault passphrase so a compromised passphrase can be revoked without re-storing all assets.

**Requirements**
- R1: Add `ContentAddressableStore.rotateVaultPassphrase({ oldPassphrase, newPassphrase, kdfOptions? })`.
- R2: Derive old KEK from `oldPassphrase` + stored KDF params. Derive new KEK from `newPassphrase` (new salt, optionally new algorithm).
- R3: For each vault entry with envelope encryption: unwrap DEK with old KEK, re-wrap with new KEK.
- R4: Update vault metadata with new KDF params (new salt, potentially new algorithm/iterations).
- R5: Atomic: all entries rotated in a single vault commit. CAS retry on conflict.
- R6: Add `git cas vault rotate --old-passphrase <old> --new-passphrase <new> [--algorithm <alg>]` CLI command.

**Acceptance Criteria**
- AC1: After rotation, all entries restorable with new passphrase.
- AC2: Old passphrase no longer works for any entry.
- AC3: Vault metadata updated with new KDF params.
- AC4: Atomic: partial rotation never committed (all-or-nothing).

**Scope**
- In scope: Vault-level rotation API + CLI command.
- Out of scope: Per-entry passphrase rotation (use Task 12.1), online rotation (vault is locked during rotation), rollback on failure.

**Est. Complexity (LoC)**
- Prod: ~60 (rotation logic + CLI command)
- Tests: ~50 (round-trip, atomicity, backward compat)
- Total: ~110

**Est. Human Working Hours**
- ~4h

**Test Plan**
- Golden path:
  - Init vault with passphrase A → store 3 entries → rotate to passphrase B → restore all 3 with B.
- Failures:
  - Wrong old passphrase → exit 1 with DEK_UNWRAP_FAILED.
  - Concurrent vault update during rotation → CAS retry or VAULT_CONFLICT.
- Edges:
  - Vault with no encrypted entries → metadata updated, no DEK rotation needed.
  - Vault with 1 entry → atomic commit with single rotation.
- Fuzz/stress:
  - Rotate 10 times sequentially → final passphrase works, all 9 prior fail.

**Definition of Done**
- DoD1: Vault rotation implemented and exposed via facade.
- DoD2: CLI command added.
- DoD3: Atomicity verified (no partial rotations).
- DoD4: SECURITY.md updated with vault rotation guidance.

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
| Content-defined chunking (CDC) | ❌ | 🗓 M10 Hydra | ❌ | ❌ | ✅ Rabin fingerprint, 512K–8M | ❌ | ❌ | Sub-file dedup on versioned data | Only Restic offers this today; dramatically better dedup | Buzhash engine + ChunkingPort. ~350 LoC, ~12h (Task 10.1) |
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
| Multi-recipient encryption | ❌ | 🗓 M11 Locksmith | ❌ | ✅ Multiple GPG keys | ✅ Multiple passwords | ✅ Multiple X25519 | ❌ | Team access without sharing a single key | Envelope encryption (DEK/KEK model). ~220 LoC, ~8h (Task 11.1) | DEK/KEK model + recipient management. ~580 LoC total, ~20h (M11) |
| Key rotation (no re-encrypt) | ❌ | 🗓 M12 Carousel | N/A | ⚠️ Can add keys; revoke requires re-encrypt | ✅ Re-wrap master key | ❌ | N/A | Respond to key compromise without re-storing data | Requires DEK/KEK model. Re-wraps DEK, data blobs untouched | Depends on M11. rotateKey + vault rotation. ~400 LoC, ~13h (M12) |
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
| Streaming restore (O(1) memory) | ❌ Buffers in memory | 🗓 M8 Spit Shine | ⚠️ | ✅ | ✅ | ✅ | ❌ | Restore large files without OOM | Current restore() buffers entire file. Asymmetry with store path | restoreStream() + restoreFile refactor. ~140 LoC, ~4h (Task 8.1) |
| Partial restore / byte-range | ❌ | ❌ | ❌ | ⚠️ Per-chunk retrieval | ✅ FUSE mount | ❌ | ❌ | Extract byte ranges without restoring full file | Manifest has chunk offsets; byte-range index is feasible | Chunk offset index + range API. ~200 LoC, ~10h. Low priority |

---

### Manifests & Indexing

| Feature | git-cas v2.0 | Planned | Git LFS | git-annex | Restic | Age | DVC | Use Case | Remarks | What it would take |
|---|---|---|---|---|---|---|---|---|---|---|
| Manifest / index format | ✅ JSON or CBOR | — | Pointer files (text) | Symlinks + location log | JSON index (encrypted) | Binary header | YAML .dvc files | Describe stored assets for retrieval | git-cas is unique in offering codec choice (JSON for humans, CBOR for perf) | — |
| Codec pluggability | ✅ JsonCodec, CborCodec | — | ❌ | ❌ | ❌ | ❌ | ❌ | Choose manifest format per use case | Extensible via CodecPort. No other tool offers this | — |
| Merkle tree manifests | ✅ v2 auto-split | — | ❌ | ❌ | ❌ | ❌ | ❌ | Scale manifests for millions of chunks | Auto-splits at threshold (default 1000). Transparent reconstitution | — |
| Vault / ref-based indexing | ✅ refs/cas/vault | — | ❌ | ✅ git-annex branch | ❌ | ❌ | ❌ | GC-safe asset index that survives `git gc` | CAS semantics with retry. Unique among Git-native tools | — |
| Manifest versioning | ✅ v1 flat, v2 Merkle | 🗓 M10 adds chunking field | Pointer v1 only | ❌ | ❌ | ❌ | ❌ | Evolve format without breaking old manifests | Full backward compat: v2 code reads v1 manifests | Additive schema fields for CDC metadata (Task 10.3) |

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
| Progress events (structured) | ✅ EventEmitter (7 events) | — | ✅ Transfer protocol | ⚠️ Terminal bars | ✅ JSON Lines | ❌ | ⚠️ Terminal bars | Build progress bars, logging, monitoring | git-cas emits typed object payloads per chunk | — |
| CLI progress feedback | ❌ Silent | 🗓 M9 Cockpit | ✅ | ✅ | ✅ | ❌ | ✅ | Users know operations are working | Events exist but CLI doesn't display them | Wire events to stderr counter. ~70 LoC, ~2h (Task 9.1) |
| Structured output (--json) | ❌ | 🗓 M9 Cockpit | ❌ | ❌ | ✅ `--json` | ❌ | ✅ `--json` | CI/CD pipeline integration | Restic is the gold standard here (JSON Lines for all output) | Global `--json` flag. ~50 LoC, ~1.5h (Task 9.3) |
| CLI `verify` command | ❌ API only | 🗓 M9 Cockpit | ✅ Implicit on checkout | ✅ `annex fsck` | ✅ `restic check` | ❌ | ✅ `dvc check-ignore` | Audit integrity without restoring | API exists (`verifyIntegrity`); CLI just needs to expose it | 25 LoC, ~1h (Task 9.2) |
| Actionable error messages | ❌ Generic `err.message` | 🗓 M9 Cockpit | ⚠️ | ⚠️ | ✅ | ❌ | ✅ | Users know what went wrong and what to do next | Error codes exist but CLI doesn't show hints | Error handler + hint map. ~45 LoC, ~1h (Task 9.4) |

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
| **Weakest at** | No multi-backend, single-key encryption, gzip only | No encryption, no compression, requires server | Complexity, Haskell-only, no CDC | No Git integration, no library API | Not a storage system | No encryption, no chunking, no streaming |
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

1. **Multi-recipient encryption** → M11 Locksmith (v3.1.0). DEK/KEK envelope encryption. ~580 LoC, ~20h.
2. **Content-defined chunking** → M10 Hydra (v3.0.0). Buzhash CDC engine + ChunkingPort. ~690 LoC, ~22h.
3. **Key rotation** → M12 Carousel (v3.2.0). Re-wrap DEK without re-encrypting data. ~400 LoC, ~13h.
4. **Streaming restore** → M8 Spit Shine (v2.1.0). restoreStream() returning AsyncIterable. ~140 LoC, ~4h.
5. **CLI polish** → M9 Cockpit (v2.2.0). Progress, verify, --json, actionable errors. ~260 LoC, ~7h.
6. **Multi-backend storage** → Not planned. Git remotes serve as the transport layer by design. Adding S3/SFTP backends would dilute the "Git-native" identity.
7. **Compression algorithm selection** → Not on roadmap. CompressionPort + zstd adapter would cost ~120 LoC, ~6h. Medium priority.
8. **FUSE mount / partial restore** → Not planned. Niche for a CAS library. Would require ~500 LoC + platform-specific bindings.

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

# M13 — Bijou (v3.3.0)
**Theme:** Beautiful terminal UI powered by `@flyingrobots/bijou`. Replace silent CLI operations with animated progress, and add an interactive vault dashboard for exploring stored assets. Depends on M9 Cockpit for the `--quiet` flag and event wiring foundation.

---

## Task 13.1: Animated store/restore progress

**User Story**
As a CLI user, I want a smooth animated progress bar with chunk counts and throughput when storing or restoring files, so I can see that the operation is working and estimate time remaining.

**Requirements**
- R1: Add `@flyingrobots/bijou` and `@flyingrobots/bijou-node` as dependencies.
- R2: Wire `CasService` events (`chunk:stored`, `chunk:restored`) to a bijou `createAnimatedProgressBar()` with spring physics (preset: `gentle`).
- R3: Display gradient progress bar (theme `CYAN_MAGENTA`) with chunk counter (`78/193 chunks`) and throughput (`19.2 MiB/s`).
- R4: Show last-processed chunk digest and blob OID below the progress bar.
- R5: Progress renders to stderr; stdout reserved for structured output.
- R6: Graceful degradation: static counter in CI, plain text in pipe mode, no output with `--quiet`.

**Acceptance Criteria**
- AC1: `git cas store` shows animated progress bar in TTY mode.
- AC2: `git cas restore` shows animated progress bar in TTY mode.
- AC3: CI mode (`CI=true`) falls back to static line-by-line progress.
- AC4: Pipe mode shows no progress output.
- AC5: `--quiet` suppresses all progress.

**Scope**
- In scope: Progress bar for store and restore commands.
- Out of scope: Full TUI app, interactive elements, vault commands.

**Est. Complexity (LoC)**
- Prod: ~80
- Tests: ~30
- Total: ~110

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - Store 5-chunk file → progress bar advances 5 times, final state shows 100%.
  - Restore 5-chunk file → same.
- Edges:
  - 0-chunk file (empty) → no progress bar shown.
  - 1-chunk file → bar jumps to 100%.
  - Non-TTY → static fallback or silent.

**Definition of Done**
- DoD1: Animated progress bar visible during store/restore in interactive terminals.
- DoD2: Graceful degradation works across all four output modes.
- DoD3: No visual artifacts or leftover ANSI codes in non-TTY environments.

**Blocking**
- Blocks: Task 13.2 (vault dashboard uses same bijou dependency)

**Blocked By**
- Blocked by: Task 9.1 (CLI progress feedback foundation, `--quiet` flag)

---

## Task 13.2: Vault dashboard — interactive TUI app

**User Story**
As a developer managing multiple vault entries, I want an interactive terminal dashboard to browse entries, inspect manifests, and view encryption status without memorizing CLI flags.

**Requirements**
- R1: Add `@flyingrobots/bijou-tui` as a dependency.
- R2: New subcommand: `git cas vault dashboard` (or `git cas vault ui`).
- R3: Full-screen TEA app with flexbox layout: entry list (left pane) + detail view (right pane).
- R4: Entry list shows slug, size (human-readable), chunk count, and badges for encryption/compression/merkle.
- R5: Detail view shows manifest anatomy: metadata, encryption config, compression, sub-manifests, and paginated chunk list.
- R6: Keyboard navigation: `j/k` or arrows to move, `enter` to expand, `/` to filter, `q` to quit.
- R7: Vault-level header showing encryption status, asset count, and vault ref.
- R8: Graceful degradation: static table output in CI/pipe mode (reuse Task 9.5 table formatting).

**Acceptance Criteria**
- AC1: `git cas vault dashboard` launches interactive TUI in TTY mode.
- AC2: All vault entries listed with correct metadata.
- AC3: Selecting an entry shows full manifest detail.
- AC4: Filter narrows the list by slug substring.
- AC5: `q` or `ctrl-c` exits cleanly (restores terminal state).
- AC6: Non-TTY falls back to static vault list.

**Scope**
- In scope: Read-only dashboard for browsing vault state.
- Out of scope: Mutating operations (store/restore/remove) from the dashboard.

**Est. Complexity (LoC)**
- Prod: ~200
- Tests: ~60
- Total: ~260

**Est. Human Working Hours**
- ~7h

**Test Plan**
- Golden path:
  - Launch with 3 vault entries → all listed with correct badges.
  - Select entry → detail pane populates with manifest data.
  - Filter by substring → list narrows correctly.
- Edges:
  - Empty vault → shows "No entries" message.
  - Entry with Merkle sub-manifests → sub-manifest section rendered.
  - Very long slug names → truncated with ellipsis.
- Failures:
  - Vault ref doesn't exist → shows initialization prompt.

**Definition of Done**
- DoD1: Interactive dashboard launches and renders vault state.
- DoD2: Navigation, selection, and filtering work.
- DoD3: Clean exit restores terminal state.
- DoD4: Static fallback works in non-TTY.

**Blocking**
- Blocks: Task 13.4, Task 13.5

**Blocked By**
- Blocked by: Task 13.1 (bijou dependency), Task 9.5 (vault table formatting)

---

## Task 13.3: Vault history timeline view

**User Story**
As a developer, I want to see vault commit history as a visual timeline so I can understand how the vault has evolved over time.

**Requirements**
- R1: New subcommand: `git cas vault history --pretty` (or integrate into dashboard as a tab).
- R2: Render vault commits using bijou `timeline()` component with status indicators.
- R3: Color-code by operation: green for `add`, yellow for `update`, red for `remove`, blue for `init`.
- R4: Show commit OID (short), operation, slug, and relative timestamp.
- R5: Paginate with bijou `paginator()` for long histories.
- R6: Static fallback: plain `git log --oneline` output (current behavior).

**Acceptance Criteria**
- AC1: `git cas vault history --pretty` renders color-coded timeline in TTY mode.
- AC2: Operations correctly color-coded by parsing commit messages.
- AC3: Pagination works for vaults with >20 commits.
- AC4: Without `--pretty`, behavior unchanged (backward compatible).

**Scope**
- In scope: Timeline rendering of vault history.
- Out of scope: Interactive revert, diff between history points.

**Est. Complexity (LoC)**
- Prod: ~60
- Tests: ~25
- Total: ~85

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - Vault with 5 commits → 5 timeline entries, correctly colored.
- Edges:
  - Empty vault (no commits) → "No history" message.
  - 100+ commits → paginated display.

**Definition of Done**
- DoD1: Timeline renders with color-coded operations.
- DoD2: Pagination functional.
- DoD3: `--pretty` flag documented in `--help`.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 13.1 (bijou dependency)

---

## Task 13.4: Manifest anatomy view

**User Story**
As a developer debugging storage issues, I want a rich visual breakdown of a manifest showing its structure, encryption metadata, compression settings, and chunk layout.

**Requirements**
- R1: New subcommand: `git cas inspect --slug <slug>` (or `--oid <tree-oid>`).
- R2: Render manifest using bijou `box()`, `accordion()`, and `tree()` components.
- R3: Sections: metadata (slug, filename, size, version), encryption (algorithm, KDF params), compression, sub-manifests (if Merkle), and chunks.
- R4: Chunks section uses `paginator()` — show 20 chunks per page with index, size, digest (truncated), and blob OID.
- R5: Badges for encryption status, compression, Merkle, manifest version.
- R6: Static fallback: JSON dump (current `readManifest` behavior).

**Acceptance Criteria**
- AC1: `git cas inspect --slug <slug>` renders structured manifest view.
- AC2: Accordion sections expand/collapse.
- AC3: Chunk pagination works.
- AC4: Encrypted manifests show full KDF parameter breakdown.
- AC5: Merkle manifests show sub-manifest tree.

**Scope**
- In scope: Read-only manifest inspection.
- Out of scope: Editing manifests, verifying integrity (that's `git cas verify`).

**Est. Complexity (LoC)**
- Prod: ~70
- Tests: ~30
- Total: ~100

**Est. Human Working Hours**
- ~3h

**Test Plan**
- Golden path:
  - Inspect unencrypted v1 manifest → metadata + chunks displayed.
  - Inspect encrypted v2 Merkle manifest → all sections populated.
- Edges:
  - Empty manifest (0 chunks) → shows "No chunks" in chunks section.
  - Very large manifest (1000+ chunks) → pagination handles cleanly.

**Definition of Done**
- DoD1: Manifest anatomy renders with all sections.
- DoD2: Accordion expand/collapse works.
- DoD3: Chunk pagination works.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 13.2 (shared component patterns)

---

## Task 13.5: Chunk heatmap visualization

**User Story**
As a developer, I want a visual block map of chunks in a stored file so I can quickly see the storage layout, Merkle boundaries, and progress during operations.

**Requirements**
- R1: Render a grid of `█` / `░` blocks, one per chunk, sized to terminal width.
- R2: Color via bijou `gradientText()` from start to end of file.
- R3: Show Merkle sub-manifest boundaries with `│` separators in the grid.
- R4: Legend showing chunk count, sub-manifest count, chunk size.
- R5: Integrate into `git cas inspect` as an optional `--heatmap` flag.
- R6: During store/restore (Task 13.1), optionally show filling heatmap instead of progress bar via `--heatmap` flag.

**Acceptance Criteria**
- AC1: `git cas inspect --slug <slug> --heatmap` renders chunk grid.
- AC2: Gradient coloring spans the full grid.
- AC3: Merkle boundaries visually distinct.
- AC4: Grid reflows to terminal width.

**Scope**
- In scope: Static heatmap for stored files.
- Out of scope: Live-updating heatmap during store/restore (stretch goal for R6).

**Est. Complexity (LoC)**
- Prod: ~40
- Tests: ~15
- Total: ~55

**Est. Human Working Hours**
- ~2h

**Test Plan**
- Golden path:
  - 40-chunk file, 80-col terminal → 2 rows of 40 blocks.
  - 2500-chunk Merkle file → blocks with boundary markers.
- Edges:
  - 1-chunk file → single block.
  - Terminal narrower than chunk count → wraps correctly.

**Definition of Done**
- DoD1: Heatmap renders correctly for v1 and v2 manifests.
- DoD2: Gradient coloring works.
- DoD3: Terminal width adaptation works.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 13.2 (shared component patterns)

---

## Task 13.6: Encryption info card

**User Story**
As a security-conscious user, I want a clear visual summary of my vault's encryption configuration so I can verify the crypto parameters at a glance.

**Requirements**
- R1: Render encryption details using bijou `box()` with labeled rows.
- R2: Show cipher, KDF algorithm, KDF parameters (iterations/cost/blockSize/parallelization), salt (truncated), and key length.
- R3: Status badge: `● locked` (red) when no key provided, `● unlocked` (green) when key resolved.
- R4: Integrate into vault dashboard header and `git cas inspect` encryption accordion.
- R5: Standalone via `git cas vault info --encryption`.

**Acceptance Criteria**
- AC1: Encryption card renders all KDF parameters.
- AC2: Correct badge for locked/unlocked state.
- AC3: Works for both pbkdf2 and scrypt vaults.
- AC4: Non-encrypted vault → "No encryption configured" message.

**Scope**
- In scope: Display-only encryption summary.
- Out of scope: Key verification, passphrase prompting.

**Est. Complexity (LoC)**
- Prod: ~30
- Tests: ~10
- Total: ~40

**Est. Human Working Hours**
- ~1h

**Test Plan**
- Golden path:
  - PBKDF2 vault → shows iterations, salt, key length.
  - Scrypt vault → shows cost, blockSize, parallelization.
- Edges:
  - Non-encrypted vault → "No encryption" message.

**Definition of Done**
- DoD1: Encryption card renders with correct parameters.
- DoD2: Badge reflects locked/unlocked state.
- DoD3: Both KDF algorithms handled.

**Blocking**
- Blocks: None

**Blocked By**
- Blocked by: Task 13.1 (bijou dependency)

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
