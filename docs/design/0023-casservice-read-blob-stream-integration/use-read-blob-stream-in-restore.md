# Use Read Blob Stream In Restore

- Cycle: `0023-casservice-read-blob-stream-integration`
- Type: `Code`
- Sponsor human: James
- Sponsor agent: Codex

## Hill

`CasService` plaintext restore should prefer the new
`GitPersistencePort.readBlobStream()` seam when it is available, so chunk
restore no longer stops at the compatibility `readBlob()` boundary.

At the same time, restore should retain a compatibility fallback to `readBlob()`
for persistence mocks or adapters that do not yet implement the stream-native
method.

## Playback Questions

### Human

- Can a maintainer point to an executable RED test that fails because
  `CasService` still uses `readBlob()` even when `readBlobStream()` exists?
- After the fix, can a maintainer verify that plaintext restore prefers
  `readBlobStream()` but still falls back to `readBlob()` when the stream-native
  method is absent?

### Agent

- Can an agent inspect `CasService` and find a single helper that normalizes
  blob reads from either `readBlobStream()` or `readBlob()`?
- Can an agent see that this cycle improves only the plaintext chunk restore
  seam, without claiming to solve encrypted restore or streaming digest
  verification?

## Accessibility And Assistive Reading Posture

This is runtime behavior work, not UI work. The linear reading model must stay
obvious from the new helper name, the RED tests, and the restore-path call
sites.

## Localization And Directionality Posture

This cycle adds no user-facing copy. Directionality is not relevant beyond
using explicit language like "prefer", "fallback", and "chunk restore path".

## Agent Inspectability And Explainability Posture

The compatibility decision must be inspectable in code. A reader should be able
to answer:

- when `readBlobStream()` is used
- when `readBlob()` is used
- which restore path this affects

without reading unrelated plumbing or crypto code.

## Non-Goals

- changing `readManifest()` or other metadata reads to use `readBlobStream()`
- changing encrypted or compressed restore behavior
- adding streaming SHA-256 verification
- changing whole-object AES-GCM semantics
- removing compatibility `readBlob()` support

## Implementation Outline

1. Add RED tests that fail if plaintext restore still prefers `readBlob()`.
2. Add a helper in `CasService` that normalizes blob reads by preferring
   `readBlobStream()` and falling back to `readBlob()`.
3. Route `_readAndVerifyChunk()` through that helper.
4. Verify plaintext restore behavior without changing encrypted or compressed
   restore semantics.

## RED

The failing conditions for this cycle are:

- plaintext restore still calls `readBlob()` even when `readBlobStream()` is
  available
- compatibility fallback to `readBlob()` is not explicit when
  `readBlobStream()` is missing

Tests are the executable spec. The RED spec for this cycle will live in:

- `test/unit/domain/services/CasService.readBlobStream.test.js`
