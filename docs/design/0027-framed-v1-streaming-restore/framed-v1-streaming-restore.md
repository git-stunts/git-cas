# 0027-framed-v1-streaming-restore

## Title

Implement `framed-v1` authenticated streaming restore

## Why

`git-cas` now names the current whole-object AES-GCM format explicitly as
`whole-v1`, but that format still authenticates the full ciphertext as one
unit and therefore forces encrypted restore through a buffered path.

The next step is not another abstraction layer. It is a real second payload
format with different restore behavior:

- `whole-v1` stays compatibility-oriented and buffered
- `framed-v1` authenticates one frame at a time and can restore as a stream

## Decision

`framed-v1` will be a service-level framing format built on top of the existing
AES-256-GCM primitive.

Each plaintext frame is encrypted independently, then serialized into the
stored byte stream as:

```text
[4-byte big-endian ciphertext length][12-byte nonce][16-byte tag][ciphertext]
```

Manifest metadata records:

- `scheme: 'framed-v1'`
- `algorithm: 'aes-256-gcm'`
- `encrypted: true`
- `frameBytes`

The nonce and tag are per-frame, so they are not stored as top-level manifest
fields for `framed-v1`.

## Scope

This cycle covers:

- framed encrypted store
- framed encrypted `restoreStream()`
- framed encrypted `restore()`
- framed encrypted `restoreFile()`
- framed encrypted `verifyIntegrity()`
- streaming gunzip on top of framed decryption when `compression.algorithm` is
  `gzip`

This cycle does not cover:

- changing `whole-v1`
- multi-scheme low-level `encrypt()` / `decrypt()` APIs
- agent CLI or human CLI flags

## Behavior

### Store

`store({ encryption: { scheme: 'framed-v1', frameBytes } })`:

- splits plaintext into frames
- encrypts each frame independently with AES-256-GCM
- emits framed ciphertext bytes into the normal chunk-store pipeline
- writes manifest encryption metadata with `scheme: 'framed-v1'`

If `frameBytes` is omitted, a default is used.

### Restore

`restoreStream()` for `framed-v1`:

- reads and verifies stored chunk digests incrementally
- parses framed records across chunk boundaries
- authenticates each frame independently
- yields authenticated plaintext frame bytes as soon as each frame is complete

If compression is enabled, the decrypted frame stream is piped through a
streaming gunzip stage before yielding to the caller.

### Verify

`verifyIntegrity()` for `framed-v1` still returns a boolean, but it must:

- verify chunk digests
- parse the framed ciphertext correctly
- authenticate every frame

It may buffer internally because `verifyIntegrity()` is not itself a streaming
API.

## Playback Questions

1. Does `store()` persist `scheme: 'framed-v1'` plus `frameBytes` for framed
   encrypted content?
2. Does `restoreStream()` round-trip framed encrypted content without falling
   back to the buffered `whole-v1` path?
3. Does framed restore yield plaintext before consuming the entire encrypted
   asset?
4. Does framed encrypted + compressed restore stream through gunzip and produce
   the original plaintext?

## Red Tests

The executable spec will live in:

- `test/unit/domain/services/CasService.test.js`
- `test/unit/domain/services/CasService.restoreStream.test.js`
- `test/unit/domain/services/CasService.compression.test.js`
- `test/unit/infrastructure/adapters/FileIOHelper.test.js`

## Green Shape

Keep framing in `CasService` instead of pushing a brand-new multi-mode API down
into every crypto adapter first. The adapters still provide AES-256-GCM; the
service defines how framed records are laid out and restored.
