# Witness — 0042 Store Write Failure Surface

## Playback

1. Do raw chunk-write failures now surface as `STORE_ERROR` instead of leaking
   plain errors?
   Yes. Non-`CasError` write failures now normalize to `STORE_ERROR`.

2. Do `CasError` write failures keep their original code while gaining
   `chunksDispatched` and `orphanedBlobs` metadata?
   Yes. Existing `CasError` write failures preserve their code and merge the
   write-phase metadata into `meta`.

3. Did the cycle stay scoped to write-side normalization?
   Yes. Source-stream failure handling and restore behavior were unchanged.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/services/CasService.store-error.test.js`
- Green wiring:
  - `src/domain/services/CasService.js`

## Validation

- `npx vitest run test/unit/domain/services/CasService.store-error.test.js`
- `npx eslint src/domain/services/CasService.js test/unit/domain/services/CasService.store-error.test.js`
- full repo validation recorded at cycle close

## Notes

- The store path now distinguishes source failures (`STREAM_ERROR`) from sink
  failures (`STORE_ERROR`) without losing orphaned-blob accounting.
