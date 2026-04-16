# Retro — 0029 Restore Buffer Hard Limits

## Drift Check

- The cycle stayed scoped to buffered restore hardening.
- `restoreFile()` was not reopened; its bounded temp-file path stays as landed
  in 0028.
- `restoreStream()` did not change shape; it just became stricter and more
  honest in buffered modes.

## What Shipped

- Buffered restore now bounds actual blob reads while bytes are being read from
  stream-native persistence adapters instead of only trusting manifest-declared
  chunk sizes.
- Buffered restore now enforces decompression size limits during streamed
  gunzip collection instead of only after full output materialization.
- `RESTORE_TOO_LARGE` remains the operator-facing error, now with a clearer
  `chunk-blob-size` overrun reason when the actual blob is too large.
- Public docs and status surfaces now describe `maxRestoreBufferSize` as a
  harder runtime boundary instead of just a manifest-preflight estimate.

## What Did Not

- `whole-v1 restoreStream()` is still a bounded in-memory compatibility path,
  not a true authenticated streaming surface.
- The `readBlob()` fallback for custom adapters is still best-effort rather
  than equally hard-bounded.
- KDF policy and encryption metadata hardening are still separate work.

## Debt

- Logged the `readBlob()` fallback gap as
  `docs/method/backlog/bad-code/TR_buffered-restore-readblob-fallback.md`.
- The immediate next security-hardening slices are still KDF bounds and
  metadata schema tightening.

## Cool Ideas

- If buffered restore ever gets a formal adapter capability model, it should
  advertise hard-limit guarantees explicitly instead of inferring them from the
  presence of ad hoc methods.
