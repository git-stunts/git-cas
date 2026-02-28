# Completed Tasks

Task cards moved here from ROADMAP.md after completion. Organized by milestone.

---

# M8 — Spit Shine (v4.0.1) ✅ CLOSED

**Theme:** Polish and harden based on code review findings. Fix asymmetries, eliminate duplication, improve docs. No new features.

**Completed:** v4.0.1 (2026-02-28)

- **Task 8.2:** Extract shared crypto helpers to CryptoPort base class — `_validateKey()`, `_buildMeta()`, `deriveKey()` with `_doDeriveKey()` template method. All three adapters inherit from base. `CasService._validateKey()` removed.
- **Task 8.3:** README polish and ADR-001 (vault-in-facade architectural decision record).

---

# M9 — Cockpit (v4.0.1) ✅ CLOSED

**Theme:** CLI polish — structured output, better errors, new commands.

**Completed:** v4.0.1 (2026-02-28)

- **Task 9.2:** `git cas verify` command — verify stored asset integrity without restoring.
- **Task 9.3:** `--json` global flag — structured JSON output for all commands.
- **Task 9.4:** `runAction` error handler — centralized try/catch with CasError codes and actionable hints.
- **Task 9.5:** Vault list `--filter` + TTY-aware table formatting.

---

# M14 — Conduit (v4.0.0) ✅ CLOSED

**Theme:** Replace `EventEmitter` inheritance with a proper `ObservabilityPort`, add streaming restore, and enable parallel chunk I/O. Major version bump: removes `extends EventEmitter` from `CasService`, adds `observability` as a required constructor port.

**Completed:** v4.0.0 (2026-02-27)

---

## Task 14.1: ObservabilityPort and adapters

**User Story**
As a library consumer, I want structured observability (metrics, logs, spans) from CAS operations so I can monitor throughput, track errors, and integrate with my own tooling — without the domain layer depending on Node's EventEmitter.

**Requirements**
- R1: Define `ObservabilityPort` interface with three methods:
  - `metric(channel: string, data: object)` — emit a named metric (channels: `chunk`, `file`, `integrity`, `vault`).
  - `log(level: string, message: string, meta?: object)` — structured log (`debug`, `info`, `warn`, `error`).
  - `span(name: string) → { end(meta?: object): void }` — timed operation bracket.
- R2: Remove `extends EventEmitter` from `CasService`. All `this.emit()` calls replaced with `this.observability.metric()` or `this.observability.log()`.
- R3: `observability` becomes a required constructor parameter on `CasService` (like `persistence`, `codec`, `crypto`).
- R4: Implement `SilentObserver` adapter (no-op — all methods are empty). This is the default when no observability is needed.
- R5: Implement `EventEmitterObserver` adapter that translates `metric()` calls to `EventEmitter.emit()` calls for backward compatibility. Consumers who relied on `service.on('chunk:stored', ...)` can wrap with this adapter.
- R6: Implement `StatsCollector` adapter that accumulates metrics and exposes a summary object: `{ chunksProcessed, bytesTotal, elapsed, throughput, errors }`.
- R7: Facade (`ContentAddressableStore`) creates a default `SilentObserver` if no observability adapter is provided, and passes it to `CasService`.
- R8: Update `.d.ts` declarations for new port and adapters.

**Acceptance Criteria**
- AC1: `CasService` no longer extends `EventEmitter`.
- AC2: All existing event emission points emit metrics via `ObservabilityPort`.
- AC3: `EventEmitterObserver` adapter produces identical events to the old `extends EventEmitter` behavior.
- AC4: `StatsCollector` accumulates correct stats across a full store+restore cycle.
- AC5: `SilentObserver` introduces zero overhead (no-op methods).
- AC6: Span `end()` captures elapsed time in the metric.

---

## Task 14.2: Streaming restore

**User Story**
As a developer restoring large files, I want a streaming restore path so memory usage is O(chunkSize), not O(fileSize).

**Requirements**
- R1: Add `CasService.restoreStream({ manifest, encryptionKey, passphrase })` returning `AsyncIterable<Buffer>`.
- R2: Each yielded buffer is one verified, decrypted, decompressed chunk — ready to write.
- R3: Integrity verified per-chunk before yield (not after full reassembly).
- R4: Decompression and decryption applied per-chunk in streaming fashion.
- R5: `restoreFile()` in the facade uses `restoreStream()` internally with `createWriteStream()` instead of `writeFileSync()`.
- R6: Existing `restore()` method reimplemented as: collect `restoreStream()` into buffer. Single code path, two interfaces.
- R7: Emit `observability.metric('chunk', ...)` per chunk and `observability.span('restore')` for the full operation.

**Acceptance Criteria**
- AC1: `restoreStream()` yields chunks that, when concatenated, match the original file byte-for-byte.
- AC2: Memory usage during streaming restore is O(chunkSize), not O(fileSize).
- AC3: `restoreFile()` writes via `createWriteStream()` — no `writeFileSync()`.
- AC4: Encrypted + compressed files round-trip correctly via streaming restore.
- AC5: Existing `restore()` method returns identical results (backward compat).

