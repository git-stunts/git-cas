# Witness — 0025 Encrypted Manifest Auth Boundary

## Playback

1. Does restore reject downgraded encrypted manifests instead of returning raw
   ciphertext?
   Yes. `restoreStream()` now treats manifest encryption metadata as
   security-critical, so `encryption.encrypted !== true` fails with
   `INTEGRITY_ERROR` instead of falling through to plaintext restore.

2. Does encrypted `verifyIntegrity()` return `false` when authentication fails,
   even if chunk hashes still match?
   Yes. Encrypted verification now performs both chunk-digest checks and an
   authenticated decrypt step, so tampered AES-GCM metadata fails the verify
   call.

3. Does encrypted `verifyIntegrity()` avoid false positives when no key or
   passphrase is provided?
   Yes. Missing encrypted-manifest credentials now produce `false` plus an
   `integrity:fail` event instead of a false-positive pass.

4. Do unencrypted verify flows remain unchanged?
   Yes. Unencrypted verification still returns `true` or `false` based on chunk
   digest checks alone.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/services/CasService.restore.test.js`
  - `test/unit/domain/services/CasService.errors.test.js`
  - `test/unit/domain/services/CasService.events.test.js`
- Green wiring:
  - `src/domain/services/CasService.js`
  - `index.js`
  - `src/domain/services/CasService.d.ts`
  - `index.d.ts`

## Validation

- `npx vitest run test/unit/domain/services/CasService.restore.test.js test/unit/domain/services/CasService.errors.test.js test/unit/domain/services/CasService.events.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- This slice hardens restore and verify behavior only.
- Remaining security debt was logged for KDF policy bounds, real restore memory
  limits, and encryption-metadata schema tightening.
