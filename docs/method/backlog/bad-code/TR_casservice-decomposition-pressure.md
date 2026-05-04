# TR: CasService remains the dominant orchestration hotspot

- **File**: `src/domain/services/CasService.js`
- **Severity**: Medium
- **Category**: Domain-service cohesion

## Description

`CasService.js` is over 2,500 lines and still coordinates store, restore,
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

- Extract store orchestration into `StorePipeline`.
- Extract manifest/tree publication after store behavior is stable.
- Extract recipient mutation flows separately from restore.
- Delay restore-pipeline extraction until example/docs drift is fixed so release
  truth is not mixed with structural cleanup.
