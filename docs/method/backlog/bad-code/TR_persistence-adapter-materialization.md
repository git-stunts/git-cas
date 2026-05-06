# BAD CODE: GitPersistenceAdapter Full Materialization

## Context
`GitPersistenceAdapter.readBlob` currently converts the underlying asynchronous stream into a single concatenated `Buffer`.

## Symptoms
- Peak memory usage scales O(N) with asset size.
- Large blob verification (e.g., in `CasService`) will exhaust the Node.js heap even though the underlying port supports streaming.
- Unnecessary GC pressure during heavy restore operations.

## Proposed Fix
Refactor `GitPersistenceAdapter.readBlob` to include a strict 10MB guard and enforce the use of `readBlobStream` for all domain-level data operations.
