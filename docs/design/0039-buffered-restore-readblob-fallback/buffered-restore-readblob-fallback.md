# 0039-buffered-restore-readblob-fallback

## Title

Require `readBlobStream()` for hard-limited buffered restore modes

## Why

Buffered restore hard limits are now real when the persistence adapter can
stream blob reads, but the compatibility fallback to `readBlob()` still
materializes the full blob before the size guard can fire.

That means some adapters looked “compatible” while silently losing the
stronger restore-boundary guarantee.

## Decision

Keep the `readBlob()` fallback for plaintext restore compatibility, but require
`readBlobStream()` for buffered restore modes that depend on hard blob-read
limits.

## Scope

This cycle covers:

- explicit capability enforcement for buffered restore paths
- RED coverage for the new capability error
- adapter-facing documentation for the contract

This cycle does not cover:

- changing plaintext restore compatibility fallback behavior
- redesigning the persistence port
- broader restore/file coupling work

## Playback Questions

1. Do buffered restore modes now fail fast when the persistence adapter lacks
   `readBlobStream()`?
2. Does plaintext restore still keep the older `readBlob()` fallback for
   compatibility?
3. Is the adapter contract documented honestly instead of implying the fallback
   is equally safe?

## Red Tests

The executable spec will live in:

- `test/unit/domain/services/CasService.restoreGuard.test.js`
- `test/unit/domain/services/CasService.readBlobStream.test.js`

## Green Shape

One explicit capability boundary: `readBlob()` remains enough for plaintext
compatibility, but bounded buffered restore requires `readBlobStream()`.
