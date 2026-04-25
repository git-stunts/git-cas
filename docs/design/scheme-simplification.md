# Design: Encryption Scheme Simplification

## Problem

5 encryption schemes (`whole-v1`, `whole-v2`, `framed-v1`, `framed-v2`,
`convergent-v1`) when there should be 3. The v1/v2 distinction exists solely
for backward compatibility — v2 adds AAD, v1 doesn't. This is sludge.

## Solution

### 1. Collapse to 3 schemes

| Old | New | AAD |
|-----|-----|-----|
| `whole-v1` | (legacy — migration only) | no |
| `whole-v2` | `whole` | always |
| `framed-v1` | (legacy — migration only) | no |
| `framed-v2` | `framed` | always |
| `convergent-v1` | `convergent` | N/A (deterministic keys) |

### 2. Add `formatVersion` to manifests

```json
{
  "formatVersion": "6.0.0",
  "scheme": "framed",
  ...
}
```

Semver of the writer. Tells migration scripts what capabilities produced the
manifest. Stored in the encryption metadata alongside scheme.

### 3. Legacy decode in migration script only

`scripts/migrate-encryption.js` — reads v1 manifests, decrypts without AAD,
re-encrypts with AAD under the new scheme name, writes new manifest.

The main codebase (`CasService`) only knows `whole`, `framed`, `convergent`.
If it encounters a v1 scheme, it throws `LEGACY_SCHEME` error pointing the
user to the migration script.

### 4. Simplified restore dispatch

```
_classifyRestoreStrategy(scheme, manifest):
  convergent + compressed → convergent-compressed
  convergent             → convergent
  framed + compressed    → framed-compressed
  framed                 → framed
  whole + compressed     → buffered (GCM constraint)
  whole                  → buffered (GCM constraint)
  plaintext + compressed → compressed-streaming  ← FIX: was buffered, now streaming
  plaintext              → streaming
```

### 5. Fix plaintext+gzip streaming gap

While simplifying, fix the one restore path that buffers unnecessarily:
plaintext+gzip should use `_decompressStreaming` directly.
