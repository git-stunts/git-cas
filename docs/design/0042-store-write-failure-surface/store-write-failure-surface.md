# 0042-store-write-failure-surface

## Title

Make store write failures explicit and metadata-rich

## Why

`CasService._chunkAndStore()` now applies backpressure correctly, but write-side
failures still surface unevenly:

- source or chunker failures become `STREAM_ERROR`
- raw `writeBlob()` failures leak as plain errors
- `CasError` write failures keep their code but do not have a consistent
  dispatch/orphan contract

That makes store failures harder to reason about, document, and test.

## Decision

Define an explicit store-write failure contract:

- raw write failures normalize to `STORE_ERROR`
- `CasError` write failures pass through without code translation
- both paths carry write-phase metadata such as `chunksDispatched` and
  `orphanedBlobs`

## Scope

This cycle covers:

- write-side error normalization inside `CasService`
- RED tests for plain-error normalization and `CasError` passthrough
- public docs for the resulting store error surface

This cycle does not cover:

- source-stream failure behavior
- restore semantics
- broader `CasService` decomposition

## Playback Questions

1. Do raw chunk-write failures now surface as `STORE_ERROR` instead of leaking
   plain errors?
2. Do `CasError` write failures keep their original code while gaining
   `chunksDispatched` and `orphanedBlobs` metadata?
3. Did the cycle stay scoped to write-side normalization?

## Red Tests

The executable spec will live in:

- `test/unit/domain/services/CasService.store-error.test.js`

## Green Shape

Write-phase store failures should have one explicit contract that distinguishes
source failures from sink failures without losing orphaned-blob accounting.
