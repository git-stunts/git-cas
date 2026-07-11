# STATUS

**Last tagged release:** `v6.1.0` (`2026-07-11`)
**Current release state:** `v6.1.0` is published to npm and GitHub Releases; JSR publication remains deferred behind the upstream toolchain gate.
**Latest verification:** `npm run release:verify -- --skip-jsr` passed 12/12 steps with 5,521 observed tests on `2026-07-11`; release run `29170112655` also passed lint, unit tests, Node/Bun/Deno integration, npm trusted publication, and GitHub Release creation.
**Playback truth:** `main`
**Runtimes:** Node.js 22.x, Bun, Deno
**Current planning method:** [WORKFLOW.md](./WORKFLOW.md)
**Live tracker:** [GitHub Issues](https://github.com/git-stunts/git-cas/issues) and [Milestones](https://github.com/git-stunts/git-cas/milestones)

---

`STATUS.md` is a compact snapshot, not the active planning surface.

## Honest State

- The human CLI and TUI are real and materially shipped.
- The machine-facing `git cas agent` surface exists and now supports
  OS-keychain passphrase sources for vault-derived key flows, but parity and
  portability are still partial.
- **v6.1.0 artifact posture** — npm publication and the GitHub Release are
  complete through tag `v6.1.0`. JSR publication is deferred because the current
  `jsr`/Deno toolchain panics before package validation; it can return in a
  later 6.x maintenance change once its dry-run is healthy.
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
- Fixed-chunk encrypted stores default to `framed`, which provides an
  authenticated streaming encrypted restore path. CDC encrypted stores default
  to `convergent`, preserving deduplication across encrypted versions. `whole`
  remains the explicit compatibility whole-object mode for `restoreStream()`,
  while `restoreFile()` now has a bounded temp-file restore path for `whole`
  and buffered compression modes.
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
- Vault internals are decomposed behind the same public API: `VaultService` now
  orchestrates use cases while dedicated collaborators own persistence, tree-OID
  cache state, metadata/tree codecs, privacy indexing, key verification, and retry
  policy.
- Store Wizard execution now uses the same `storeFile()` option payload it
  presents in the UI: passphrase/convergent encryption, gzip compression, and
  fixed/CDC chunking choices are threaded into the CAS facade before the
  manifest is published to the vault.
- `ContentAddressableStore.store()` and `storeFile()` accept per-operation
  `chunking` overrides, so one store can use CDC or fixed chunking without
  mutating the facade's default chunker.
- `ContentAddressableStore.rootSets.open()` provides ref-backed current-set
  retention for caches and derived state. Present entries are Git-anchored;
  removed entries are not retained by root-set commit history. Root sets expose
  compare-and-swap mutation plus doctor/repair reports.
- Manifest parsing now rejects unsupported encryption schemes,
  `encrypted: false`, malformed AES-GCM nonce/tag values, and framed manifests
  that omit `frameBytes`, across both JSON and CBOR manifest codecs.
- Node, Bun, and Web Crypto decrypt paths now enforce AES-GCM metadata at the
  adapter boundary too, so malformed algorithm, nonce, or tag values are
  rejected before runtime-specific decrypt calls run.
- Web Crypto whole-object decrypt paths are now explicitly bounded by
  `maxDecryptionBufferSize` instead of collecting ciphertext without a guard.
  `framed` remains the actual cross-runtime streaming-encrypted mode.
- Fresh work is now tracked through GitHub Issues and Milestones. Repo Markdown
  carries design docs, witnesses, public docs, release history, and archived
  planning source material.
- TUI modernization is queued for the v6.x line after v6.0.0, not as a v6.0.0
  tag blocker.

## Active Queue Snapshot

- GitHub Issues are canonical. If this section and GitHub disagree, GitHub
  wins and this section should be corrected.
- Current selected release goalpost:
  [#38 v6.1.0: Bounded Residency](https://github.com/git-stunts/git-cas/issues/38)
  under the
  [`v6.1.0` milestone](https://github.com/git-stunts/git-cas/milestone/2).
- The next local design record is
  [0045-v6-1-bounded-residency](./docs/design/0045-v6-1-bounded-residency/bounded-residency.md).

## Read Next

- [docs/method/process.md](./docs/method/process.md)
- [docs/design/README.md](./docs/design/README.md)
- [ROADMAP.md](./ROADMAP.md)
