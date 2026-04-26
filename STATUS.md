# STATUS

**Last tagged release:** `v5.3.2` (`2026-03-15`)
**Current pre-release version:** `v6.0.0` (on `release/v6.0.0`)
**Playback truth:** `main`
**Runtimes:** Node.js 22.x, Bun, Deno
**Current planning method:** [WORKFLOW.md](./WORKFLOW.md)
**Live backlog:** [docs/method/backlog/README.md](./docs/method/backlog/README.md)

---

`STATUS.md` is a compact snapshot, not the active planning surface.

## Honest State

- The human CLI and TUI are real and materially shipped.
- The machine-facing `git cas agent` surface exists and now supports
  OS-keychain passphrase sources for vault-derived key flows, but parity and
  portability are still partial.
- **v6.0.0 encryption scheme simplification** — `whole-v1`/`whole-v2` collapsed
  to `whole`, `framed-v1`/`framed-v2` collapsed to `framed`, `convergent-v1`
  collapsed to `convergent`. AAD is now always on. Legacy scheme strings in
  stored manifests throw `LEGACY_SCHEME` at `readManifest()` time with
  migration guidance.
- **Migration script** — `npm run upgrade` (or `node scripts/migrate-encryption.js`)
  migrates existing vault entries. Two modes: fast (rename-only for v2 schemes
  and `convergent-v1`) and full (re-encryption for v1 whole/framed schemes that
  lacked AAD). Defaults to dry-run.
- **`legacyMode`** — `CasService` constructor option allows reading legacy
  manifests without throwing `LEGACY_SCHEME`, used by the migration script.
- **Convergent encryption** — new default scheme for CDC + encryption that
  preserves deduplication across encrypted stores.
- New encrypted stores default to `framed`, which provides an authenticated
  streaming encrypted restore path. `whole` remains the explicit compatibility
  whole-object mode for `restoreStream()`, while `restoreFile()` now has a
  bounded temp-file restore path for `whole` and buffered compression modes.
- Buffered `restoreStream()` / `restore()` now enforce `maxRestoreBufferSize`
  against streamed gunzip output and, on stream-native blob adapters, against
  actual blob reads instead of only manifest-estimated sizes.
- Custom persistence adapters must now provide `readBlobStream()` for those
  hard-limited buffered restore modes; `readBlob()` remains a plaintext
  compatibility fallback only.
- Passphrase-bearing store, restore, vault init, and vault rotation now use
  stronger KDF defaults and reject out-of-policy stored metadata before derive
  work begins.
- Stored KDF salt metadata now rejects malformed base64 at both schema time
  and runtime stored-KDF validation, keeping manifest and vault metadata
  aligned before derive work starts.
- Manifest parsing now rejects unsupported encryption schemes,
  `encrypted: false`, malformed AES-GCM nonce/tag values, and framed manifests
  that omit `frameBytes`, across both JSON and CBOR manifest codecs.
- Node, Bun, and Web Crypto decrypt paths now enforce AES-GCM metadata at the
  adapter boundary too, so malformed algorithm, nonce, or tag values are
  rejected before runtime-specific decrypt calls run.
- Web Crypto whole-object decrypt paths are now explicitly bounded by
  `maxDecryptionBufferSize` instead of collecting ciphertext without a guard.
  `framed` remains the actual cross-runtime streaming-encrypted mode.
- Fresh work is now organized through METHOD backlog lanes and numbered cycle
  directories.

## Active Queue Snapshot

- [TR — Platform Dependency Leaks](./docs/method/backlog/bad-code/TR_platform-dependency-leaks.md)

## Read Next

- [docs/method/process.md](./docs/method/process.md)
- [docs/design/README.md](./docs/design/README.md)
- [ROADMAP.md](./ROADMAP.md)
