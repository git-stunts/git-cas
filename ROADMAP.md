# @git-stunts/cas — ROADMAP

This document tracks the real current state of `git-cas` and the sequenced work that remains.
Completed milestone detail lives in [COMPLETED_TASKS.md](./COMPLETED_TASKS.md). Superseded work
lives in [GRAVEYARD.md](./GRAVEYARD.md).

## Current Reality

- **Current release:** `v5.3.3` (2026-03-17)
- **Current line:** M17 Ledger shipped in `v5.3.3`; the next planned line is M18 Relay targeting `v5.4.0`.
- **Supported runtimes:** Node.js 22.x (primary), Bun, Deno
- **Current operator experience:** the human-facing CLI/TUI is shipped now; the machine-facing agent CLI is planned next.

## Interface Strategy

`git-cas` now has an explicit two-surface direction:

### Human CLI/TUI

This is the current public operator surface.

- Existing `git cas ...` commands remain the stable human workflow.
- Bijou formatting, prompts, dashboards, and TTY-aware behavior stay here.
- `--json` remains supported as convenience structured output for humans and simple scripts.
- Human-facing improvements continue under the Bijou/TUI roadmap.

### Agent CLI

This is planned work starting in **M18 Relay**.

- Namespace: `git cas agent`
- Output: JSONL on `stdout` only, one record per line
- No Bijou formatting, no TTY-mode branching, no implicit prompts
- Stable event envelope: `protocol`, `command`, `type`, `seq`, `ts`, `data`
- Reserved record types: `start`, `progress`, `warning`, `needs-input`, `result`, `error`, `end`
- One-shot commands in v1: stream records during execution, then exit
- Non-interactive secret/input handling:
  - missing required input -> emit `needs-input`, exit `2`
  - fatal execution failure -> emit `error`, exit `1`
  - integrity/verification failure -> exit `3`
  - success -> exit `0`
- Request input supports normal flags plus `--request -` and `--request @file.json`

The agent CLI is a first-class workflow, not an extension of the human `--json` mode.

## Shipped Summary

| Version | Milestone | Codename             | Theme                                                                                                             | Status     |
| ------- | --------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| v3.1.0  | M13       | Bijou                | TUI dashboard and animated progress                                                                               | ✅ Shipped |
| v4.0.0  | M14       | Conduit              | Streaming restore, observability, parallel chunk I/O                                                              | ✅ Shipped |
| v4.0.1  | M8 + M9   | Spit Shine + Cockpit | Review hardening, `verify`, `--json`, CLI polish                                                                  | ✅ Shipped |
| v5.0.0  | M10       | Hydra                | Content-defined chunking                                                                                          | ✅ Shipped |
| v5.1.0  | M11       | Locksmith            | Envelope encryption and recipient management                                                                      | ✅ Shipped |
| v5.2.0  | M12       | Carousel             | Key rotation without re-encrypting data                                                                           | ✅ Shipped |
| v5.3.0  | M16       | Capstone             | Audit remediation and security hardening                                                                          | ✅ Shipped |
| v5.3.1  | —         | Maintenance          | Repeated-chunk tree integrity fix                                                                                 | ✅ Shipped |
| v5.3.2  | —         | Maintenance          | Vitest workspace split, CLI version sync, and runtime/tooling stabilization                                       | ✅ Shipped |
| v5.3.3  | M17       | Ledger               | Release verification, review automation baseline, property tests, and hardened Ubuntu/non-root Docker test stages | ✅ Shipped |

Older history remains in [CHANGELOG.md](./CHANGELOG.md).

## Planned Release Sequence

| Version | Milestone | Codename     | Theme                                   | Status     |
| ------- | --------- | ------------ | --------------------------------------- | ---------- |
| v5.4.0  | M18       | Relay        | LLM-native CLI foundation               | 📝 Planned |
| v5.5.0  | M19       | Nouveau      | Bijou v3 human UX refresh               | 📝 Planned |
| v5.6.0  | M20       | Sentinel     | Vault health and safety                 | 📝 Planned |
| v5.7.0  | M21       | Atelier      | Vault ergonomics and publishing         | 📝 Planned |
| v5.8.0  | M22       | Cartographer | Repo intelligence and change analysis   | 📝 Planned |
| v5.9.0  | M23       | Courier      | Artifact sets and transfer              | 📝 Planned |
| v5.10.0 | M24       | Spectrum     | Storage and observability extensibility | 📝 Planned |
| v5.11.0 | M25       | Bastion      | Enterprise key management research      | 📝 Planned |

## Dependency Sequence

```text
M17 Ledger + v5.3.1/v5.3.2/v5.3.3 maintenance ✅
                |
            M18 Relay
                |
           M19 Nouveau
                |
           M20 Sentinel
                |
            M21 Atelier
                |
         M22 Cartographer
                |
           M23 Courier
                |
          M24 Spectrum
                |
           M25 Bastion
```

This sequence is intentionally linear. It keeps the docs/ops reset behind us, then moves into
the machine interface split, then the human TUI refresh, and only then the broader feature
expansion.

## Open Milestones

### M18 — Relay (`v5.4.0`)

**Theme:** first-class LLM-native CLI.

Deliverables:

