# Method Backlog

This is the active backlog for fresh `git-cas` work.

The lane is the priority:

- `inbox/` — raw capture
- `asap/` — pull this soon
- `up-next/` — likely after the current pull
- `cool-ideas/` — interesting, not committed
- `bad-code/` — debt that works but bothers us
- `v6.0.0/` — release gate items (must complete before tag/publish)
- `v6.x-tui/` — post-6.0 TUI modernization work for the v6 release line

Backlog filenames use legend prefixes when they belong to a named domain and do
not use numeric IDs.

## Current Lanes

### `inbox/`

- none currently

### `asap/`

- none currently

### `up-next/`

- none currently

### `v6.0.0/` (release gate)

Active:

1. [REL — Audit Blocker Burn-Down](./v6.0.0/REL_audit-blocker-burn-down.md) — all non-TUI May 4 audit leftovers now block `v6.0.0`
2. [REL — Version Bump](./v6.0.0/REL_version-bump.md) — tag/publish gate; JSR publication is deferred externally

Resolved:

- [REL — Migration Script](./v6.0.0/REL_migration-script.md) — `npm run upgrade` with dry-run + execute modes
- [REL — Breaking Changes Doc](./v6.0.0/REL_breaking-changes-doc.md) — `UPGRADING.md` with migration guide
- [REL — Docs Accuracy Audit](./v6.0.0/REL_docs-accuracy-audit.md) — GUIDE examples and tracked Markdown links covered by tests
- [REL — Signpost Rewrite](./v6.0.0/REL_signpost-rewrite.md) — README, BEARING, VISION, STATUS for v6

### `v6.x-tui/` (Bijou v5 TUI modernization)

Post-6.0 minor release line, not a v6.0.0 tag blocker.

1. [TUI-001 — Framed App Shell](./v6.x-tui/TUI_framed-app-shell.md) — Foundation: `createFramedApp()` + `startApp()`
2. [TUI-002 — boxV3 -> boxSurface](./v6.x-tui/TUI_box-surface-migration.md) — Breaking API fix (Small)
3. [TUI-003 — Status Bar](./v6.x-tui/TUI_status-bar.md) — Persistent bottom bar
4. [TUI-004 — Toast Notifications](./v6.x-tui/TUI_toast-notifications.md) — Replace custom toast with built-in
5. [TUI-005 — Badge Components](./v6.x-tui/TUI_badge-components.md) — Bijou `badge` for encryption/compression tags
6. [TUI-006 — Layout Primitives](./v6.x-tui/TUI_layout-primitives.md) — hstack/vstack/flex/grid
7. [TUI-007 — Help Overlay](./v6.x-tui/TUI_help-overlay.md) — `?` key -> full keybinding reference
8. [TUI-008 — Merkle DAG Viewer](./v6.x-tui/TUI_merkle-dag-viewer.md) — `dagPane` for manifest structure
9. [TUI-009 — Interactive Store Wizard](./v6.x-tui/TUI_store-wizard.md) — Guided store flow inside TUI
10. [TUI-010 — Pager Scrollable Content](./v6.x-tui/TUI_pager-scrollable-content.md) — Scrollable detail pane
11. [TUI-011 — Accordion Detail Pane](./v6.x-tui/TUI_accordion-detail-pane.md) — Collapsible manifest sections
12. [TUI-012 — Animated Transitions](./v6.x-tui/TUI_animated-transitions.md) — Spring physics + transition shaders
13. [TUI-013 — Full-Screen Detail View](./v6.x-tui/TUI_fullscreen-detail-view.md) — Replace split pane with list/detail drill-in
14. [TUI-014 — Orphaned-Chunk Health Check](./v6.x-tui/TUI_orphaned-chunk-health-check.md) — Dashboard-visible CAS reachability health

### `cool-ideas/`

Active:

- [DX — One-step CAS Opener](./cool-ideas/DX_open-cas-helper.md)
- [OPS — Release-Gate Docs and Examples Drift Guard](./cool-ideas/OPS_release-doc-drift-guard.md)
- [TR — Adaptive Framed-Encryption Sizing](./cool-ideas/TR_adaptive-frame-sizing.md)
- [TR — Convergent Encryption](./cool-ideas/TR_convergent-encryption.md) ✅
- [TR — Browser Compression Adapter](./cool-ideas/TR_browser-compression-adapter.md)
- [TR — Manifest Diffing](./cool-ideas/TR_manifest-diffing.md) ✅
- [TR — Parallel Chunk Restore](./cool-ideas/TR_parallel-chunk-restore.md) ✅
- [TR — Content-Aware Chunking](./cool-ideas/TR_content-aware-chunking.md)
- [TUI — CLI Adaptive Table](./cool-ideas/TUI_cli-adaptive-table.md)
- [TUI — Operation Feed Drawer](./cool-ideas/TUI_operation-feed-drawer.md)
- [TUI — OS Keychain Auto-Discovery](./cool-ideas/TUI_os-keychain-auto-discovery.md)
- [TUI — Segmented Manifest View](./cool-ideas/TUI_segmented-manifest-view.md)
- [TUI — Title Screen Stats](./cool-ideas/TUI_title-screen-stats.md)

