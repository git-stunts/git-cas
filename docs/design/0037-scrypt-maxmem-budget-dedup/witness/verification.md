# Witness — 0037 Scrypt Maxmem Budget Dedup

## Playback

1. Do Node, Bun, and Web Crypto fallback all derive scrypt `maxmem` from one
   shared helper now?
   Yes. All three adapters now import the same shared `scryptMaxmem` helper.

2. Is the helper test explicit about the budgeting formula instead of leaving
   it implicit in adapter implementations?
   Yes. The focused unit test asserts the shared formula directly.

3. Did the cycle stay scoped to deduplicating the shared budget math?
   Yes. No KDF policy values changed, and no adapter behavior changed beyond
   routing the duplicated formula through the helper.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/helpers/scryptMaxmem.test.js`
- Green wiring:
  - `src/domain/helpers/scryptMaxmem.js`
  - `src/infrastructure/adapters/NodeCryptoAdapter.js`
  - `src/infrastructure/adapters/BunCryptoAdapter.js`
  - `src/infrastructure/adapters/WebCryptoAdapter.js`

## Validation

- `npx vitest run test/unit/domain/helpers/scryptMaxmem.test.js test/unit/domain/services/CasService.kdf.test.js`
- `npx eslint src/domain/helpers/scryptMaxmem.js src/infrastructure/adapters/NodeCryptoAdapter.js src/infrastructure/adapters/BunCryptoAdapter.js src/infrastructure/adapters/WebCryptoAdapter.js test/unit/domain/helpers/scryptMaxmem.test.js`
- full repo validation recorded after the combined 0035-0037 pass

## Notes

- This cycle removes adapter drift risk without changing the KDF policy itself.
