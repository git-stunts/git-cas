# TR: ManifestSchema imports node:buffer unnecessarily

- **File**: `src/domain/schemas/ManifestSchema.js:6`
- **Severity**: Low
- **Category**: Unnecessary platform coupling

## Description

`ManifestSchema.js` imports `Buffer` from `node:buffer`. `Buffer` is a global
in Node.js, Bun, and Deno — the explicit import is unnecessary and creates a
platform coupling in the schema layer. In a browser environment, this import
would fail even though `Buffer` could be polyfilled globally.

## Fix

Remove `import { Buffer } from 'node:buffer'` and rely on the global `Buffer`.
If browser support is needed later, the polyfill can provide the global.

## Status

- [x] Resolved — `security/audit-fixes` branch
