# TR: CasService remains the dominant orchestration hotspot

- **File**: `src/domain/services/CasService.js`
- **Severity**: Medium
- **Category**: Domain-service cohesion
- **Status**: Resolved for v6.0.0

## Description

`CasService.js` was over 2,500 lines and still coordinated store, restore,
encryption scheme selection, manifest reads, tree publication, integrity
verification, recipient mutation flows, and migration-facing raw manifest reads.

Several important extractions already happened (`KeyResolver`,
`ConvergentEncryption`, `PrefetchWindow`, compression ports), but future changes
still tend to land in the same service.

## Why It Bothers Us

The current shape works and is well tested, but it increases review cost and
makes every new security or streaming behavior feel coupled to unrelated
manifest and vault paths.

## Follow-Up

- [x] Extract store write scheduling, backpressure, in-flight write tracking, and
  store error normalization into `StorePipeline`.
- [x] Extract restore strategy classification and handler dispatch into
  `RestorePipeline`.
- [x] Keep the public `CasService.store()`, `restore()`, and `restoreStream()`
  APIs stable while adding boundary tests for the extracted services.

## Resolution

The v6.0.0 release blocker is cleared by moving the highest-risk orchestration
decisions out of `CasService.js`: write concurrency and error metadata now live
in `src/domain/services/StorePipeline.js`, while restore strategy selection and
dispatch now live in `src/domain/services/RestorePipeline.js`. The remaining
manifest/tree publication and recipient mutation extractions stay on the
published decomposition trajectory, but they are no longer pre-tag blockers.

## Residual Follow-Up

- Extract manifest/tree publication after store behavior is stable.
- Extract recipient mutation flows separately from restore.