Resolved — `security/audit-fixes` branch:

- [TR — Dual Encryption Modes](./cool-ideas/TR_dual-encryption-modes.md) ✅
- [TR — Manifest Signing](./cool-ideas/TR_manifest-signing.md) ✅
- [TR — Streaming Decryption](./cool-ideas/TR_streaming-decryption.md) ✅
- [TR — Vault Privacy Mode](./cool-ideas/TR_vault-privacy-mode.md) ✅
- [SEC — AES-GCM AAD Binding](./cool-ideas/SEC_aes-gcm-aad-binding.md) ✅
- [SEC — FastCDC Dual-Mask Normalization](./cool-ideas/SEC_fastcdc-dual-mask.md) ✅
- [SEC — Manifest-Level Integrity Hash](./cool-ideas/SEC_manifest-integrity-hash.md) ✅

Resolved — 2026-05-05 final v6 release polish:

- [DX — Slug Tree-Path Helper](./cool-ideas/DX_slug-tree-path-helper.md) ✅

### `bad-code/`

Active:

- [BAD-CODE-001 — CasService God Object](./bad-code/BAD-CODE-001_casservice-god-object.md)
- [TUI — Store Wizard Execution Gap](./bad-code/TUI_store-wizard-execution-gap.md)

Resolved — 2026-05-05 core orchestration cleanup:

- [TR — CasService Decomposition Pressure](./bad-code/TR_casservice-decomposition-pressure.md) ✅

Resolved — 2026-05-05 final v6 release polish:

- [RL — Credential Resolution Duplication](./bad-code/RL_credential-resolution-duplication.md) ✅

Resolved — 2026-05-05 agent boundary cleanup:

- [RL — Agent CLI Module Size](./bad-code/RL_agent-cli-module-size.md) ✅

Resolved — 2026-05-05 release-truth cleanup:

- [DOC — API Reference Plumbing Constructor Drift](./bad-code/DOC_api-plumbing-constructor-drift.md) ✅
- [DOC — Examples Uint8Array Drift](./bad-code/DOC_examples-uint8array-drift.md) ✅
- [DOC — Threat Model Scheme Drift](./bad-code/DOC_threat-model-scheme-drift.md) ✅
- [SEC — Inline Passphrase Flags](./bad-code/SEC_inline-passphrase-flags.md) ✅
- [SEC — Vault Nonce Exhaustion Cap](./bad-code/SEC_vault-nonce-exhaustion-cap.md) ✅
- [SEC — Vault Passphrase Verifier Gap](./bad-code/SEC_vault-passphrase-verifier-gap.md) ✅

Resolved — `security/audit-fixes` branch:

- [SEC — Chunk Constructor Property Leak](./bad-code/SEC_chunk-constructor-property-leak.md) ✅
- [SEC — Schema Hex Validation](./bad-code/SEC_schema-hex-validation.md) ✅
- [SEC — Scrypt Memory Budget](./bad-code/SEC_scrypt-memory-budget.md) ✅
- [SEC — Sub-Manifest Array Limit](./bad-code/SEC_submanifest-array-limit.md) ✅
- [SEC — encodeSlug Control Chars](./bad-code/SEC_encode-slug-control-chars.md) ✅
- [SEC — KDF Salt Min Length](./bad-code/SEC_kdf-salt-min-length.md) ✅
- [SEC — frameBytes Upper Bound](./bad-code/SEC_framebytes-upper-bound.md) ✅
- [SEC — Concurrency Upper Bound](./bad-code/SEC_concurrency-upper-bound.md) ✅
- [SEC — Sub-Manifest chunkCount Integrity](./bad-code/SEC_submanifest-chunkcount-integrity.md) ✅
- [SEC — Recipient Timing Oracle](./bad-code/SEC_recipient-timing-oracle.md) ✅
- [SEC — Store Source Validation](./bad-code/SEC_store-source-validation.md) ✅
- [SEC — Sub-Manifest Chunks Unvalidated](./bad-code/SEC_submanifest-chunks-unvalidated.md) ✅
- [TR — Platform Dependency Leaks](./bad-code/TR_platform-dependency-leaks.md) ✅
- [TR — Dead _decompress() Method](./bad-code/TR_dead-decompress-method.md) ✅
- [TR — Domain Imports Infrastructure](./bad-code/TR_domain-imports-infrastructure.md) ✅
- [TR — CryptoPort node:crypto Import](./bad-code/TR_cryptoport-node-import.md) ✅
- [TR — ManifestSchema node:buffer Import](./bad-code/TR_schema-node-buffer-import.md) ✅
