# SEC: store() doesn't validate async iterable source

- **File**: `src/domain/services/CasService.js:752`
- **Severity**: Low
- **Category**: Input validation gap

## Description

`store()` accepted `source` without verifying it implements the async iterable
protocol (`Symbol.asyncIterator`). Passing `null`, a `Buffer`, or a `string`
produced confusing errors deep inside the chunker rather than a clear validation
error at the API boundary.

## Fix

Added early guard: `if (!source || typeof source[Symbol.asyncIterator] !== 'function')`.

## Status

- [x] Resolved — `security/audit-fixes` branch
