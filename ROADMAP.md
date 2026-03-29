# @git-stunts/git-cas — ROADMAP

This document tracks the real current state of `git-cas` and the sequenced work
that remains.

Fresh planning now follows [WORKFLOW.md](./WORKFLOW.md), not roadmap-first
milestone writing.

That means this file is now:

- sequence context
- release-line context
- migration context

It is not the primary source of truth for new cycle planning.

It now follows the workflow defined in [CONTRIBUTING.md](./CONTRIBUTING.md):

- sponsor user
- sponsor agent
- hills
- playback questions
- explicit non-goals
- design docs first, tests second, implementation third

`main` is the playback truth. If code lands out of order, the roadmap adjusts to
match reality instead of pretending the original sequence still happened.

Completed milestone detail lives in [COMPLETED_TASKS.md](./COMPLETED_TASKS.md).
Superseded work lives in [GRAVEYARD.md](./GRAVEYARD.md).

## Current Reality

- **Last tagged release:** `v5.3.2` (`2026-03-15`)
- **Current package version on `main`:** `v5.3.3`
- **Supported runtimes:** Node.js 22.x (primary), Bun, Deno
- **Human surface reality:** the human CLI/TUI is already substantial and now
  includes early repo-explorer work that belongs closer to the later UX line
  than to M17 closeout.
- **Agent surface reality:** there is still no first-class `git cas agent`
  contract. The main product gap is machine-facing determinism, not human
  surface richness.
- **M17 reality:** the M17 closeout work is materially present on `main`
  (`CODEOWNERS`, release verification, test conventions, property coverage),
  even though release bookkeeping and docs drifted.
- **Next deliberate focus:** the next few cycles are agent-first. The human
  surface should now follow the application boundaries that fall out of the
  machine surface, not the other way around.

## Product Doctrine

- Git is the substrate, not the product.
- Integrity is sacred.
- Restore must be deterministic.
- Provenance matters.
- Verification matters.
- Human CLI/TUI and agent CLI are separate surfaces over one shared domain core.
- The default human UX should stay boring and trustworthy.
- The default machine UX should stay deterministic and replayable.

## Two-Surface Strategy

### Human CLI/TUI

This is the current public operator surface.

- Existing `git cas ...` commands remain the stable human workflow.
- Bijou formatting, prompts, dashboards, and TTY-aware behavior stay here.
- The human `--json` flag remains convenience structured output for humans and
  simple scripts.
- Future human-surface work should reuse shared app-layer behavior instead of
  inventing parallel logic in the TUI.

### Agent CLI

This is now the priority surface.

- Namespace: `git cas agent`
- Output: JSONL on `stdout`, one protocol record per line
- `stderr`: structured warnings and errors only
- No TTY branching, no implicit prompts, no Bijou rendering
- Stable record envelope: `protocol`, `command`, `type`, `seq`, `ts`, `data`
- Reserved record types: `start`, `progress`, `warning`, `needs-input`,
  `result`, `error`, `end`
- Missing required input emits `needs-input` and exits with a distinct code
- Integrity and verification failures get their own exit-code semantics
- The agent CLI is a first-class workflow, not an extension of the human
  `--json` path

## Honest State of `main`

### Human Surface

What is already true on `main`:

- chunked Git-backed storage, restore, verify, encryption, recipients, and
  rotation are already shipped in the domain/library
- the vault workflow is real and GC-safe
- diagnostics and release verification already exist
- the TUI has already moved beyond a simple vault inspector into a richer
  repository explorer with refs browsing, source inspection, treemap views, and
  a stronger theme layer

This means the human surface is no longer the thing waiting to become real. It
is already real and ahead of the planning docs.

### Agent Surface

What is still missing:

- a first-class machine runner
- a JSONL protocol contract
- exact machine-facing exit-code semantics
- non-interactive input handling as a core design constraint
- parity for the operational command set without scraping human CLI output

This is the current product bottleneck.

## Tagged Releases

