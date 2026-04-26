# Witness — 0040 KDF Salt Schema Hardening

## Playback

1. Do manifests now reject malformed KDF salt strings at parse time?
   Yes. Manifest construction now rejects non-canonical KDF salt base64.

2. Do vault metadata and stored-manifest KDF paths reject malformed salt before
   derive work begins?
   Yes. Stored KDF option preparation now validates salt shape before any
   `deriveKey()` call.

3. Did the cycle stay structural instead of reopening KDF cost policy?
   Yes. No KDF range or algorithm policy changed in this cycle.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/value-objects/Manifest.test.js`
  - `test/unit/vault/VaultService.test.js`
  - `test/unit/domain/services/KeyResolver.test.js`
- Green wiring:
  - `src/helpers/canonicalBase64.js`
  - `src/domain/schemas/ManifestSchema.js`
  - `src/helpers/kdfPolicy.js`

## Validation

- `npx vitest run test/unit/domain/value-objects/Manifest.test.js test/unit/vault/VaultService.test.js test/unit/domain/services/KeyResolver.test.js`
- `npx eslint src/helpers/canonicalBase64.js src/domain/schemas/ManifestSchema.js src/helpers/kdfPolicy.js test/unit/domain/value-objects/Manifest.test.js test/unit/vault/VaultService.test.js test/unit/domain/services/KeyResolver.test.js`
- full repo validation recorded at cycle close

## Notes

- Salt validation is now consistent without changing KDF cost policy.
