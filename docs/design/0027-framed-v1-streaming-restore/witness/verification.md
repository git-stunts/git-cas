# Witness — 0027 Framed-v1 Streaming Restore

## Playback

1. Does `store()` persist `scheme: 'framed-v1'` plus `frameBytes` for framed
   encrypted content?
   Yes. Framed encrypted stores now persist explicit `framed-v1` metadata with
   `frameBytes` in the manifest.

2. Does `restoreStream()` round-trip framed encrypted content without falling
   back to the buffered `whole-v1` path?
   Yes. `restoreStream()` now routes `framed-v1` through a service-level framed
   parser and decryptor instead of the buffered whole-object path.

3. Does framed restore yield plaintext before consuming the entire encrypted
   asset?
   Yes. The RED spec now proves framed restore can emit the first authenticated
   plaintext frame before the full encrypted asset has been read from
   persistence.

4. Does framed encrypted + compressed restore stream through gunzip and produce
   the original plaintext?
   Yes. `framed-v1` now decrypts frame-by-frame and feeds the decrypted byte
   stream through streaming gunzip when `compression.algorithm === 'gzip'`.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/services/CasService.test.js`
  - `test/unit/domain/services/CasService.restoreStream.test.js`
  - `test/unit/domain/services/CasService.compression.test.js`
  - `test/unit/domain/services/CasService.errors.test.js`
  - `test/unit/infrastructure/adapters/FileIOHelper.test.js`
- Green wiring:
  - `src/domain/services/CasService.js`
  - `src/domain/schemas/ManifestSchema.js`
  - `src/domain/value-objects/Manifest.js`
  - `src/domain/value-objects/Manifest.d.ts`
  - `src/domain/services/CasService.d.ts`
  - `src/infrastructure/adapters/FileIOHelper.js`
  - public docs and changelog surfaces

## Validation

- `npx vitest run test/unit/domain/services/CasService.test.js test/unit/domain/services/CasService.restoreStream.test.js test/unit/domain/services/CasService.compression.test.js test/unit/infrastructure/adapters/FileIOHelper.test.js test/unit/domain/services/CasService.errors.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- `whole-v1` remains the compatibility whole-object format and still uses the
  buffered restore path.
- The framed format lives at the `CasService` layer; the crypto adapters remain
  AES-256-GCM primitives rather than growing a second low-level framing API.
