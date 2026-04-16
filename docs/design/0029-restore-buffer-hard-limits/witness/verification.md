# Witness — 0029 Restore Buffer Hard Limits

## Playback

1. Does buffered restore fail when a referenced blob is larger than the
   manifest-declared chunk size and would exceed the configured limit?
   Yes. The RED spec now proves buffered restore throws `RESTORE_TOO_LARGE`
   when a stream-native blob read exceeds the per-chunk buffered read limit.

2. Does buffered restore fail when streamed gunzip output exceeds
   `maxRestoreBufferSize` before full output materialization?
   Yes. Buffered restore now uses a streamed gunzip collector with a running
   size bound instead of `gunzipAsync()` plus a final size check.

3. Do plaintext streaming restores remain unaffected by the buffered
   hardening?
   Yes. The plaintext restore path is unchanged; the guard cycle stays scoped
   to buffered restore modes.

4. Do the thrown `RESTORE_TOO_LARGE` errors still carry useful `size` / `limit`
   metadata for operators?
   Yes. The new overrun paths keep explicit `size` / `limit` metadata and add
   `reason: 'chunk-blob-size'` for actual blob-read overruns.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/services/CasService.restoreGuard.test.js`
- Green wiring:
  - `src/domain/services/CasService.js`
  - truth surfaces in `SECURITY.md`, `STATUS.md`, `BEARING.md`, `CHANGELOG.md`,
    and `docs/WALKTHROUGH.md`
  - backlog indexes and follow-on debt notes

## Validation

- `npx vitest run test/unit/domain/services/CasService.restoreGuard.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- Actual blob-read hard limits are guaranteed on stream-native persistence
  adapters; the `readBlob()` compatibility fallback is still best-effort and
  is logged as follow-on bad-code.
