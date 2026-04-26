# Witness — 0039 Buffered Restore ReadBlob Fallback

## Playback

1. Do buffered restore modes now fail fast when the persistence adapter lacks
   `readBlobStream()`?
   Yes. Buffered restore paths now throw a dedicated capability error before
   falling back to unsafe whole-blob reads.

2. Does plaintext restore still keep the older `readBlob()` fallback for
   compatibility?
   Yes. Plaintext restore still prefers `readBlobStream()` but falls back to
   `readBlob()` when buffering limits are not part of the contract.

3. Is the adapter contract documented honestly instead of implying the fallback
   is equally safe?
   Yes. The port docs, API docs, and walkthrough now say that
   `readBlobStream()` is required for hard-limited buffered restore modes.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/services/CasService.restoreGuard.test.js`
  - `test/unit/domain/services/CasService.readBlobStream.test.js`
- Green wiring:
  - `src/domain/services/CasService.js`
  - `src/ports/GitPersistencePort.js`
  - `docs/API.md`
  - `docs/WALKTHROUGH.md`

## Validation

- `npx vitest run test/unit/domain/services/CasService.restoreGuard.test.js test/unit/domain/services/CasService.readBlobStream.test.js`
- `npx eslint src/domain/services/CasService.js src/ports/GitPersistencePort.js test/unit/domain/services/CasService.restoreGuard.test.js test/unit/domain/services/CasService.readBlobStream.test.js`
- full repo validation recorded at cycle close

## Notes

- This closes the safety gap without changing the plaintext compatibility
  fallback.
