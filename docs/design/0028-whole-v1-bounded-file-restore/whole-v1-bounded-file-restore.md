# 0028-whole-v1-bounded-file-restore

## Title

Bound `restoreFile()` for `whole-v1` and buffered compression paths

## Why

`framed-v1` now provides a true authenticated streaming restore path, but the
legacy `whole-v1` format still authenticates the full ciphertext as one unit.
That means `restoreStream()` for `whole-v1` cannot honestly yield verified
plaintext incrementally without changing the security contract.

The remaining gap is narrower:

- `restoreStream()` should stay honest and buffered for `whole-v1`
- `restoreFile()` should stop failing large encrypted or compressed restores
  purely because the current implementation buffers the entire payload in
  memory before writing to disk

## Decision

Add a bounded temp-file restore path for file restores that currently route
through `_restoreBuffered()`:

- `whole-v1` encrypted content
- compressed-only content
- `whole-v1` encrypted + compressed content

The file helper will:

1. read and verify stored chunk digests incrementally
2. stream whole-object AES-GCM decryption when needed
3. stream gunzip when needed
4. write tentative bytes to a temp file in the destination directory
5. rename into place only after the pipeline completes successfully

`restoreStream()` remains unchanged for `whole-v1`.

## Scope

This cycle covers:

- bounded `restoreFile()` for buffered restore modes
- low-level streaming whole-object decryption support in crypto adapters where
  needed by the file helper
- user-facing docs that distinguish `restoreStream()` from `restoreFile()`

This cycle does not cover:

- changing the trust contract of `restoreStream()`
- making `restore()` stream
- hardening malicious oversized-blob behavior beyond the existing per-chunk
  assumptions

## Behavior

### File Restore

For buffered restore modes, `restoreFile()` will no longer depend on
`service.restoreStream()`.

Instead it will:

- verify chunk digests as bytes are read from storage
- stream tentative plaintext into a temp file
- only publish the destination path after decryption and optional gunzip
  complete successfully

If authentication or decompression fails:

- the destination path is left untouched
- the temp file is removed

### Streaming API Contract

`restoreStream()` remains the truth surface for async byte readers:

- plaintext: true streaming
- `framed-v1`: true authenticated streaming
- `whole-v1`: buffered compatibility mode

This cycle improves the file-write path, not the generic async iterable
contract.

## Playback Questions

1. Does `restoreFile()` succeed for large `whole-v1` encrypted content even
   when `restoreStream()` would still throw `RESTORE_TOO_LARGE`?
2. Does `restoreFile()` succeed for large `whole-v1` encrypted + compressed
   content without buffering the full decrypted payload in memory?
3. On decryption failure, does `restoreFile()` avoid publishing a partial
   destination file and clean up temp artifacts?
4. Do the public docs clearly distinguish `restoreStream()` compatibility
   behavior from `restoreFile()` bounded file restore behavior?

## Red Tests

The executable spec will live in:

- `test/unit/infrastructure/adapters/FileIOHelper.test.js`
- `test/unit/ports/CryptoPort.test.js`

## Green Shape

Keep the security boundary explicit:

- `restoreStream()` does not become a misleading unauthenticated plaintext API
- `restoreFile()` uses temp-file publication so authenticated whole-object
  decryption can still be low-memory and safe for operators
