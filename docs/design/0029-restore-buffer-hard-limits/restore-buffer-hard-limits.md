# 0029-restore-buffer-hard-limits

## Title

Make `maxRestoreBufferSize` a real buffered-restore safety boundary

## Why

`whole-v1 restoreFile()` now has a bounded temp-file path, but the buffered
restore surfaces still treat `maxRestoreBufferSize` more like a planning hint
than a hard runtime boundary.

Two gaps remain in `restoreStream()` / `restore()` buffered modes:

- chunk blobs can still be oversized relative to manifest metadata before the
  code notices
- decompression is still checked after full `gunzip()` output is materialized

That means malicious manifests and compressed payloads can still overshoot the
configured safety boundary before `git-cas` throws.

## Decision

Harden the buffered restore path itself.

- Actual blob reads in buffered restore mode must be size-bounded while bytes
  are being read, not only after `Buffer.concat()`.
- Buffered decompression must enforce the configured limit while collecting
  output, not after full output materialization.
- These checks apply to the buffered compatibility surfaces:
  - `whole-v1 restoreStream()`
  - `whole-v1 restore()`
  - compression-buffered `restoreStream()` / `restore()`

This cycle does not change the low-memory temp-file path added to
`restoreFile()`.

## Scope

This cycle covers:

- hard actual-size bounds while reading chunk blobs for buffered restore
- hard decompression bounds while collecting buffered restore output
- explicit test coverage for oversized actual blobs and decompression overrun

This cycle does not cover:

- disk-space policy for `restoreFile()`
- KDF policy
- manifest encryption schema tightening
- making `restore()` itself a streaming API

## Behavior

### Blob Reads

When buffered restore expects to hold at most `maxRestoreBufferSize` bytes, it
must reject a chunk blob as soon as the actual bytes read exceed the allowed
bound.

That bound should account for:

- the manifest-declared chunk size
- the remaining bytes available under the configured buffered restore limit

If the blob exceeds that bound, restore fails with `RESTORE_TOO_LARGE`.

### Decompression

Buffered decompression must no longer use a full `gunzip(buffer)` and only
check the final output length afterward.

Instead, it must collect streamed gunzip output and fail with
`RESTORE_TOO_LARGE` as soon as the decompressed byte count exceeds the limit.

## Playback Questions

1. Does buffered restore fail when a referenced blob is larger than the
   manifest-declared chunk size and would exceed the configured limit?
2. Does buffered restore fail when streamed gunzip output exceeds
   `maxRestoreBufferSize` before full output materialization?
3. Do plaintext streaming restores remain unaffected by the buffered hardening?
4. Do the thrown `RESTORE_TOO_LARGE` errors still carry useful `size` / `limit`
   metadata for operators?

## Red Tests

The executable spec will live in:

- `test/unit/domain/services/CasService.restoreGuard.test.js`

## Green Shape

Keep the hardening local to the buffered restore path instead of introducing a
new public API. The visible behavior should become stricter and more honest,
not more complicated.
