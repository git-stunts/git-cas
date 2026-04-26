# Retro — 0028 Whole-v1 Bounded File Restore

## Drift Check

- The cycle stayed bounded to `restoreFile()` for `whole-v1` and other
  buffered file-restore modes.
- `restoreStream()` did not become an unauthenticated plaintext API for
  `whole-v1`.
- The public docs now say exactly what changed at the file surface and what
  did not change at the async iterable surface.

## What Shipped

- `restoreFile()` now uses a bounded temp-file path for `whole-v1`,
  compression-only, and `whole-v1` + gzip manifests instead of delegating to
  the buffered `restoreStream()` path.
- The temp-file path verifies chunk digests, streams whole-object decryption
  where needed, streams gunzip where needed, and only renames into place after
  the pipeline completes successfully.
- Crypto adapters now expose `createDecryptionStream()` so file publication can
  use a stream-native whole-object decrypt seam without changing the public
  `restoreStream()` contract.
- The README, API docs, walkthrough, security doc, changelog, status, and
  bearing surfaces now distinguish `restoreStream()` compatibility behavior
  from bounded file restore behavior.

## What Did Not

- `restoreStream()` for `whole-v1` is still buffered and limited by
  `maxRestoreBufferSize`.
- `restore()` is still a buffer-returning API.
- Hard limits for malicious oversized blobs and decompression bombs are still
  separate work.

## Debt

- Logged direct adapter coupling to underscored `CasService` helpers as
  follow-on bad-code in
  `docs/method/backlog/bad-code/TR_restorefile-service-internal-coupling.md`.
- `TR_restore-buffer-hard-limits.md` remains the next hardening pass for
  adversarial blob sizing and decompression abuse.

## Cool Ideas

- If the repo ever wants a first-class public file-publication seam, it should
  probably look like a named restore-helper contract instead of more adapter
  calls into underscored service internals.
