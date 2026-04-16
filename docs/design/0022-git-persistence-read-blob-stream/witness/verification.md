# Witness — Add Read Blob Stream

This witness records the concrete evidence for cycle
`0022-git-persistence-read-blob-stream`.

## Human Playback

### Question

Can a maintainer point to a RED test that fails because
`GitPersistencePort.readBlobStream()` does not exist yet?

### Answer

Yes.

### Evidence

- The RED specs are in
  [test/unit/ports/GitPersistencePort.test.js](../../../../test/unit/ports/GitPersistencePort.test.js)
  and
  [test/unit/infrastructure/adapters/GitPersistenceAdapter.readBlob.test.js](../../../../test/unit/infrastructure/adapters/GitPersistenceAdapter.readBlob.test.js)
- Before the fix:
  - `port.readBlobStream is not a function`
  - `adapter.readBlobStream is not a function`
  - `stream.collect is not a function`

### Question

After the fix, can a maintainer verify that `readBlobStream()` yields `Buffer`
chunks and that `readBlob()` still returns the same concatenated `Buffer` as
before?

### Answer

Yes.

### Evidence

- `npx vitest run test/unit/ports/GitPersistencePort.test.js test/unit/infrastructure/adapters/GitPersistenceAdapter.readBlob.test.js`
- The adapter test asserts `chunks.every(Buffer.isBuffer) === true`
- The adapter compatibility test asserts `readBlob('blob-oid')` resolves to
  `Buffer.from('blob-data')`

## Agent Playback

### Question

Can an agent inspect the port and adapter and find a stream-native blob read
contract without re-deriving it from plumbing internals?

### Answer

Yes.

### Evidence

- [`GitPersistencePort.readBlobStream()`](../../../../src/ports/GitPersistencePort.js)
- [`GitPersistenceAdapter.readBlobStream()`](../../../../src/infrastructure/adapters/GitPersistenceAdapter.js)
- [`GitPersistenceAdapter.readBlob()`](../../../../src/infrastructure/adapters/GitPersistenceAdapter.js)
- [`CasService.d.ts`](../../../../src/domain/services/CasService.d.ts) now
  declares the stream-native method in the persistence interface

### Question

Can an agent see that this cycle improves the streaming seam without claiming
to solve encrypted restore or end-to-end bounded restore yet?

### Answer

Yes.

### Evidence

- The cycle design doc explicitly names encrypted restore and `CasService`
  behavior as non-goals
- The implementation is confined to the Git persistence seam and reference docs

## Observed Verification

The following checks passed during this cycle:

- `npx vitest run test/unit/ports/GitPersistencePort.test.js test/unit/infrastructure/adapters/GitPersistenceAdapter.readBlob.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`
