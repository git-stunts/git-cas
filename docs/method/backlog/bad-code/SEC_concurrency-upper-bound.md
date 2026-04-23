# SEC: concurrency has no upper bound

- **File**: `src/domain/services/CasService.js:80-82`
- **Severity**: Low
- **Category**: Resource exhaustion

## Description

The `concurrency` constructor parameter was validated as a positive integer but
had no upper bound. A caller could pass `1,000,000`, creating a Semaphore that
allows unbounded parallel git subprocess spawns — exhausting file descriptors,
memory, or process limits.

## Fix

Capped concurrency at 64.

## Status

- [x] Resolved — `security/audit-fixes` branch
