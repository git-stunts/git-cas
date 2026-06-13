# SEC: No sub-manifest chunk count limit

- **File**: `src/domain/schemas/ManifestSchema.js:133`
- **Severity**: Medium
- **Category**: Resource exhaustion via crafted manifests

## Description

The `subManifests` array in `ManifestSchema` had no `.max()` constraint. A
crafted v2 Merkle manifest with an unbounded number of sub-manifest references
could cause unbounded memory growth during `_resolveSubManifests()`, which pushes
all resolved chunks into a single array.

## Fix

Added `.max(10_000)` to the `subManifests` array schema. With a default
`merkleThreshold` of 1,000 chunks per sub-manifest, this allows up to 10M total
chunks — more than sufficient for any legitimate workload.

## Status

- [x] Resolved — `security/audit-fixes` branch
