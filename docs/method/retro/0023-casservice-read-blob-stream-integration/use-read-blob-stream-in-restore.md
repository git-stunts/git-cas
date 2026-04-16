# Retro — Use Read Blob Stream In Restore

- Cycle: `0023-casservice-read-blob-stream-integration`
- Task: `use-read-blob-stream-in-restore`

## Drift Check

- The RED test proved plaintext restore still preferred `readBlob()`.
- The GREEN implementation added an explicit helper that prefers
  `readBlobStream()` and falls back to `readBlob()`.
- The playback witness answers both the human and agent questions with concrete
  files and commands.

No design drift is visible inside this cycle.

## What Shipped Honestly

- Plaintext chunk restore in `CasService` now prefers `readBlobStream()` when
  the persistence adapter supports it.
- Compatibility fallback to `readBlob()` remains explicit for older adapters
  and lightweight test doubles.
- The walkthrough now states that plaintext restore prefers the stream-native
  persistence seam when available.

## What Did Not Ship

- Manifest and sub-manifest reads still use `readBlob()`.
- Encrypted or compressed restore is still buffered.
- Chunk integrity hashing still occurs after collecting each chunk blob into a
  `Buffer`; there is no streaming SHA-256 surface yet.

## New Debt

- No new `bad-code/` item was added in this cycle.

## Cool Ideas

- No new `cool-ideas/` item was added in this cycle.
- Existing follow-on streaming work remains captured in
  [TR — Streaming Encrypted Restore](../../backlog/up-next/TR_streaming-encrypted-restore.md)
  and
  [TR — Streaming Decryption](../../backlog/cool-ideas/TR_streaming-decryption.md).
