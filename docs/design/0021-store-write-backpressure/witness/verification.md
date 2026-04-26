# Witness — Enforce Store Backpressure

This witness records the concrete evidence for cycle
`0021-store-write-backpressure`.

## Human Playback

### Question

Can a maintainer point to an executable test that fails when store over-pulls
beyond configured concurrency?

### Answer

Yes.

### Evidence

- The RED regression is in
  [test/unit/domain/services/CasService.parallel.test.js](../../../../test/unit/domain/services/CasService.parallel.test.js)
- Before the fix, `npx vitest run test/unit/domain/services/CasService.parallel.test.js`
  failed with:
  - `expected 5 to be 2`
- After the fix, the same suite passed

### Question

After the fix, can a maintainer verify that chunk ordering and `STREAM_ERROR`
and `orphanedBlobs` behavior still hold?

### Answer

Yes.

### Evidence

- `npx vitest run test/unit/domain/services/CasService.parallel.test.js`
- `npx vitest run test/unit/domain/services/CasService.stream-error.test.js`
- `npx vitest run test/unit/domain/services/CasService.orphanedBlobs.test.js`

## Agent Playback

### Question

Can an agent inspect `CasService` and see that capacity is acquired before
`iterator.next()` so write pressure reaches the upstream source?

### Answer

Yes.

### Evidence

- [`_chunkAndStore()`](../../../../src/domain/services/CasService.js) acquires
  the semaphore before reading the next iterator step
- The RED harness uses a passthrough chunker and blocked `writeBlob()` calls to
  prove the source stops at the configured in-flight limit

### Question

Can an agent find the write launch, iterator close, and store-stream error
handling without re-deriving one giant control-flow block?

### Answer

Yes.

### Evidence

- [`_launchChunkWrite()`](../../../../src/domain/services/CasService.js)
- [`_readNextStoreChunk()`](../../../../src/domain/services/CasService.js)
- [`_closeAsyncIterator()`](../../../../src/domain/services/CasService.js)
- [`_buildStoreStreamError()`](../../../../src/domain/services/CasService.js)

## Observed Verification

The following checks passed during this cycle:

- `npx vitest run test/unit/domain/services/CasService.parallel.test.js`
- `npx vitest run test/unit/domain/services/CasService.stream-error.test.js test/unit/domain/services/CasService.orphanedBlobs.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`
