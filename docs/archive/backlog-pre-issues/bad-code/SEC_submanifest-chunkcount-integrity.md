# SEC: Sub-manifest chunkCount not verified against actual

- **File**: `src/domain/services/CasService.js:1664-1669`
- **Severity**: Low
- **Category**: Integrity gap

## Description

`_resolveSubManifests()` read sub-manifest blobs and pushed their chunks into the
result array without verifying that the number of chunks in the blob matched the
`chunkCount` declared in the sub-manifest reference. A tampered sub-manifest blob
could contain more or fewer chunks than expected, causing silent data corruption.

## Fix

Added assertion: `subDecoded.chunks.length === ref.chunkCount`, throwing
`MANIFEST_INTEGRITY_ERROR` on mismatch.

## Status

- [x] Resolved — `security/audit-fixes` branch
