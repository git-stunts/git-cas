# Add Read Blob Stream

- Cycle: `0022-git-persistence-read-blob-stream`
- Type: `Code`
- Sponsor human: James
- Sponsor agent: Codex

## Hill

`GitPersistencePort` should expose a stream-native blob read method so callers
can consume Git blob bytes incrementally without forcing an early `Buffer`
materialization at the adapter boundary.

The compatibility `readBlob()` surface should remain available and should be
implemented in terms of the new stream-native method.

## Playback Questions

### Human

- Can a maintainer point to a RED test that fails because
  `GitPersistencePort.readBlobStream()` does not exist yet?
- After the fix, can a maintainer verify that `readBlobStream()` yields `Buffer`
  chunks and that `readBlob()` still returns the same concatenated `Buffer` as
  before?

### Agent

- Can an agent inspect the port and adapter and find a stream-native blob read
  contract without re-deriving it from plumbing internals?
- Can an agent see that this cycle improves the streaming seam without claiming
  to solve encrypted restore or end-to-end bounded restore yet?

## Accessibility And Assistive Reading Posture

This is runtime and API work, not UI work. The linear reading model must stay
obvious from the port signature, the adapter method names, and the RED tests.

## Localization And Directionality Posture

This cycle adds no user-facing copy. Directionality is not relevant beyond
using explicit terms like "stream-native", "compatibility collector", and
"incremental bytes".

## Agent Inspectability And Explainability Posture

The new seam must be obvious at the port boundary. The adapter should show a
clear split between:

- `readBlobStream()` for incremental consumption
- `readBlob()` for compatibility collection

## Non-Goals

- changing `CasService.restoreStream()` behavior
- introducing streaming decryption
- changing whole-object AES-GCM semantics
- removing `readBlob()` from the public persistence contract
- changing write-side blob storage

## Implementation Outline

1. Add RED tests for the port and adapter that expect `readBlobStream()`.
2. Extend `GitPersistencePort` with `readBlobStream()`.
3. Implement `GitPersistenceAdapter.readBlobStream()` on top of
   `plumbing.executeStream({ args: ['cat-file', 'blob', oid] })`.
4. Keep `readBlob()` as the compatibility collector built on the new method.
5. Update the type and reference docs to reflect the new port surface.

## RED

The failing conditions for this cycle are:

- the abstract port has no `readBlobStream()` method
- the adapter cannot return blob data as an async iterable of `Buffer` chunks
- the docs still describe `GitPersistencePort` as buffer-only on the read side

Tests are the executable spec. The RED spec for this cycle will live in:

- `test/unit/ports/GitPersistencePort.test.js`
- `test/unit/infrastructure/adapters/GitPersistenceAdapter.readBlob.test.js`
