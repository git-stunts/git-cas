# TR — RestoreFile Service Internal Coupling

## Why This Exists

`restoreFile()` now has the bounded temp-file path that `whole-v1` needed, but
the implementation currently reaches into `CasService` internal helpers such as
`_validatedEncryptionMeta()`, `_iterVerifiedChunkBlobs()`,
`_resolveRestoreKey()`, and `_decompressStreaming()`.

That works, but it means the file adapter is coupled to service internals
instead of a deliberately shaped lower-level restore contract.

## Target Outcome

Design and land an explicit restore-helper seam for file publication that:

- keeps `restoreStream()` honest as the generic async byte API
- exposes only the lower-level restore pieces the file adapter actually needs
- reduces direct adapter dependence on underscored service internals
- preserves the bounded temp-file publication behavior

## Human Value

Maintainers should be able to change restore internals without accidentally
breaking file publication logic hidden behind underscore-method coupling.

## Agent Value

Agents should be able to reason about the file restore boundary from a named
contract instead of inferring which internal helpers are safe to call.

## Notes

- keep this scoped to restore/file-helper coupling
- do not turn it into a generic service decomposition epic
