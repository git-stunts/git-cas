# Witness — 0026 Dual Encryption Mode Foundation

## Playback

1. Do new encrypted stores persist `scheme: 'whole-v1'` in the manifest?
   Yes. New encrypted stores now serialize explicit `whole-v1` metadata in the
   manifest and low-level encryption metadata.

2. Does encrypted store reject unsupported requested schemes?
   Yes. `store()` now rejects unknown schemes, and `framed-v1` is rejected
   explicitly as not implemented yet.

3. Do restore and verify still accept legacy encrypted manifests with no
   `scheme`?
   Yes. Missing `scheme` is interpreted as legacy `whole-v1` for backward
   compatibility.

4. Do restore and verify reject unsupported encrypted schemes instead of trying
   to interpret them as the current format?
   Yes. Unknown manifest schemes now fail closed in restore and return `false`
   in encrypted `verifyIntegrity()`.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/services/CasService.test.js`
  - `test/unit/domain/services/CasService.restore.test.js`
  - `test/unit/domain/services/CasService.errors.test.js`
  - `test/unit/domain/value-objects/Manifest.test.js`
- Green wiring:
  - `src/domain/schemas/ManifestSchema.js`
  - `src/ports/CryptoPort.js`
  - `src/domain/services/CasService.js`
  - public typings and docs

## Validation

- `npx vitest run test/unit/domain/services/CasService.test.js test/unit/domain/services/CasService.restore.test.js test/unit/domain/services/CasService.errors.test.js test/unit/domain/value-objects/Manifest.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- This slice only establishes explicit scheme metadata and routing.
- `framed-v1` remains a follow-on implementation, not a hidden partial mode.