| Version  | Milestone     | Theme                                                                   | Status    |
| -------- | ------------- | ----------------------------------------------------------------------- | --------- |
| `v5.3.2` | Maintenance   | Vitest workspace split, CLI version sync, runtime/tooling stabilization | ✅ Tagged |
| `v5.3.1` | Maintenance   | Repeated-chunk tree integrity fix                                       | ✅ Tagged |
| `v5.3.0` | M16 Capstone  | Audit remediation and security hardening                                | ✅ Tagged |
| `v5.2.0` | M12 Carousel  | Key rotation without re-encrypting data                                 | ✅ Tagged |
| `v5.1.0` | M11 Locksmith | Envelope encryption and recipient management                            | ✅ Tagged |
| `v5.0.0` | M10 Hydra     | Content-defined chunking                                                | ✅ Tagged |
| `v4.0.1` | M8 + M9       | Review hardening, `verify`, `--json`, CLI polish                        | ✅ Tagged |
| `v4.0.0` | M14 Conduit   | Streaming restore, observability, parallel chunk I/O                    | ✅ Tagged |
| `v3.1.0` | M13 Bijou     | TUI dashboard and animated progress                                     | ✅ Tagged |

Older history remains in [CHANGELOG.md](./CHANGELOG.md).

## Untagged `main` Line

The current `main` branch is ahead of the last tagged release.

It currently includes:

- the M17 closeout work that was previously tracked as pending
- package version `5.3.3`
- early human-surface repo-explorer work that landed ahead of the old planned
  sequence

The roadmap therefore treats the next planning cycle as a recentering cycle,
not as a continuation of stale milestone fiction.

## Near-Term Priority Stack

1. **M18 Relay foundation**
   Build the first credible agent contract.
2. **Relay follow-through**
   Stay agent-first until the machine surface can handle core workflows without
   scraping or prompting.
3. **M19 Nouveau**
   Resume major human-surface work only after the agent surface has forced
   cleaner application boundaries.

## Open Milestones

### M18 — Relay (`v5.4.0` target)

**Theme:** first-class agent CLI foundation.

**Sponsor user**

- A maintainer or release engineer who wants to automate `git-cas` operations
  without scraping terminal text.

**Sponsor agent**

- A coding agent, CI job, release bot, or backup workflow that needs exact,
  replayable outcomes and explicit side effects.

**Hills**

- A sponsor agent can inspect, verify, and query `git-cas` state through a
  stable JSONL protocol without depending on TTY behavior or human-readable
  formatting.
- A sponsor user can trust automation built on `git-cas` because failures,
  warnings, and requested inputs are explicit and machine-actionable.

**Playback questions**

- Can an agent complete `inspect`, `verify`, `vault list`, `vault info`,
  `vault history`, `doctor`, and `vault stats` without scraping prose?
- Are protocol records ordered, typed, and stable across Node, Bun, and Deno?
- Does `stdout` remain pure protocol output after the first record?
- Are missing inputs and integrity failures distinguished cleanly by both record
  type and exit code?

**Explicit non-goals**

- No long-lived session protocol.
- No TUI redesign.
- No attempt to turn the human `--json` path into the automation contract.
- No binary restore payload over protocol `stdout`.

**Work order**

1. Write the agent protocol design doc.
2. Write contract tests for record order, shapes, `stdout` purity, `stderr`
   behavior, and exit codes.
3. Implement a dedicated machine runner.
4. Ship read-heavy parity first:
   `agent inspect`, `agent verify`, `agent vault list`, `agent vault info`,
   `agent vault history`, `agent doctor`, `agent vault stats`.

**Acceptance**

- The protocol contract is documented in-repo.
- The read-heavy agent commands are JSONL-first and non-interactive.
- Contract tests pass on Node, Bun, and Deno.
- The human CLI continues to work unchanged outside explicitly shared internals.

### Relay Follow-through (`v5.5.0` target)

**Theme:** bring the agent surface to operational parity before more large
human-surface pushes.

**Sponsor user**

