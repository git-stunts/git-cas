# @git-stunts/cas — Project Status

**Current version:** v5.1.0 (Locksmith)
**Last release:** 2026-02-28
**Test suite:** 757 tests (vitest)
**Runtimes:** Node.js 22.x, Bun, Deno

---

## What's shipped

| Version | Codename | Highlights |
|---------|----------|------------|
| v5.1.0 | Locksmith | Envelope encryption (DEK/KEK), multi-recipient APIs, `--recipient` CLI, recipient management |
| v5.0.0 | Hydra | Content-defined chunking (CDC), `ChunkingPort`, buzhash engine, 98% dedup on edits |
| v4.0.1 | Spit Shine + Cockpit | CryptoPort refactor, `verify` command, `--json` mode, `runAction`, vault list filtering |
| v4.0.0 | Conduit | ObservabilityPort, `restoreStream()`, parallel chunk I/O, `concurrency` option |
| v3.1.0 | Bijou | Interactive vault dashboard, animated progress bars, `git cas inspect`, chunk heatmap |
| v3.0.0 | Vault | GC-safe ref-based storage (`refs/cas/vault`), slug-based addressing, vault CLI |
| v2.0.0 | Horizon | Compression (gzip), KDF (pbkdf2/scrypt), Merkle manifests |
| v1.x | — | Core CAS, AES-256-GCM encryption, fixed chunking, Git ODB persistence |

---

## What's next

One open milestone remains.

### M12 — Carousel (~13h)
Key rotation without re-encrypting data. Now unblocked by M11 Locksmith.

- [ ] **12.1** Key rotation workflow (`rotateKey()`)
- [ ] **12.2** Key version tracking in manifest
- [ ] **12.3** CLI key rotation commands
- [ ] **12.4** Vault-level key rotation

---

## Dependency graph

```
M8 Spit Shine ──────── ✅ v4.0.1
M9 Cockpit ─────────── ✅ v4.0.1
M10 Hydra ──────────── ✅ v5.0.0
M11 Locksmith ──────── ✅ v5.1.0
  └──► M12 Carousel ── (ready)
```

---

## Backlog (unscheduled ideas)

- Named vaults (`refs/cas/vaults/<name>`)
- Export vault to archive
- Publish to working tree / branch
- Duplicate detection on store
- Repo scan / dedup advisor
- Add `CODEOWNERS` or reviewer auto-assignment for PRs
- Document Git tree filename ordering semantics in test conventions
- Define release-prep workflow for CHANGELOG/version bump timing
- Automate test count injection into CHANGELOG from CI output
- Property-based fuzz tests for envelope encryption round-trips
- Investigate HSM/Vault key management as a future `KeyManagementPort`

## Visions (researched, not committed)

- **V1** Snapshot trees — directory-level store (~410 LoC, ~19h)
- **V2** Portable bundles — air-gap transfer (~340 LoC, ~15h)
- **V3** Manifest diff engine (~180 LoC, ~8h)
- **V4** CompressionPort — zstd, brotli, lz4 (~180 LoC, ~8h)
- **V5** Watch mode — continuous sync (~220 LoC, ~10h)
- **V6** Interactive passphrase prompt (~90 LoC, ~4h)

## Known concerns

| # | Issue | Severity | Summary |
|---|-------|----------|---------|
| C1 | Memory amplification | High | Encrypted/compressed restore buffers entire file |
| C2 | Orphaned blobs | Medium | STREAM_ERROR leaves unreferenced blobs in ODB |
| C3 | No chunk size cap | Medium | No upper bound on configured chunk size |
| C4 | Web Crypto buffering | Medium | Deno adapter silently buffers entire file |
| C5 | Passphrase exposure | High | `--vault-passphrase` visible in shell history |
| C6 | KDF no rate limit | Low | No brute-force detection on failed decryption |
| C7 | GCM nonce collision | Low | 96-bit random nonce, safe to ~2^32 encryptions |

---

*Full task cards: [ROADMAP.md](./ROADMAP.md) | Completed: [COMPLETED_TASKS.md](./COMPLETED_TASKS.md) | Superseded: [GRAVEYARD.md](./GRAVEYARD.md)*
