# Witness — 0033 Web Crypto Streaming Parity

## Playback

1. Does the Web Crypto adapter reject oversized decryption buffers instead of
   collecting ciphertext without a bound?
   Yes. `createDecryptionStream()` now enforces `maxDecryptionBufferSize` and
   throws `DECRYPTION_BUFFER_EXCEEDED` before unbounded buffering can continue.

2. Can callers configure separate encryption and decryption buffer limits?
   Yes. `WebCryptoAdapter` now accepts both `maxEncryptionBufferSize` and
   `maxDecryptionBufferSize`.

3. Do Web Crypto decryption streams still round-trip within the configured
   bound?
   Yes. The RED spec proves successful decrypt round-trips inside the limit and
   a bounded failure outside it.

4. Do the docs now make the runtime difference explicit instead of implying
   Node/Bun parity for `whole-v1`?
   Yes. The README, API guide, walkthrough, security doc, bearing, status, and
   changelog now all state that Web Crypto remains bounded-buffer, not true
   whole-object streaming, for `whole-v1`.

## RED -> GREEN

- RED spec:
  - `test/unit/infrastructure/adapters/WebCryptoAdapter.bufferGuard.test.js`
  - `test/unit/infrastructure/adapters/CryptoAdapter.conformance.test.js`
- Green wiring:
  - `src/infrastructure/adapters/WebCryptoAdapter.js`
  - truth surfaces in `README.md`, `docs/API.md`, `docs/WALKTHROUGH.md`,
    `SECURITY.md`, `STATUS.md`, `BEARING.md`, and `CHANGELOG.md`

## Validation

- `npx vitest run test/unit/infrastructure/adapters/WebCryptoAdapter.bufferGuard.test.js test/unit/infrastructure/adapters/CryptoAdapter.conformance.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- This is parity-through-bounds, not parity-through-identical mechanics.
- `framed-v1` remains the actual authenticated streaming answer across
  runtimes.
