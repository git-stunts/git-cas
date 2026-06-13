# BAD CODE: Vault Tree Memory Loading

## Context
`VaultService.#readCachedVaultTree` (and its dependencies) currently reads and parses the entire Git tree into a `Map` of slugs to OIDs.

## Symptoms
- High memory usage in repositories with 10k+ assets.
- Latency during `git-cas list` or any operation requiring a slug resolution.
- Potential OOM crashes in constrained environments (containers/edge).

## Proposed Fix
Refactor `VaultService` to use `git ls-tree <tree-oid> <slug>` for direct resolution and implement a streaming/paginated reader for the list operation.
