# STATUS

**Last tagged release:** `v5.3.2` (`2026-03-15`)
**Current package version on `main`:** `v5.3.3`
**Playback truth:** `main`
**Runtimes:** Node.js 22.x, Bun, Deno
**Current planning method:** [WORKFLOW.md](./WORKFLOW.md)
**Live backlog:** [docs/method/backlog/README.md](./docs/method/backlog/README.md)

---

`STATUS.md` is a compact snapshot, not the active planning surface.

## Honest State

- The human CLI and TUI are real and materially shipped.
- The machine-facing `git cas agent` surface exists, but parity and
  portability are still partial.
- `framed-v1` now provides an authenticated streaming encrypted restore path;
  `whole-v1` remains the compatibility whole-object mode for `restoreStream()`,
  while `restoreFile()` now has a bounded temp-file restore path for
  `whole-v1` and buffered compression modes.
- Buffered `restoreStream()` / `restore()` now enforce `maxRestoreBufferSize`
  against streamed gunzip output and, on stream-native blob adapters, against
  actual blob reads instead of only manifest-estimated sizes.
- Passphrase-bearing store, restore, vault init, and vault rotation now use
  stronger KDF defaults and reject out-of-policy stored metadata before derive
  work begins.
- Manifest parsing now rejects unsupported encryption schemes,
  `encrypted: false`, malformed AES-GCM nonce/tag values, and framed manifests
  that omit `frameBytes`, across both JSON and CBOR manifest codecs.
- Web Crypto whole-object decrypt paths are now explicitly bounded by
  `maxDecryptionBufferSize` instead of collecting ciphertext without a guard.
  `framed-v1` remains the actual cross-runtime streaming-encrypted mode.
- Fresh work is now organized through METHOD backlog lanes and numbered cycle
  directories.

## Active Queue Snapshot

- [TR — Platform-Agnostic CLI Plan](./docs/method/backlog/up-next/TR_platform-agnostic-cli-plan.md)
- [TR — Framed-v1 Default Encrypted Store](./docs/method/backlog/up-next/TR_framed-v1-default-encrypted-store.md)
- [TR — CasService Decomposition Plan](./docs/method/backlog/bad-code/TR_casservice-decomposition-plan.md)

## Read Next

- [docs/method/process.md](./docs/method/process.md)
- [docs/design/README.md](./docs/design/README.md)
- [ROADMAP.md](./ROADMAP.md)