- Introduce `git cas agent` as a separate machine-facing namespace.
- Add `actionlint` to CI and local checks.
- Automate GitHub Actions dependency updates so workflow runtime maintenance becomes proactive instead of reactive.
- Add regression coverage that Docker test images stay unprivileged and that the Deno image retains the Node binary needed for npm package install scripts.
- Define repository policy for JSDoc/review-bot coverage expectations so automated review warnings stay actionable.
- Document maintainer PR-thread resolution workflow for bot-driven review cycles.
- Add a dedicated machine command runner instead of extending the current human `runAction()` path.
- Define and implement the JSONL envelope contract:
  `protocol`, `command`, `type`, `seq`, `ts`, `data`.
- Implement reserved record types:
  `start`, `progress`, `warning`, `needs-input`, `result`, `error`, `end`.
- Enforce non-interactive behavior for secrets and missing inputs.
- Support flags plus `--request -` / `--request @file.json`.
- Deliver parity for:
  `agent store`, `agent tree`, `agent inspect`, `agent restore`, `agent verify`,
  `agent vault list`, `agent vault info`, `agent vault history`.
- Publish contract docs with exact exit-code behavior.

Acceptance:

- JSONL contract tests must verify record order, record shapes, `stdout` purity, `stderr` silence after protocol start, and exit codes on Node, Bun, and Deno.

### M19 — Nouveau (`v5.5.0`)

**Theme:** Bijou v3 refresh for the human-facing experience.

Deliverables:

- Upgrade `@flyingrobots/bijou`, `@flyingrobots/bijou-node`, and `@flyingrobots/bijou-tui` to `3.0.0`.
- Add `@flyingrobots/bijou-tui-app` for the refreshed shell.
- Move inspector/dashboard rendering onto the v3 `ViewOutput` contract.
- Split the current inspector into sub-apps for list, detail, history, and health panes.
- Add BCSS-driven responsive styling and layout presets.
- Add motion for focus shifts, pane changes, and shell transitions where it improves legibility.
- Add session restore for the human TUI layout.
- Replace the current low-fidelity heatmap/detail composition with a higher-fidelity surface-native view.

Acceptance:

- Existing human CLI behavior stays stable outside the refreshed TUI.
- PTY smoke coverage must exercise inspect/dashboard navigation, filtering, resize, pane composition, and non-TTY fallback.

### M20 — Sentinel (`v5.6.0`)

**Theme:** vault health, crypto hygiene, and safety workflows.

Deliverables:

- `git cas vault status`
- `git cas gc`
- `encryptionCount` auto-rotation policy
- `.casrc` KDF parameter tuning with safe validation
- Human CLI warnings for nonce budget and KDF health
- Agent CLI warnings/results for the same health signals

### M21 — Atelier (`v5.7.0`)

**Theme:** vault ergonomics and publishing workflows.

Deliverables:

- Named vaults
- `git cas vault add` to adopt existing trees
- Vault export flows:
  - whole vault export
  - single-entry export
  - bulk export
- Publish flows:
  - publish to working tree
  - publish to branch
  - auto-publish hook support
- File-level `--passphrase` CLI for standalone encrypted store flows

### M22 — Cartographer (`v5.8.0`)

**Theme:** repo intelligence and artifact comparison.

Deliverables:

- Duplicate-detection warnings during store
- `git cas scan` / dedup advisor
- Manifest diff engine
- Machine diff stream for the agent CLI
- Human compare view layered on the M19 shell

### M23 — Courier (`v5.9.0`)

**Theme:** artifact sets and transport.

Deliverables:

- Snapshot trees for directory-level store and restore
- Portable bundles for air-gap transfer
- Watch mode built on snapshot-root semantics rather than ad hoc per-file state

### M24 — Spectrum (`v5.10.0`)

**Theme:** storage and observability extensibility.

Deliverables:

- `CompressionPort`
- Additional codecs: `zstd`, `brotli`, `lz4`
- Prometheus/OpenTelemetry adapter for `ObservabilityPort`

### M25 — Bastion (`v5.11.0`)

**Theme:** enterprise key-management research with hard exit criteria.

Deliverables:

- ADR for external key-management support
- Threat model for HSM/Vault-backed key flows
- Proof-of-concept `KeyManagementPort` adapter
- Decision memo on whether enterprise key management should become a product milestone

## Delivery Standards

Every planned milestone follows the repository release discipline:

- Human CLI/TUI behavior remains backward compatible unless a release explicitly declares otherwise.
- The human `--json` flag remains convenience output, not the automation contract.
- The first machine interface release is JSONL-only and one-shot; no session protocol is planned before the contract proves useful.
- `agent restore` writes to the filesystem in v1; binary payloads do not share protocol `stdout`.
- Any user-visible feature added after M18 must include:
  - at least one human CLI/TUI test, and
  - at least one agent-protocol test when the feature is exposed to the machine surface.

## Document Boundaries

- [ROADMAP.md](./ROADMAP.md): current reality plus future sequence
- [STATUS.md](./STATUS.md): compact project snapshot
- [COMPLETED_TASKS.md](./COMPLETED_TASKS.md): shipped milestone details
- [GRAVEYARD.md](./GRAVEYARD.md): superseded or merged-away work
- [CHANGELOG.md](./CHANGELOG.md): release-by-release history
