# Witness — Use Read Blob Stream In Restore

This witness records the concrete evidence for cycle
`0023-casservice-read-blob-stream-integration`.

## Human Playback

### Question

Can a maintainer point to an executable RED test that fails because
`CasService` still uses `readBlob()` even when `readBlobStream()` exists?

### Answer

Yes.

### Evidence

- The RED spec is in
  [test/unit/domain/services/CasService.readBlobStream.test.js](../../../../test/unit/domain/services/CasService.readBlobStream.test.js)
- Before the fix, the plaintext-restore preference test failed with:
  - `expected "spy" to be called 3 times, but got 0 times`

### Question

After the fix, can a maintainer verify that plaintext restore prefers
`readBlobStream()` but still falls back to `readBlob()` when the stream-native
method is absent?

### Answer

Yes.

### Evidence

- `npx vitest run test/unit/domain/services/CasService.readBlobStream.test.js`
- The first test asserts `readBlobStream()` is called once per manifest chunk
- The second test asserts plaintext restore still succeeds when only `readBlob()`
  exists

## Agent Playback

### Question

Can an agent inspect `CasService` and find a single helper that normalizes blob
reads from either `readBlobStream()` or `readBlob()`?

### Answer

Yes.

### Evidence

- [`_readChunkBlob()`](../../../../src/domain/services/CasService.js) prefers
  `readBlobStream()` and falls back to `readBlob()`
- [`_readAndVerifyChunk()`](../../../../src/domain/services/CasService.js)
  routes chunk restore through that helper

### Question

Can an agent see that this cycle improves only the plaintext chunk restore
seam, without claiming to solve encrypted restore or streaming digest
verification?

### Answer

Yes.

### Evidence

- The design doc names encrypted restore, manifest reads, and streaming digest
  verification as non-goals
- The code change is confined to the chunk restore helper path plus docs truth

## Observed Verification

The following checks passed during this cycle:

- `npx vitest run test/unit/domain/services/CasService.readBlobStream.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`
