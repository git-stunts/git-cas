# REL: Implement upgrade/migration script

## What

`npm run upgrade` that detects the user's current manifest versions and
migrates them to v6.0.0 format.

## Migration Matrix

| Source Scheme | Target | Re-encryption? | Why |
|---|---|---|---|
| `whole-v2` | `whole` | No — rename only | Already has AAD (slug) |
| `framed-v2` | `framed` | No — rename only | Already has per-frame AAD |
| `convergent-v1` | `convergent` | No — rename only | Never used AAD (by design) |
| `whole-v1` | `whole` | **Yes** | v1 had no AAD; v6 `whole` requires AAD |
| `framed-v1` | `framed` | **Yes** | v1 had no AAD; v6 `framed` requires AAD |
| (no scheme) | `whole` | **Yes** | Pre-scheme manifests need scheme + AAD |

## Two Modes

1. **Fast mode** (rename-only): For v2 schemes and convergent. Updates manifest
   metadata, rewrites Git tree entry. No blob changes. Seconds.
2. **Full mode** (re-encrypt): For v1 schemes. Decrypts with no AAD, re-encrypts
   with AAD, writes new blobs, updates manifest. Requires passphrase/key.

## Implementation

- `scripts/migrate-encryption.js` — the orchestration logic
- `npm run upgrade` in package.json — user-facing entry point
- Reads vault, iterates entries, detects scheme per manifest
- Reports what needs migration before doing it (dry-run by default)
- `--execute` flag to actually perform migration
- Progress reporting via stdout

## Acceptance Criteria

- [x] `npm run upgrade` produces a dry-run report
- [x] `npm run upgrade -- --execute` migrates all entries
- [x] v2 schemes are renamed without re-encryption
- [x] v1 schemes are re-encrypted with AAD
- [ ] Migrated manifests load cleanly in v6
- [x] Original blobs are not deleted (GC-safe)
- [x] Works on Node 22+
