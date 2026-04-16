# Witness — 0032 Encryption Metadata Schema Hardening

## Playback

1. Does manifest parsing reject `encrypted: false` and unsupported encryption
   algorithms at the schema boundary?
   Yes. `EncryptionSchema` now only accepts encrypted AES-256-GCM metadata for
   legacy/explicit `whole-v1` and explicit `framed-v1`.

2. Do `whole-v1` manifests require canonical AES-GCM nonce/tag values with the
   expected lengths?
   Yes. Whole-object manifest nonce/tag values now require canonical base64 and
   decode to 12-byte nonce and 16-byte tag lengths.

3. Do `framed-v1` manifests require `frameBytes` and reject whole-object
   nonce/tag fields?
   Yes. `framed-v1` now requires `frameBytes` and rejects manifest-level
   nonce/tag fields.

4. Do recipient envelope entries reject malformed base64 metadata early?
   Yes. Recipient `wrappedDek`, `nonce`, and `tag` fields now require canonical
   base64 and the expected AES-GCM byte lengths.

5. Does `readManifest()` fail the same way for invalid encrypted metadata in
   both JSON and CBOR manifests?
   Yes. The RED spec now proves invalid encrypted metadata is rejected through
   both codec paths before `readManifest()` returns a `Manifest`.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/schemas/RecipientSchema.test.js`
  - `test/unit/domain/schemas/ManifestSchema.keyVersion.test.js`
  - `test/unit/domain/value-objects/Manifest.test.js`
  - `test/unit/domain/services/CasService.readManifest.test.js`
- Green wiring:
  - `src/domain/schemas/ManifestSchema.js`
  - `src/domain/schemas/ManifestSchema.d.ts`
  - `src/domain/value-objects/Manifest.js`
  - `src/domain/value-objects/Manifest.d.ts`
  - stale encrypted-manifest fixtures across service tests
  - truth surfaces in `SECURITY.md`, `docs/WALKTHROUGH.md`, `BEARING.md`,
    `STATUS.md`, and `CHANGELOG.md`

## Validation

- `npx vitest run test/unit/domain/schemas/RecipientSchema.test.js test/unit/domain/schemas/ManifestSchema.keyVersion.test.js test/unit/domain/value-objects/Manifest.test.js test/unit/domain/services/CasService.readManifest.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- Compatibility remains explicit for older encrypted manifests without a
  `scheme` field: they still parse as legacy `whole-v1`.
- The cycle intentionally did not harden KDF salt shape yet; that follow-on is
  logged separately.
