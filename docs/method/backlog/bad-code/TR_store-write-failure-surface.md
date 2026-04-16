# TR — Store Write Failure Surface

## Why This Exists

`CasService._chunkAndStore()` now bounds source reads correctly, but write-side
failures still propagate unevenly compared to source or chunker failures.

Source iteration failures are normalized into `STREAM_ERROR` with
`chunksDispatched` and `orphanedBlobs` metadata. Write failures from
`writeBlob()` or `_storeChunk()` do not yet have an equally explicit surface.

That makes store failures harder to reason about, document, and test.

## Target Outcome

Design and land an explicit store-write failure contract that:

- decides whether write-side failures should surface as `GIT_ERROR`,
  `STORE_ERROR`, or explicit `CasError` passthrough
- preserves orphaned-blob accounting
- keeps backpressure behavior and partial-dispatch semantics honest
- adds tests that prove the chosen contract

## Human Value

Maintainers should be able to tell what kind of store failure happened without
reverse-engineering whether it came from source iteration or Git persistence.

## Agent Value

Agents should be able to reason about store-failure semantics directly from the
tests and error codes instead of relying on inference around thrown values.

## Notes

- keep this scoped to write-side error normalization
- do not let it sprawl into encrypted restore or stream-native blob APIs