- A maintainer who wants to wire `git-cas` into repeatable backup, restore,
  publish, or release flows.

**Sponsor agent**

- An autonomous system that must perform state-changing workflows end-to-end
  with explicit inputs and replayable outcomes.

**Hills**

- A sponsor agent can complete the core `git-cas` operational loop
  non-interactively: store, restore, rotate, recipient management, and vault
  administration.
- A sponsor user can build automation on top of `git-cas` without needing a
  human escape hatch for normal success paths.

**Playback questions**

- Can an agent complete encrypted store and restore flows without prompting?
- Are passphrase files, request payloads, and missing-input branches explicit?
- Are state-changing side effects obvious in protocol output?
- Can agents reason about failures without parsing human error text?

**Explicit non-goals**

- No long-lived interactive agent session.
- No human-surface expansion that bypasses the shared command/model layer.
- No hidden convenience prompting in the machine path.

**Work order**

1. Extend the design doc to cover write flows and input request semantics.
2. Extend contract tests to state-changing commands and failure branches.
3. Implement:
   `agent store`, `agent tree`, `agent restore`, `agent rotate`,
   `agent recipient ...`, and the vault write flows that belong in the machine
   surface.
4. Add structured warnings for safety and policy signals that agents can act on.

**Acceptance**

- Core state-changing workflows are machine-accessible without prompting.
- Input request behavior is explicit and documented.
- Cross-runtime contract tests cover both read and write paths.
- The machine surface is credible enough to become the app-layer reference for
  later human-surface work.

### M19 — Nouveau (after Relay is credible)

**Theme:** human UX refresh on top of agent-native application boundaries.

Some groundwork has already landed on `main`:

- repo explorer shell
- refs browser
- source inspection
- treemap atlas and drilldown
- stronger theme and motion work

That work should now be treated as input, not as permission to keep pushing the
human surface ahead of the machine surface.

**Sponsor user**

- An operator who wants to inspect, understand, and recover artifact state with
  less uncertainty and less CLI memorization.

**Sponsor agent**

- An agent that benefits when the human surface reuses the same shared
  application operations instead of bespoke TUI behavior.

**Hill**

- The human surface becomes easier to trust because it sits on top of cleaner,
  explicit app-layer behavior that was first forced into shape by the agent CLI.

**Explicit non-goals**

- No bespoke TUI-only behavior that bypasses shared command/model boundaries.
- No large human-surface push before Relay and Relay follow-through are credible.

## Later Lines

The later roadmap remains directionally the same, but detailed scoping stays
light until the agent-first line is delivered.

| Line         | Theme                                              |
| ------------ | -------------------------------------------------- |
| Sentinel     | Vault health, crypto hygiene, and safety workflows |
| Atelier      | Vault ergonomics and publishing workflows          |
| Cartographer | Repo intelligence and artifact comparison          |
| Courier      | Artifact sets and transport                        |
| Spectrum     | Storage and observability extensibility            |
| Bastion      | Enterprise key-management research                 |

## Cycle Delivery Rules

Every cycle follows the repository workflow discipline:

1. design docs first
2. tests as spec second
3. implementation third
4. retrospective after delivery
5. update `docs/BACKLOG/` with follow-on work and debt
6. rewrite the root README to reflect reality when needed
7. update the root changelog

Additional release discipline:

- tagged releases reflect reality, not aspiration
- the human `--json` flag remains convenience output, not the automation
  contract
- the machine surface stays JSONL-first and one-shot until a stronger protocol
  is justified by playback

## Document Boundaries

- [ROADMAP.md](./ROADMAP.md): current reality plus future sequence
- [STATUS.md](./STATUS.md): compact project snapshot
- [WORKFLOW.md](./WORKFLOW.md): planning and delivery source of truth for fresh work
- [COMPLETED_TASKS.md](./COMPLETED_TASKS.md): shipped milestone details
- [GRAVEYARD.md](./GRAVEYARD.md): superseded or merged-away work
- [CHANGELOG.md](./CHANGELOG.md): release-by-release history
