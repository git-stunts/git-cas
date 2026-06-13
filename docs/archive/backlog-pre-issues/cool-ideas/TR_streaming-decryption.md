# TR — Streaming Decryption

Legend: [TR - Truth](../../../method/legends/TR_truth.md)

## Idea

Currently, encrypted or compressed restores are handled via `_restoreBuffered`, which concatenates all chunk buffers into memory before performing the transformation. This limits the size of protected assets to the available RAM (and the `maxRestoreBufferSize` safety cap).

Implement true streaming decryption and decompression in `CasService`. This requires updating the `CryptoPort` to support streaming AEAD operations (where the tag is verified at the end of the stream) or per-chunk decryption (where each chunk has its own nonce/tag).

## Why

1. **Scalability**: Allows `git-cas` to handle files exceeding 1 GiB without OOM risks.
2. **Efficiency**: Reduces time-to-first-byte for large restores.
3. **Robustness**: Aligns with the "Sacred Capture" target by ensuring the restore path is equally capable.

## Effort

Medium-Large — requires architectural changes to the restore pipeline and potentially the manifest schema to support per-chunk encryption metadata.

## Status

- [x] Resolved — `security/audit-fixes` branch
- `framed-v1`/`framed-v2` schemes provide per-frame AEAD streaming restore
- `CryptoPort.createEncryptionStream`/`createDecryptionStream` support streaming AEAD
- Bounded memory: frame size controls peak allocation (default 64 KiB, max 64 MiB)
- Files of any size can be restored without buffering entire content
