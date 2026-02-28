# Task Graveyard

Tasks moved here from ROADMAP.md because they were superseded or duplicated by other work.

---

## Task 8.1: Streaming restore *(superseded by Task 14.2)*

**Originally in:** M8 — Spit Shine (v2.1.0)

**Superseded by:** Task 14.2 (Streaming restore) in M14 — Conduit (v4.0.0)

**Reason:** Task 14.2 implemented all of Task 8.1's requirements plus additional integration with ObservabilityPort metrics/spans and the `restoreStream()` → `restore()` unification. The M14 version is strictly a superset.

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
