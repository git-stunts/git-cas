# 0033-webcrypto-streaming-parity

## Title

Bound Web Crypto whole-object decrypt buffering and document the runtime truth

## Why

Node and Bun now expose a real whole-object decryption stream seam that lets
`restoreFile()` stay low-memory for `whole-v1`, but the Web Crypto adapter
still collects all ciphertext internally in `createDecryptionStream()`.

That makes the runtime story too easy to misread:

- same API shape
- different internal buffering behavior
- no bounded decryption guard on the Web Crypto path

## Decision

Do not pretend Web Crypto can perform true whole-object streaming decryption.
It cannot. Instead:

- add a bounded decryption buffer guard to `WebCryptoAdapter`
- make the constructor accept a decryption-side limit explicitly
- document that Node/Bun and Web Crypto still differ for `whole-v1`
- keep `framed-v1` as the actual streaming answer

## Scope

This cycle covers:

- Web Crypto adapter decryption buffer guard
- adapter conformance/guard tests
- user-facing docs that distinguish bounded buffering from true streaming

This cycle does not cover:

- changing `whole-v1` authenticity boundaries
- making Web Crypto one-shot AES-GCM magically stream
- changing the default encrypted write scheme

## Playback Questions

1. Does the Web Crypto adapter reject oversized decryption buffers instead of
   collecting ciphertext without a bound?
2. Can callers configure separate encryption and decryption buffer limits?
3. Do Web Crypto decryption streams still round-trip within the configured
   bound?
4. Do the docs now make the runtime difference explicit instead of implying
   Node/Bun parity for `whole-v1`?

## Red Tests

The executable spec will live in:

- `test/unit/infrastructure/adapters/WebCryptoAdapter.bufferGuard.test.js`
- `test/unit/infrastructure/adapters/CryptoAdapter.conformance.test.js`

## Green Shape

Treat this as parity-through-honesty:

- bounded behavior where Web Crypto cannot truly stream
- explicit docs where the runtime contract still differs
