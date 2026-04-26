# Method Backlog

This is the active backlog for fresh `git-cas` work.

The lane is the priority:

- `inbox/` — raw capture
- `asap/` — pull this soon
- `up-next/` — likely after the current pull
- `cool-ideas/` — interesting, not committed
- `bad-code/` — debt that works but bothers us
- `v6.0.0/` — release gate items (must complete before version bump)

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

1. [REL — Migration Script](./v6.0.0/REL_migration-script.md) — `npm run upgrade` with dry-run + execute modes
2. [REL — Breaking Changes Doc](./v6.0.0/REL_breaking-changes-doc.md) — `UPGRADING.md` with migration guide
3. [REL — Docs Accuracy Audit](./v6.0.0/REL_docs-accuracy-audit.md) — verify all docs against v6 API
4. [REL — Signpost Rewrite](./v6.0.0/REL_signpost-rewrite.md) — README, BEARING, VISION, STATUS for v6
5. [REL — Version Bump](./v6.0.0/REL_version-bump.md) — bump, tag, publish (blocked by 1-4)

### `v6.0.0-tui/` (Bijou v5 TUI modernization)

1. [TUI-001 — Framed App Shell](./v6.0.0-tui/TUI_framed-app-shell.md) — Foundation: `createFramedApp()` + `startApp()`
2. [TUI-002 — boxV3 → boxSurface](./v6.0.0-tui/TUI_box-surface-migration.md) — Breaking API fix (Small)
3. [TUI-003 — Status Bar](./v6.0.0-tui/TUI_status-bar.md) — Persistent bottom bar
4. [TUI-004 — Toast Notifications](./v6.0.0-tui/TUI_toast-notifications.md) — Replace custom toast with built-in
5. [TUI-005 — Badge Components](./v6.0.0-tui/TUI_badge-components.md) — Bijou `badge` for encryption/compression tags
6. [TUI-006 — Layout Primitives](./v6.0.0-tui/TUI_layout-primitives.md) — hstack/vstack/flex/grid
7. [TUI-007 — Help Overlay](./v6.0.0-tui/TUI_help-overlay.md) — `?` key → full keybinding reference
8. [TUI-008 — Merkle DAG Viewer](./v6.0.0-tui/TUI_merkle-dag-viewer.md) — `dagPane` for manifest structure
9. [TUI-009 — Interactive Store Wizard](./v6.0.0-tui/TUI_store-wizard.md) — Guided store flow inside TUI
10. [TUI-010 — Pager Scrollable Content](./v6.0.0-tui/TUI_pager-scrollable-content.md) — Scrollable detail pane
11. [TUI-011 — Accordion Detail Pane](./v6.0.0-tui/TUI_accordion-detail-pane.md) — Collapsible manifest sections
12. [TUI-012 — Animated Transitions](./v6.0.0-tui/TUI_animated-transitions.md) — Spring physics + transition shaders

### `cool-ideas/`

Active:

- [TR — Convergent Encryption](./cool-ideas/TR_convergent-encryption.md) ✅
- [TR — Browser Compression Adapter](./cool-ideas/TR_browser-compression-adapter.md)
- [TR — Manifest Diffing](./cool-ideas/TR_manifest-diffing.md) ✅
- [TR — Parallel Chunk Restore](./cool-ideas/TR_parallel-chunk-restore.md) ✅
- [TR — Content-Aware Chunking](./cool-ideas/TR_content-aware-chunking.md)

Resolved — `security/audit-fixes` branch:

- [TR — Dual Encryption Modes](./cool-ideas/TR_dual-encryption-modes.md) ✅
- [TR — Manifest Signing](./cool-ideas/TR_manifest-signing.md) ✅
- [TR — Streaming Decryption](./cool-ideas/TR_streaming-decryption.md) ✅
- [TR — Vault Privacy Mode](./cool-ideas/TR_vault-privacy-mode.md) ✅
- [SEC — AES-GCM AAD Binding](./cool-ideas/SEC_aes-gcm-aad-binding.md) ✅
- [SEC — FastCDC Dual-Mask Normalization](./cool-ideas/SEC_fastcdc-dual-mask.md) ✅
- [SEC — Manifest-Level Integrity Hash](./cool-ideas/SEC_manifest-integrity-hash.md) ✅

### `bad-code/`

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
