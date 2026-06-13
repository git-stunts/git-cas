# Design Doc Template

This is the standard shape for new `git-cas` METHOD cycle design docs.

Design docs define intent, contracts, non-goals, and proof plans. They do not
prove implementation. For implementation work, at least one required test must
exercise the actual software surface: package API, runtime behavior, Git-backed
persistence behavior, migration behavior, CLI command behavior, TUI behavior,
schema validation, public docs examples, machine-readable witness output,
CI/tooling behavior, or release behavior.

Documentation assertions, inventory tests, and docs guards are allowed as
evidence-ledger checks. They cannot be the only acceptance proof for product,
runtime, storage, protocol, migration, CLI, TUI, release, or rendered work.

## Frontmatter

Use this frontmatter for new cycle design docs:

```yaml
---
title: "<LEGEND>-<ID> - <Short Title>"
cycle: "<NNNN>"
task_id: "<slug>"
legend: "<API|DX|HYGIENE|INFRA|PERF|PROTO|RELEASE|SLUDGE|TRUST|TUI>"
release_home: "vX.Y.Z|none"
issue: "https://github.com/git-stunts/git-cas/issues/<number>"
goalpost_issue: "https://github.com/git-stunts/git-cas/issues/<number>|none"
tracker_source: "github"
status: "draft|active|landed|superseded"
base_commit: "<fully-qualified-sha>"
owners:
  - "@git-stunts"
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: []
supersedes: []
superseded_by: null
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
---
```

Status meanings are local design-doc lifecycle states only. They do not replace
GitHub Issue state:

- `draft`: not yet committed as active work.
- `active`: pulled into a cycle; sponsors own the hill.
- `landed`: implementation and witness evidence merged or otherwise complete.
- `superseded`: replaced by another design; `superseded_by` points at it.

GitHub Issues remain the canonical tracker for open, blocked, active, review,
carried-forward, and closed work.

## Required Sections

Every new cycle design doc must include these sections:

- Linked Issue
- Linked Tracker
- Design Type
- Decision Summary
- Sponsored Human
- Sponsored Agent
- Hill
- Current Truth
- Problem
- Scope
- Non-Goals
- Runtime / API Contract and/or User Experience / Product Shape
- Accessibility Posture
- Agent Inspectability / Explainability Posture
- Linked Invariants
- Design Alternatives Considered
- Decision
- Proof Surface
- Implementation Slices
- Tests To Write First
- Acceptance Criteria
- Validation Plan
- Playback / Witness
- Risks
- Follow-On Debt
- Tracker Disposition
- Done Does Not Mean
- Retrospective

## Conditional Sections

Include these sections when the design touches the named concern:

| Section | Required when |
| --- | --- |
| Data / State Model | State persists, mutates, derives, or crosses a boundary. |
| Architecture / Anti-SLUDGE Posture | Code changes. |
| Cost / Residency Posture | Public APIs, reads, writes, content, vaults, manifests, or large-object behavior change. |
| Determinism / Replay / Causality | Migration, release evidence, object identity, manifests, vault history, or deterministic witnesses change. |
| Git Substrate Impact | Refs, commits, trees, blobs, object ids, tags, storage, migration, or release behavior change. |
| Compatibility / Migration Posture | Public API, package export, storage format, docs, release, or legacy behavior changes. |
| Error Contract | Runtime, API, CLI, migration, TUI, or operator behavior changes. |
| Security / Trust / Redaction Posture | Authority, logs, reports, trust, secrets, encryption, keys, or signatures change. |
| Lower Modes | The result is user-visible or agent-visible. |
| User-Facing Text / Directionality | Visible CLI, TUI, docs, report, or error text changes. |
| UI Mockups | TUI, visual, docs-app, or interactive visual surfaces change. |

`git-cas` does not currently have localization support. Design docs must not
invent localization process, locale catalogs, or translation-completeness gates.
When visible text changes, the design still names the strings, accessibility
implications, machine-readable equivalent output, and directionality
assumptions.

## Evidence Rules

Current Truth is factual, not aspirational. Strong claims must cite concrete
evidence:

- source files
- tests
- commands
- public APIs
- current docs
- GitHub issues or pull requests
- committed witness artifacts
- CI run URLs, when CI evidence matters

Local command results may support a design, but they are not durable release
evidence unless captured in a committed witness, retro, CI run, or other
inspectable artifact.

## Template

Copy this skeleton when opening a new cycle design:

````markdown
---
title: "<LEGEND>-<ID> - <Short Title>"
cycle: "<NNNN>"
task_id: "<slug>"
legend: "<API|DX|HYGIENE|INFRA|PERF|PROTO|RELEASE|SLUDGE|TRUST|TUI>"
release_home: "vX.Y.Z|none"
issue: "https://github.com/git-stunts/git-cas/issues/<number>"
goalpost_issue: "https://github.com/git-stunts/git-cas/issues/<number>|none"
tracker_source: "github"
status: "draft|active|landed|superseded"
base_commit: "<fully-qualified-sha>"
owners:
  - "@git-stunts"
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: []
supersedes: []
superseded_by: null
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
---

# <LEGEND>-<ID> - <Short Title>

## Linked Issue

- https://github.com/git-stunts/git-cas/issues/<number>

## Linked Tracker

- Milestone: `vX.Y.Z`
- Goalpost issue: https://github.com/git-stunts/git-cas/issues/<number>
- Slice issues: https://github.com/git-stunts/git-cas/issues/<number>

## Design Type

This design is primarily:

- [ ] Runtime/API
- [ ] Storage/substrate
- [ ] Migration/release
- [ ] CLI/operator
- [ ] Docs/public guidance
- [ ] TUI/visual surface
- [ ] Test/tooling

