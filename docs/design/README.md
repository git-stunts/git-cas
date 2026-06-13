# Design Docs

This directory now contains two kinds of cycle history:

- active METHOD cycles in numbered subdirectories
- legacy pre-METHOD cycle docs kept at the top level for history and stable
  links

Fresh work should follow [WORKFLOW.md](../../WORKFLOW.md) and the canonical
process in [docs/method/process.md](../method/process.md).

## Active METHOD Cycles

- [0020-method-adoption — adopt-method](./0020-method-adoption/adopt-method.md)
- [0021-store-write-backpressure — enforce-store-backpressure](./0021-store-write-backpressure/enforce-store-backpressure.md)
- [0022-git-persistence-read-blob-stream — add-read-blob-stream](./0022-git-persistence-read-blob-stream/add-read-blob-stream.md)
- [0023-casservice-read-blob-stream-integration — use-read-blob-stream-in-restore](./0023-casservice-read-blob-stream-integration/use-read-blob-stream-in-restore.md)
- [0024-cli-os-keychain-passphrase — cli-os-keychain-passphrase](./0024-cli-os-keychain-passphrase/cli-os-keychain-passphrase.md)
- [0025-encrypted-manifest-auth-boundary — encrypted-manifest-auth-boundary](./0025-encrypted-manifest-auth-boundary/encrypted-manifest-auth-boundary.md)
- [0026-dual-encryption-mode-foundation — dual-encryption-mode-foundation](./0026-dual-encryption-mode-foundation/dual-encryption-mode-foundation.md)
- [0027-framed-v1-streaming-restore — framed-v1-streaming-restore](./0027-framed-v1-streaming-restore/framed-v1-streaming-restore.md)
- [0028-whole-v1-bounded-file-restore — whole-v1-bounded-file-restore](./0028-whole-v1-bounded-file-restore/whole-v1-bounded-file-restore.md)
- [0029-restore-buffer-hard-limits — restore-buffer-hard-limits](./0029-restore-buffer-hard-limits/restore-buffer-hard-limits.md)
- [0030-kdf-parameter-bounds-and-policy — kdf-parameter-bounds-and-policy](./0030-kdf-parameter-bounds-and-policy/kdf-parameter-bounds-and-policy.md)
- [0031-empty-state-phrasing-consistency — empty-state-phrasing-consistency](./0031-empty-state-phrasing-consistency/empty-state-phrasing-consistency.md)
- [0032-encryption-metadata-schema-hardening — encryption-metadata-schema-hardening](./0032-encryption-metadata-schema-hardening/encryption-metadata-schema-hardening.md)
- [0033-webcrypto-streaming-parity — webcrypto-streaming-parity](./0033-webcrypto-streaming-parity/webcrypto-streaming-parity.md)
- [0034-framed-v1-default-encrypted-store — framed-v1-default-encrypted-store](./0034-framed-v1-default-encrypted-store/framed-v1-default-encrypted-store.md)
- [0035-agent-cli-os-keychain-passphrase — agent-cli-os-keychain-passphrase](./0035-agent-cli-os-keychain-passphrase/agent-cli-os-keychain-passphrase.md)
- [0036-platform-agnostic-cli-plan — platform-agnostic-cli-plan](./0036-platform-agnostic-cli-plan/platform-agnostic-cli-plan.md)
- [0037-scrypt-maxmem-budget-dedup — scrypt-maxmem-budget-dedup](./0037-scrypt-maxmem-budget-dedup/scrypt-maxmem-budget-dedup.md)
- [0038-aes-gcm-metadata-enforcement — aes-gcm-metadata-enforcement](./0038-aes-gcm-metadata-enforcement/aes-gcm-metadata-enforcement.md)
- [0039-buffered-restore-readblob-fallback — buffered-restore-readblob-fallback](./0039-buffered-restore-readblob-fallback/buffered-restore-readblob-fallback.md)
- [0040-kdf-salt-schema-hardening — kdf-salt-schema-hardening](./0040-kdf-salt-schema-hardening/kdf-salt-schema-hardening.md)
- [0041-restorefile-service-internal-coupling — restorefile-service-internal-coupling](./0041-restorefile-service-internal-coupling/restorefile-service-internal-coupling.md)
- [0042-store-write-failure-surface — store-write-failure-surface](./0042-store-write-failure-surface/store-write-failure-surface.md)
- [0043-vault-retry-abstraction — vault-retry-abstraction](./0043-vault-retry-abstraction/vault-retry-abstraction.md)
- [0044-casservice-decomposition-plan — casservice-decomposition-plan](./0044-casservice-decomposition-plan/casservice-decomposition-plan.md)
- [0045-v6-1-bounded-residency — bounded-residency](./0045-v6-1-bounded-residency/bounded-residency.md)

## Landed METHOD Cycles

- none currently

## Legacy Landed Cycle Docs

- [0001 — M18 Relay: Agent CLI Foundation](./0001-m18-relay-agent-cli.md)
- [0002 — M18 Relay: Write Flows and Input Semantics](./0002-m18-relay-write-flows.md)
- [0003 — M18 Relay: Tree Creation Primitive](./0003-m18-relay-tree-creation.md)
- [RL-001 — Relay: Agent Recipient List](./RL-001-agent-recipient-list.md)
- [RL-002 — Relay: Agent Recipient Mutations](./RL-002-agent-recipient-mutations.md)
- [RL-003 — Relay: Agent Rotate](./RL-003-agent-rotate.md)
- [RL-004 — Relay: Agent Vault Rotate](./RL-004-agent-vault-rotate.md)
- [RL-005 — Relay: Agent Vault Lifecycle](./RL-005-agent-vault-lifecycle.md)
- [TR-001 — Truth: Architecture Reality Gap](./TR-001-architecture-reality-gap.md)
- [TR-002 — Truth: Threat Model](./TR-002-threat-model.md)
- [TR-003 — Truth: Benchmark Baselines](./TR-003-benchmark-baselines.md)
- [TR-004 — Truth: Design Doc Lifecycle](./TR-004-design-doc-lifecycle.md)
- [TR-006 — Truth: Docs Maintainer Checklist](./TR-006-docs-maintainer-checklist.md)
- [TR-007 — Truth: Security Doc Discoverability Audit](./TR-007-security-doc-discoverability-audit.md)
- [TR-009 — Truth: Pre-PR Doc Cross-Link Audit](./TR-009-pre-pr-doc-cross-link-audit.md)
- [TR-010 — Truth: Planning Index Consistency Review](./TR-010-planning-index-consistency-review.md)
- [TR-012 — Truth: Examples Surface Audit](./TR-012-examples-surface-audit.md)
- [TR-013 — Truth: Guide Accuracy Audit](./TR-013-guide-accuracy-audit.md)
- [TR-014 — Truth: Markdown Surface Rationalization](./TR-014-markdown-surface-rationalization.md)

## Archived Or Retired Cycle Docs

- [docs/archive/design](../archive/design/README.md)
