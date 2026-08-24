# STATUS

**Last tagged release:** `v6.5.8` (`2026-08-23`)
**Current release state:** `v6.5.8` is published to npm and GitHub Releases.
**Latest verification:** reviewed release merge `57b40553` passed 14/14 release-verifier stages with 7,057 observed tests; signed tag `v6.5.8` peels to that merge, and release workflow `32690361682` published the matching npm artifact plus final GitHub Release.
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
- **v6.5.8 artifact posture** — implementation PR
  [#120](https://github.com/git-stunts/git-cas/pull/120) and release PR
  [#121](https://github.com/git-stunts/git-cas/pull/121) merged normally.
  Signed tag `v6.5.8` resolves to reviewed release merge `57b40553`; npm reports
  `@git-stunts/git-cas@6.5.8` as `latest` with publish and SLSA provenance, and
  release workflow `32690361682` published the final GitHub Release. Bounded
  asset, ordered-bundle, workspace-retention, and Git protocol waves are
  shipped against `@git-stunts/plumbing@3.3.0`. The released-dependency witness
  preserves SHA-1/SHA-256 semantic digests while reducing 16 assets from 49 to
  two Git children and 16 workspace bundles from 147 to eight. JSR dry-run
  validation is healthy, but JSR publication is not part of the release
  workflow.
- **v6.5.7 artifact posture** — implementation PR
  [#116](https://github.com/git-stunts/git-cas/pull/116) and release PR
  [#117](https://github.com/git-stunts/git-cas/pull/117) merged normally.
  Signed tag `v6.5.7` resolves to reviewed release merge `eebc6e37`; npm retains
  `@git-stunts/git-cas@6.5.7` with publish and SLSA provenance, and
  release workflow `32637934268` published the final GitHub Release. Bounded
  session-backed small stream reads are shipped. The fixed 10 MiB ceiling is
  independent of `maxBlobSize`, and larger objects remain genuinely streamed.
  JSR dry-run validation is healthy, but JSR publication is not part of the
  release workflow.
- **v6.5.6 artifact posture** — signed tag `v6.5.6` resolves to reviewed release
  merge `257e8821`; npm retains `@git-stunts/git-cas@6.5.6` with publish and
  SLSA provenance, and release workflow `30526282895` published the final
  GitHub Release. The Bijou 7.2 hosted cockpit and deterministic
  checked-ref conflict classification are shipped. JSR dry-run validation is
  healthy, but JSR publication is not part of the release workflow.
- **v6.5.5 artifact posture** — signed tag `v6.5.5` resolves to reviewed merge
  `9ea91a73`; npm reports `@git-stunts/git-cas@6.5.5` as the retained published
  predecessor with SLSA provenance, and release workflow `30211630524`
  published the final GitHub Release. Identity-independent git-cas-owned
  commits are shipped. JSR dry-run validation is healthy, but JSR publication
  is not part of the release workflow.
- **v6.5.4 artifact posture** — signed tag `v6.5.4` resolves to reviewed merge
  `a2d23f5b`; npm retains `@git-stunts/git-cas@6.5.4` with SLSA provenance, and
  release workflow `30205009357` published the final GitHub
  Release. Batched staging-workspace page retention is shipped. JSR dry-run
  validation is healthy, but JSR publication is not part of the release
  workflow.
- **v6.5.3 artifact posture** — signed tag `v6.5.3` resolves to reviewed merge
  `00df6077`; npm retains `@git-stunts/git-cas@6.5.3` with SLSA
  provenance, and release workflow `29696131557` published the final GitHub
  Release. Coherent Git object sessions are shipped. JSR dry-run validation is
  healthy, but JSR publication is not part of the release workflow.
- **v6.5.2 artifact posture** — signed tag `v6.5.2` resolves to reviewed merge
  `c2d41f60`; npm retains `@git-stunts/git-cas@6.5.2` with SLSA
  provenance, and release workflow `29690794540` published the final GitHub
  Release. Persistent bounded Git object sessions, scoped page-write batches,
  and deterministic local resource closure are shipped. JSR dry-run validation
  is healthy, but JSR publication is not part of the release workflow.
- **v6.5.1 artifact posture** — signed tag `v6.5.1` resolves to reviewed merge
  `49b7d5cb`; npm retains `@git-stunts/git-cas@6.5.1` with SLSA
  provenance, and release workflow `29666480492` published the final GitHub
  Release. Bounded immutable page payload reuse is shipped. JSR dry-run
  validation is healthy, but JSR publication is not part of the release
  workflow.
- **v6.5.0 artifact posture** — signed tag `v6.5.0` resolves to reviewed merge
  `f464b929`; npm retains `@git-stunts/git-cas@6.5.0` with SLSA
  provenance, and the final GitHub Release is published. Bounded direct bundle
  references, immutable metadata reuse, and the RootSet/cache concurrency
  repairs are shipped. JSR dry-run validation is healthy, but JSR publication
  is not part of the release workflow.
- **v6.4.0 artifact posture** — signed tag `v6.4.0` resolves to reviewed merge
  `d47af74a`; npm retains `@git-stunts/git-cas@6.4.0` with SLSA
  provenance, and the final GitHub Release is published. Scoped staging
  workspaces and the corrected structured RootSet lock retry are shipped. JSR
  dry-run validation is healthy, but JSR publication is not part of the release
  workflow.
- **v6.3.0 artifact posture** — signed tag `v6.3.0` resolves to reviewed merge
  `33f4171`; npm retains `@git-stunts/git-cas@6.3.0` with SLSA
  provenance, and the final GitHub Release is published. JSR dry-run validation
  is healthy, but JSR publication is not part of the release workflow.
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
- `ContentAddressableStore.caches.open()` owns TTL/capacity cache indexes and
  their Git reachability, while streaming scans keep residency independent of
  cache cardinality.
- `CacheSet.acquire()` performs a bounded reference-only lookup and anchors the
  exact observed cache generation for an explicit caller lifetime. Release is
  idempotent and generation-checked; doctor exposes bounded acquisition count,
  age, truncation, malformed-ref, and clock-skew evidence.
- `ContentAddressableStore.expiringSets.open()` owns atomic replay-marker
  retention under `refs/cas/expiring/*`. It persists only domain-separated key
  digests, survives process restart, and can release a marker only after its
  expiry through replacement of that same expired key or explicit `sweep()`.
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
- Latest completed release goalpost:
  [#119 v6.5.8: Batch bounded Git write and retention waves](https://github.com/git-stunts/git-cas/issues/119)
  under the
  [`v6.5.8` milestone](https://github.com/git-stunts/git-cas/milestone/18).
- Current queued release goalposts are
  [#39 v6.6.0: Operator TUI](https://github.com/git-stunts/git-cas/issues/39)
  and
  [#40 v6.6.0: Agent automation follow-through](https://github.com/git-stunts/git-cas/issues/40)
  under
  [`v6.6.0`](https://github.com/git-stunts/git-cas/milestone/9).
- The latest landed design record is
  [0059-bounded-write-waves](./docs/design/0059-bounded-write-waves/bounded-write-waves.md).

## Read Next

- [docs/method/process.md](./docs/method/process.md)
- [docs/design/README.md](./docs/design/README.md)
- [ROADMAP.md](./ROADMAP.md)
