# Witness — 0041 RestoreFile Service Internal Coupling

## Playback

1. Does `FileIOHelper` now use a named restore plan instead of underscore
   methods?
   Yes. `restoreFile()` now consumes `createFileRestorePlan()` and no longer
   reaches into `CasService` underscore helpers.

2. Does bounded temp-file behavior still hold for buffered restore modes?
   Yes. Whole-object and buffered compression paths still publish through the
   temp-file boundary before rename.

3. Did the cycle stay scoped and avoid reopening full `CasService`
   decomposition?
   Yes. This cycle only introduced a named restore-plan seam for file
   publication.

## RED -> GREEN

- RED spec:
  - `test/unit/infrastructure/adapters/FileIOHelper.test.js`
- Green wiring:
  - `src/domain/services/CasService.js`
  - `src/domain/services/CasService.d.ts`
  - `src/infrastructure/adapters/FileIOHelper.js`

## Validation

- `npx vitest run test/unit/infrastructure/adapters/FileIOHelper.test.js`
- `npx eslint src/domain/services/CasService.js src/infrastructure/adapters/FileIOHelper.js test/unit/infrastructure/adapters/FileIOHelper.test.js`
- full repo validation recorded at cycle close

## Notes

- The bounded temp-file path is still present; it is now a named service seam
  instead of an adapter-level reconstruction of service internals.
