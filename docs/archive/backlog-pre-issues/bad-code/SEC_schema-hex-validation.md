# SEC: OID/digest fields lacked hex validation in schemas

- **File**: `src/domain/schemas/ManifestSchema.js:22-30,117`
- **Severity**: Medium
- **Category**: Schema bypass / mktree format injection

## Description

`ChunkSchema.blob`, `ChunkSchema.digest`, and `SubManifestRefSchema.oid` accepted
any non-empty string. A crafted manifest could inject tabs, newlines, spaces, or
arbitrary strings into `git mktree` stdin entries — corrupting tree construction.

`digest` only validated length (64 chars) but not hex charset, allowing non-hex
digests that could bypass integrity comparisons.

## Fix

- `digest`: `z.string().regex(/^[0-9a-f]{64}$/)` — enforces 64-char lowercase hex.
- `blob` and `oid`: `gitOidSchema` — enforces 40-char (SHA-1) or 64-char (SHA-256) lowercase hex.

## Status

- [x] Resolved — `security/audit-fixes` branch
