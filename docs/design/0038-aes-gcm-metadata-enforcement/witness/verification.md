# Witness — 0038 AES-GCM Metadata Enforcement

## Playback

1. Do all decrypt adapters now reject malformed AES-GCM metadata before
   runtime-specific decrypt calls?
   Yes. Node, Bun, and Web Crypto all now validate and decode AES-GCM metadata
   through one shared helper before decrypting.

2. Is the declared AES-GCM algorithm enforced at the adapter boundary instead
   of being trusted implicitly?
   Yes. The helper rejects any non-`aes-256-gcm` algorithm before adapter
   decrypt logic runs.

3. Did the cycle stay scoped to adapter/runtime enforcement instead of
   reopening schema or format work?
   Yes. No manifest schema rules or payload formats changed in this cycle.

## RED -> GREEN

- RED spec:
  - `test/unit/infrastructure/adapters/CryptoAdapter.conformance.test.js`
  - `test/unit/helpers/aesGcmMeta.test.js`
- Green wiring:
  - `src/helpers/aesGcmMeta.js`
  - `src/infrastructure/adapters/NodeCryptoAdapter.js`
  - `src/infrastructure/adapters/BunCryptoAdapter.js`
  - `src/infrastructure/adapters/WebCryptoAdapter.js`

## Validation

- `npx vitest run test/unit/helpers/aesGcmMeta.test.js test/unit/infrastructure/adapters/CryptoAdapter.conformance.test.js`
- `npx eslint src/helpers/aesGcmMeta.js src/infrastructure/adapters/NodeCryptoAdapter.js src/infrastructure/adapters/BunCryptoAdapter.js src/infrastructure/adapters/WebCryptoAdapter.js test/unit/helpers/aesGcmMeta.test.js test/unit/infrastructure/adapters/CryptoAdapter.conformance.test.js`
- full repo validation recorded at cycle close

## Notes

- Adapter-side validation now matches the schema/runtime contract instead of
  relying on higher layers alone.
