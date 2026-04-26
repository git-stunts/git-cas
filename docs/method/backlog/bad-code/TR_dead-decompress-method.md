# TR: Dead _decompress() method in CasService

- **File**: `src/domain/services/CasService.js:1643`
- **Severity**: Low
- **Category**: Dead code

## Description

`_decompress(buffer)` is defined but has zero callers. The bounded paths
`_decompressBufferedWithLimit()` and `_decompressStreaming()` replaced it.
The method is a leftover from before the size-guarded decompression paths
were introduced.

## Fix

Delete the dead method.

## Status

- [x] Resolved — `security/audit-fixes` branch