---

## Task 14.3: Parallel chunk I/O

**User Story**
As a user storing or restoring files with many chunks, I want the system to read/write multiple chunks concurrently so operations complete faster.

**Requirements**
- R1: Add `concurrency` option to `CasService` constructor (positive integer, default: 1).
- R2: Store path (`_chunkAndStore`): up to N chunks written to Git in parallel. Chunk ordering in the manifest is preserved regardless of write completion order.
- R3: Restore path (`restoreStream`): up to N chunks read from Git in parallel. Yield order matches manifest chunk order (read ahead, buffer up to N, yield in sequence).
- R4: Implement a simple `Semaphore` utility (internal, not exported) to gate concurrent persistence calls.
- R5: `concurrency: 1` produces identical behavior to current sequential code (no functional change).
- R6: Emit `observability.metric('chunk', ...)` per chunk regardless of parallelism. `observability.span('chunk:read')` / `observability.span('chunk:write')` wrap each individual I/O operation.
- R7: Expose `concurrency` option on `ContentAddressableStore` constructor, forwarded to `CasService`.

**Acceptance Criteria**
- AC1: With `concurrency: 4`, a 20-chunk store completes measurably faster than sequential (benchmark, not unit test).
- AC2: With `concurrency: 4`, restore produces byte-identical output to sequential.
- AC3: With `concurrency: 1`, all existing tests pass unchanged.
- AC4: Manifest chunk order is always preserved regardless of concurrency setting.
- AC5: Semaphore correctly limits concurrent persistence calls.

---

## Task 14.4: Migrate CLI and TUI to ObservabilityPort

**User Story**
As a CLI user, I want progress bars and stats to work with the new observability system so the terminal experience is unchanged after the v4 migration.

**Requirements**
- R1: Refactor `bin/ui/progress.js` to subscribe to `ObservabilityPort` metrics instead of EventEmitter events.
- R2: Progress trackers use `observability.metric('chunk', ...)` events for progress updates.
- R3: CLI `store` and `restore` commands wire the observability adapter into CasService via the facade.
- R4: Dashboard and other TUI components continue to function (adapt to new metric format if needed).
- R5: `--quiet` flag still works (uses `SilentObserver`).
- R6: Stats summary printed after store/restore when not in quiet mode (throughput, total bytes, elapsed time).

**Acceptance Criteria**
- AC1: `git cas store` shows progress bar identical to v3.1.0 behavior.
- AC2: `git cas restore` shows progress bar identical to v3.1.0 behavior.
- AC3: `--quiet` suppresses all output.
- AC4: Stats summary displayed after operation completes.
- AC5: Dashboard renders correctly with new observability wiring.

---

# M13 — Bijou (v3.1.0) ✅ CLOSED

**Theme:** Beautiful terminal UI powered by `@flyingrobots/bijou`. Replace silent CLI operations with animated progress, and add an interactive vault dashboard for exploring stored assets.

**Completed:** v3.1.0 (2026-02-27)

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
- R8: Graceful degradation: static table output in CI/pipe mode.

**Acceptance Criteria**
- AC1: `git cas vault dashboard` launches interactive TUI in TTY mode.
- AC2: All vault entries listed with correct metadata.
- AC3: Selecting an entry shows full manifest detail.
- AC4: Filter narrows the list by slug substring.
- AC5: `q` or `ctrl-c` exits cleanly (restores terminal state).
- AC6: Non-TTY falls back to static vault list.

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

---

## Task 13.4: Manifest anatomy view

**User Story**
As a developer debugging storage issues, I want a rich visual breakdown of a manifest showing its structure, encryption metadata, compression settings, and chunk layout.

**Requirements**
- R1: New subcommand: `git cas inspect --slug <slug>` (or `--oid <tree-oid>`).
- R2: Render manifest using bijou `box()`, `accordion()`, and `tree()` components.
- R3: Sections: metadata (slug, filename, size, version), encryption (algorithm, KDF params), compression, sub-manifests (if Merkle), and paginated chunk list.
- R4: Chunks section uses `paginator()` — show 20 chunks per page with index, size, digest (truncated), and blob OID.
- R5: Badges for encryption status, compression, Merkle, manifest version.
- R6: Static fallback: JSON dump (current `readManifest` behavior).

**Acceptance Criteria**
- AC1: `git cas inspect --slug <slug>` renders structured manifest view.
- AC2: Accordion sections expand/collapse.
- AC3: Chunk pagination works.
- AC4: Encrypted manifests show full KDF parameter breakdown.
- AC5: Merkle manifests show sub-manifest tree.

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

---

# Completed tasks from open milestones

## Task 9.1: CLI progress feedback *(completed by M13 Bijou)*

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

**Note:** All requirements delivered by M13 Task 13.1 (animated progress bars with `--quiet` flag, TTY detection, and graceful degradation). Subsequently migrated to ObservabilityPort in M14 Task 14.4.
