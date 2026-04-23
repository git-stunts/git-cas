# SEC: Chunk constructor copies raw input instead of parsed output

- **File**: `src/domain/value-objects/Chunk.js:26-27`
- **Severity**: Medium
- **Category**: Deserialization / property pollution

## Description

`Object.assign(this, data)` copied properties from the original `data` argument
rather than the Zod-parsed result. Since `z.object()` strips unknown keys, the
parsed output is safe — but the raw input can carry arbitrary extra properties
(including prototype-method overrides like `hasOwnProperty`, `toString`).

These extra properties were frozen onto the Chunk instance, surviving through the
entire store/restore pipeline.

## Fix

Changed to `Object.assign(this, ChunkSchema.parse(data))` so only validated,
schema-defined properties are assigned.

## Status

- [x] Resolved — `security/audit-fixes` branch