## Decision Summary

One short paragraph describing the decision this document is making. Say what
will exist, what it will do, and what boundary it owns.

## Sponsored Human

A <type of user> wants <capability/outcome> so that <reason>, without having to
<current pain or unsafe workaround>.

## Sponsored Agent

An agent needs <inspectable contract/tool/surface> so it can <operation>,
without inferring <unstable/private/visual-only state>.

## Hill

By the end of this cycle, <user/agent> can <observable outcome> through
<surface/API/command>, and the repo proves it with <tests/witnesses>.

## Current Truth

Describe what exists today. Include concrete anchors: files, commands, exported
APIs, current docs, current failure mode, relevant issues or PRs, and known test
coverage.

## Problem

State the actual problem.

## Scope

This cycle includes:

- ...

## Non-Goals

This cycle does not include:

- ...

## Runtime / API Contract

Name the software contract. Include only the relevant subsections:

- exported functions/types
- command intents
- schema input/output
- facts emitted
- state transitions
- layout/focus/input boundaries
- error behavior
- compatibility aliases or migration behavior

## User Experience / Product Shape

Required for CLI, TUI, docs, visual, or public onboarding work. For non-rendered
runtime work, say "Not applicable" and explain which runtime or operator
surface is the user-visible contract.

## Data / State Model

Required when state persists, mutates, derives, or crosses a boundary.

| State | Source of truth | Derived state | Invalid states | Reset behavior | Serialization | Determinism assumptions |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## Architecture / Anti-SLUDGE Posture

Required when code changes.

| Concern | Decision |
| --- | --- |
| Domain changes |  |
| Port changes |  |
| Adapter changes |  |
| Boundary validation |  |
| Runtime-backed nouns introduced |  |
| Expected failure representation |  |
| Banned shortcuts avoided |  |

## Cost / Residency Posture

Required when public APIs, reads, writes, content, vaults, manifests, or
large-object behavior change.

| Surface | Current cost | Target cost | Limit/budget | Failure mode |
| --- | --- | --- | --- | --- |
|  | bounded/streaming/cursor/transitional/diagnostic/legacy |  |  |  |

## Git Substrate Impact

Required when refs, commits, trees, blobs, object ids, tags, storage,
migration, or release behavior change.

| Substrate area | Impact |
| --- | --- |
| refs |  |
| commits |  |
| trees/blobs |  |
| object ids |  |
| tag/release behavior |  |
| migration compatibility |  |

## Compatibility / Migration Posture

Required when public API, package exports, storage format, docs, release, or
legacy behavior changes.

| Concern | Decision |
| --- | --- |
| Public API compatibility |  |
| Package export changes |  |
| Storage/read compatibility |  |
| Legacy behavior retained |  |
| Deprecation behavior |  |
| Migration path |  |
| Release note impact |  |

## Error Contract

Required when runtime, API, CLI, migration, TUI, or operator behavior changes.

| Failure | Error/result | Caller recovery | Test |
| --- | --- | --- | --- |
|  |  |  |  |

## Security / Trust / Redaction Posture

Required when authority, logs, reports, trust, secrets, encryption, keys, or
signatures change.

- trust boundary:
- authority or capability checked:
- secret-bearing values:
- redaction behavior:
- log/report behavior:
- abuse or replay concern:

## Lower Modes

Required when the result is user-visible or agent-visible.

## Accessibility Posture

State how accessibility is preserved. For non-rendered runtime work, describe
the linear reading model for docs, CLI output, reports, errors, or witness
artifacts.

## User-Facing Text / Directionality

Required only when this design adds or changes visible CLI, TUI, docs, report,
or error text.

## Agent Inspectability / Explainability Posture

Describe how an agent can inspect the result without scraping pixels or prose.

## Linked Invariants

List repo invariants this work must preserve.

## Design Alternatives Considered

### Option A: <name>

Pros:

- ...

Cons:

- ...

## Decision

State the chosen option and why.

## Proof Surface

The implementation must be proven through:

- actual surface under test:
- first RED test:
- required witness command:
- non-acceptable proof:

## Implementation Slices

- <Smallest testable slice>
- <Next slice>
- <Next slice>

## Tests To Write First

Behavior tests required:

- [ ] <package/runtime/render test that fails before implementation>
- [ ] <integration test that exercises user-visible behavior>
- [ ] <lower-mode or pipe/accessibility test, if relevant>
- [ ] <regression test for the specific bug or risk>

Rule: documentation tests cannot be the only proof for implementation work.

## Acceptance Criteria

The work is done when:

- [ ] Behavior test proves <contract>
- [ ] Runtime API, rendered output, command output, or witness proves
  <user-visible outcome>
- [ ] Lower modes are covered, if relevant
- [ ] Docs, changelog, or release notes are updated, if behavior or direction
  changed
- [ ] Issue and PR are linked correctly
- [ ] CI and local validation are green

## Validation Plan

Commands expected before PR:

```bash
npx eslint .
npm test
npm run release:verify -- --skip-jsr
```

Trim commands that do not apply. Add focused tests and package-specific commands
when needed.

## Playback / Witness

Describe what a reviewer can run or inspect.

## Risks

Known risks:

- ...

Mitigations:

- ...

## Follow-On Debt

Create GitHub issues for anything deferred. Do not hide future work in prose.

## Tracker Disposition

| Issue | Role | Expected disposition |
| --- | --- | --- |
| https://github.com/git-stunts/git-cas/issues/<number> | primary / blocks / blocked-by / follow-on | close / update / leave open / create follow-up |

## Done Does Not Mean

When this lands, it does not prove:

- ...

## Retrospective

Fill this in after implementation.

PR:

- https://github.com/git-stunts/git-cas/pull/<number>
````
