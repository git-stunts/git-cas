# Enforce Store Backpressure

- Cycle: `0021-store-write-backpressure`
- Type: `Code`
- Sponsor human: James
- Sponsor agent: Codex

## Hill

`CasService.store()` should stop pulling new chunks once the configured
concurrency is fully occupied by in-flight writes. Source reads should be
bounded by configured write capacity, not by total input size.

## Playback Questions

### Human

- Can a maintainer point to an executable test that fails when store over-pulls
  beyond configured concurrency?
- After the fix, can a maintainer verify that chunk ordering and
  `STREAM_ERROR` and `orphanedBlobs` behavior still hold?

### Agent

- Can an agent inspect `CasService` and see that capacity is acquired before
  `iterator.next()` so write pressure reaches the upstream source?
- Can an agent find the write launch, iterator close, and store-stream error
  handling without re-deriving one giant control-flow block?

## Accessibility And Assistive Reading Posture

This is runtime behavior work, not UI work. The linear reading model must stay
obvious from the test name, the `_chunkAndStore()` control flow, and the helper
names used to separate launch, read, close, and settle behavior.

## Localization And Directionality Posture

This cycle adds no user-facing copy. Directionality is not relevant beyond
using explicit terms like "next chunk", "in-flight", and "upstream source"
instead of metaphor.

## Agent Inspectability And Explainability Posture

The implementation should make the backpressure boundary inspectable in code:
capacity is acquired before the next chunk pull, and the write-side lifecycle
is split into named helpers instead of one opaque method.

## Non-Goals

- changing encrypted or compressed restore behavior
- changing manifest metadata growth with total chunk count
- adding stream-native Git blob reads
- changing CLI file-path semantics
- reworking the whole-object AES-GCM format

## Implementation Outline

1. Add a RED regression test that blocks `writeBlob()` and proves `store()`
   over-pulls source chunks beyond the configured concurrency.
2. Refactor `_chunkAndStore()` to acquire a semaphore permit before reading the
   next chunk from the iterator.
3. Preserve manifest chunk ordering and existing `STREAM_ERROR` and
   `orphanedBlobs` semantics.
4. Run focused concurrency and stream-error suites, then full unit and lint
   validation.

## RED

The failing condition for this cycle is:

- with `concurrency: 2` and blocked writes, `store()` continues pulling chunk
  `3`, `4`, and `5` before either of the first two writes completes

Tests are the executable spec. The RED spec for this cycle lives in:

- `test/unit/domain/services/CasService.parallel.test.js`

The expected failure signature before the fix is:

- `expected 5 to be 2`

That failure means the source was fully drained despite only two write permits
being available.
