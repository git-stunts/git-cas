# 0041-restorefile-service-internal-coupling

## Title

Replace `restoreFile()` underscore coupling with an explicit file-restore plan

## Why

`restoreFile()` has the bounded temp-file behavior that `whole-v1` needed, but
the adapter currently reaches into `CasService` underscore helpers:

- `_validatedEncryptionMeta()`
- `_iterVerifiedChunkBlobs()`
- `_resolveRestoreKey()`
- `_decompressStreaming()`

That makes the file adapter depend on service internals instead of a named
restore contract.

## Decision

Add `CasService.createFileRestorePlan()` as the explicit seam for file
publication. The service decides whether restore can stream directly or must
use the bounded temp-file path, and the adapter consumes that plan without
reaching into underscored methods.

## Scope

This cycle covers:

- one named file-restore plan seam on `CasService`
- rewiring `FileIOHelper.restoreFile()` to consume that seam
- one focused adapter test proving bounded-file publication does not need
  underscore helpers

This cycle does not cover:

- broader `CasService` decomposition
- changing restore semantics
- redesigning the buffered restore implementation

## Playback Questions

1. Does `FileIOHelper` now use a named restore plan instead of underscore
   methods?
2. Does bounded temp-file behavior still hold for buffered restore modes?
3. Did the cycle stay scoped and avoid reopening full `CasService`
   decomposition?

## Red Tests

The executable spec will live in:

- `test/unit/infrastructure/adapters/FileIOHelper.test.js`

## Green Shape

`restoreFile()` should operate on one explicit `createFileRestorePlan()` seam,
with `CasService` owning the decision between direct streaming and bounded
temp-file restore sources.
