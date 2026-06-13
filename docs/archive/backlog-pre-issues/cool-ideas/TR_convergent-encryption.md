# TR — Convergent Encryption

## The Idea

CDC deduplication is useless with encryption — ciphertext is pseudorandom, so
identical plaintext chunks produce different ciphertexts. This is the
"encryption kills dedup" tension noted in BEARING.

Convergent encryption solves this by deriving the encryption key deterministically
from the content hash of each chunk. Identical plaintext → identical key →
identical ciphertext → deduplication works.

```
chunkKey = HKDF(masterKey, chunkDigest)
ciphertext = AES-256-GCM(chunkKey, nonce, plaintext)
```

## Why It's Interesting

- Recovers the full dedup benefit of CDC even with encryption enabled
- Well-studied in the literature (Tahoe-LAFS, Bitcasa, SDFS)
- Could be a new chunking-level encryption mode (`convergent-v1`) orthogonal to
  the existing manifest-level schemes (whole/framed)
- The ChunkingPort and CryptoPort abstractions are already in place

## Tradeoffs

- **Leaks equality**: An attacker can tell if two chunks contain identical
  plaintext (the ciphertexts will match). This is the known weakness of
  convergent encryption — acceptable for some threat models, not for others.
- **Key derivation per chunk**: Adds a KDF call per chunk during store. Cheap
  with HKDF but measurable at high chunk counts.
- **Incompatible with AAD binding**: AAD ties ciphertext to slug+position.
  Convergent encryption ties ciphertext to content. These goals conflict —
  would need to choose one or the other per store operation.

## Prior Art

- Tahoe-LAFS: convergent encryption for distributed storage
- Bitcasa: content-defined encryption keys (discontinued)
- SDFS: dedup-aware encrypted filesystem

## Status

- [x] Implemented — `security/audit-fixes` branch
- `convergent-v1` scheme: per-chunk AES-256-GCM with content-derived keys
- Key = HMAC-SHA256(masterKey, "git-cas-convergent-key:" + digest)
- Nonce = first 12 bytes of HMAC-SHA256(masterKey, "git-cas-convergent-nonce:" + digest)
- Default on when CDC + encryption combined; opt-out via `convergent: false`
- GCM tag appended to blob (16 bytes); ChunkSchema unchanged
- CryptoPort extended with encryptBufferWithNonce / decryptBufferWithNonceTag
- 21 new tests + 7 adapter conformance tests
