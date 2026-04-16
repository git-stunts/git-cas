# Witness — 0028 Whole-v1 Bounded File Restore

## Playback

1. Does `restoreFile()` succeed for large `whole-v1` encrypted content even
   when `restoreStream()` would still throw `RESTORE_TOO_LARGE`?
   Yes. The RED spec now proves `restoreFile()` succeeds through the bounded
   temp-file path while `restoreStream()` remains buffer-limited for
   `whole-v1`.

2. Does `restoreFile()` succeed for large `whole-v1` encrypted + compressed
   content without buffering the full decrypted payload in memory?
   Yes. `restoreFile()` now decrypts and, when needed, gunzips through the
   bounded temp-file path instead of inheriting the buffered restore path.

3. On decryption failure, does `restoreFile()` avoid publishing a partial
   destination file and clean up temp artifacts?
   Yes. The RED spec proves auth failure leaves no destination file and no
   `.git-cas-restore-*` temp directories behind.

4. Do the public docs clearly distinguish `restoreStream()` compatibility
   behavior from `restoreFile()` bounded file restore behavior?
   Yes. The README streaming matrix plus the API, walkthrough, security,
   bearing, status, and changelog surfaces now all call this out explicitly.

## RED -> GREEN

- RED spec:
  - `test/unit/infrastructure/adapters/FileIOHelper.test.js`
  - `test/unit/ports/CryptoPort.test.js`
- Additional seam coverage:
  - `test/unit/infrastructure/adapters/CryptoAdapter.conformance.test.js`
- Green wiring:
  - `src/ports/CryptoPort.js`
  - `src/infrastructure/adapters/NodeCryptoAdapter.js`
  - `src/infrastructure/adapters/BunCryptoAdapter.js`
  - `src/infrastructure/adapters/WebCryptoAdapter.js`
  - `src/domain/services/CasService.js`
  - `src/domain/services/CasService.d.ts`
  - `src/infrastructure/adapters/FileIOHelper.js`
  - user-facing docs and backlog indexes

## Validation

- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- `restoreStream()` still stays buffered for `whole-v1`; this cycle did not
  weaken that contract.
- The Node AES-GCM auth-tag-length warning did not reproduce after the adapter
  decryption-path update, so the old backlog note for that warning was removed.
