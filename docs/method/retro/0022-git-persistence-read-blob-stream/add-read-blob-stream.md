# Retro — Add Read Blob Stream

- Cycle: `0022-git-persistence-read-blob-stream`
- Task: `add-read-blob-stream`

## Drift Check

- The RED tests proved the port and adapter had no stream-native blob read
  surface.
- The GREEN implementation added that surface without removing compatibility
  `readBlob()`.
- The playback witness ties the new seam to concrete tests and files.

No design drift is visible inside this cycle.

## What Shipped Honestly

- `GitPersistencePort` now declares `readBlobStream()`.
- `GitPersistenceAdapter.readBlobStream()` now exposes `git cat-file blob` as
  an async iterable of `Buffer` chunks.
- `readBlob()` remains available and now collects from the stream-native path.
- The type and reference docs now acknowledge the stream-native read seam.

## What Did Not Ship

- `CasService` still reads blobs through the compatibility `readBlob()` path.
- Encrypted or compressed restore is still buffered.
- The new stream-native seam is not yet used to deliver end-to-end bounded
  restore behavior.

## New Debt

- No new `bad-code/` item was added in this cycle.

## Cool Ideas

- No new `cool-ideas/` item was added in this cycle.
- Existing follow-on streaming work remains captured in
  [TR — Streaming Encrypted Restore](../../backlog/up-next/TR_streaming-encrypted-restore.md)
  and
  [TR — Streaming Decryption](../../backlog/cool-ideas/TR_streaming-decryption.md).
