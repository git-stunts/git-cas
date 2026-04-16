# Retro — Enforce Store Backpressure

- Cycle: `0021-store-write-backpressure`
- Task: `enforce-store-backpressure`

## Drift Check

- The RED regression now proves `store()` stops pulling after the configured
  in-flight capacity is reached.
- The GREEN implementation answers that test by acquiring capacity before
  `iterator.next()`.
- The playback witness answers both human and agent questions with concrete
  file paths and commands.

No design drift is currently visible inside this cycle.

## What Shipped Honestly

- `CasService.store()` now applies real write-side backpressure to the upstream
  source iterator.
- The store path preserves manifest chunk ordering under concurrency.
- The existing `STREAM_ERROR` and `orphanedBlobs` tests still pass after the
  refactor.
- The control flow is split into smaller helper methods instead of one
  monolithic `_chunkAndStore()` implementation.

## What Did Not Ship

- Manifest metadata still grows with total chunk count for large assets.
- Protected restore is still buffered for encrypted or compressed content.
- `GitPersistencePort` is still buffer-shaped rather than stream-native.
- Write-side storage failures still do not have an explicitly normalized error
  surface.

## New Debt

- [TR — Store Write Failure Surface](../../backlog/bad-code/TR_store-write-failure-surface.md)

## Cool Ideas

- No new cool-ideas card came out of this cycle.
- Existing streaming follow-on work remains captured in
  [TR — Streaming Decryption](../../backlog/cool-ideas/TR_streaming-decryption.md)
  and
  [TR — Streaming Encrypted Restore](../../backlog/up-next/TR_streaming-encrypted-restore.md).
