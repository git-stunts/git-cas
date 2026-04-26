# SEC: frameBytes has no upper bound

- **File**: `src/domain/services/CasService.js:410-424`
- **Severity**: Low
- **Category**: Resource exhaustion

## Description

`_resolveFramedStoreEncryptionConfig()` validated `frameBytes` as a positive
integer but had no upper bound. A caller could set `Number.MAX_SAFE_INTEGER`,
causing the framed encryption path to accumulate all source data into a single
frame before encrypting — defeating the purpose of framed encryption and
potentially exhausting memory.

## Fix

Capped `frameBytes` at 64 MiB (`67,108,864` bytes).

## Status

- [x] Resolved — `security/audit-fixes` branch
