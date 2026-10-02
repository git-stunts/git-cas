---
title: "PROTO-0062 - Mktree transport recovery"
cycle: "0062"
task_id: "mktree-transport-recovery"
legend: "PROTO"
release_home: "v6.5.11"
issue: "https://github.com/git-stunts/git-cas/issues/131"
goalpost_issue: "none"
tracker_source: "github"
status: "active"
base_commit: "c02c87ee0d7a72b0371762e5239223adb3ac4781"
owners: ["@git-stunts"]
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: ["https://github.com/git-stunts/plumbing/pull/20"]
supersedes: []
superseded_by: null
created: "2026-10-02"
updated: "2026-10-02"
---

# Mktree transport recovery

## Linked Issue

https://github.com/git-stunts/git-cas/issues/131

## Linked Tracker

GitHub milestone [v6.5.11](https://github.com/git-stunts/git-cas/milestone/21) owns release membership; issue #131 owns workflow state.

## Design Type

Dependency adoption and patch release with executable storage recovery proof.

## Decision Summary

Require published Plumbing 3.3.2, preserving the existing one-retry immutable-object session policy. Verify public protocol classes and packed registry consumers through COPY-based Docker.

## Sponsored Human

James Ross.

## Sponsored Agent

Codex.

## Hill

A consumer can build single and batched trees after external Git repacking closes a stale mktree transport, without an unbounded retry or altered producer error.

## Current Truth

`package.json` currently requires Plumbing ^3.3.0. `GitObjectSessionPool.#attempt` invalidates a failed session and retries only GitProtocolError once. Plumbing PR #20 classifies transport EPIPE and SESSION_INPUT_CLOSED accordingly; registry publication is a prerequisite, not evidence already obtained.

## Problem

Git-warp attachment checkpoint/GC checks exposed raw EPIPE escaping bounded recovery. Its patch-package repair only covers development checkouts and does not deploy the repair to npm consumers.

## Scope

Adopt the repaired registry dependency and lockfile; add transport recovery regressions; verify all runtimes, public types, examples and packages; publish 6.5.11 with integrity and consumer receipts. Route encountered CI/release unit tests and examples through COPY-based Docker.

## Non-Goals

No new retry, mutable-ref recovery, asset format, recursive ownership, git-warp attachment API, or performance claim.

## Runtime / API Contract

Single and batch tree operations retry a transport failure once through a fresh process. Two failed attempts terminate with GitProtocolError. EACCES and producer EPIPE preserve their identity and do not retry. Stored object identities and publication semantics remain unchanged.

## Accessibility Posture

Evidence and errors are plain linear text and machine-readable results; no visual-only interaction is introduced.

## User-Facing Text / Directionality

No localization or new UI strings. Release notes name the recovery and its bounded retry contract.

## Agent Inspectability / Explainability Posture

Fault-injected public CommandSession/GitMktreeSession instances expose attempt counts and exact OIDs. Registry version, integrity and installed dependency versions are recorded separately from checkout validation.

## Linked Invariants

Immutable-object retry remains bounded; producer errors are not transport errors; mutable refs are not retried by this repair; test execution never mounts host Git repositories.

## Design Alternatives Considered

A downstream local patch does not reach registry consumers. Broadly retrying all errors would obscure producer failures and operational refusals. Published protocol classification uses the existing narrowly typed retry.

## Decision

Adopt Plumbing rather than duplicate its transport classification in git-cas.

## Proof Surface

The first RED uses the actual protocol and persistence adapter with transport failure injection against unchanged Plumbing. The GREEN uses the published dependency; all runtime and package acceptance remains separate from design/documentation assertions.

## Implementation Slices

Design and prerequisite record; deterministic fault regression and published dependency adoption; isolated release gates; current-head independent review; merge and full release verification; signed tag and registry publication; downstream consumer proof.

## Tests To Write First

Single and batch EPIPE recovery; already-closed input; two-attempt bound; unrelated transport error; producer error preservation. CI/release configuration checks must reject host unit-test and example execution.

## Acceptance Criteria

The six recovery checks and all required runtime suites pass in Docker. Lint, examples, public type and package/JSR validation pass. 6.5.11 metadata agrees and the published registry artifact resolves Plumbing >=3.3.2. The issue stays open until publication/consumer evidence exists.

## Validation Plan

Use COPY-based Docker Compose services for Node/Bun/Deno unit and serialized integration suites, Deno public types, and Node examples; run lint and package/JSR dry runs with the release candidate. No host runtime tests or repository mounts.

## Playback / Witness

Human: does the installed package survive a dead mktree process? Agent: do canonical OIDs, exactly two process attempts, original failures and artifact integrity prove the claim? Store pinned RED/GREEN and publication receipts under this cycle witness directory.

## Risks

A missing upstream registry version blocks adoption. A successful checkout patch is not consumer evidence. A GitHub approval gate or publication environment may delay the train; neither permits bypassing protections.

## Follow-On Debt

None currently discovered beyond tracked git-warp #923 attachment adoption.

## Tracker Disposition

Issue #131 remains open through release publication; Plumbing PR #20 is the upstream prerequisite; git-warp #923 remains open through downstream adoption.

## Done Does Not Mean

This dependency repair does not restore git-warp Runtime/Lane node/edge attachment operations or complete its bounded stream contract.

## Retrospective

Record after merge and publication, with PR and release receipts.

## Data / State Model

No stored data or ref schema changes.

## Architecture / Anti-SLUDGE Posture

Transport classification remains owned by Plumbing. git-cas retains its typed session retry and constructor-injected plumbing boundary.

## Cost / Residency Posture

At most one replacement immutable-object process; no new collector or buffer.

## Determinism / Replay / Causality

Canonical Git tree IDs are unchanged; deterministic injected faults establish retry behavior without timing assertions.

## Git Substrate Impact

Existing trees/blobs remain unchanged. Release creates a new immutable signed version tag after merged-main verification.

## Compatibility / Migration Posture

Patch dependency minimum only; no consumer source or stored-data migration.

## Error Contract

Transport EPIPE and SESSION_INPUT_CLOSED become GitProtocolError with original cause. Other errors retain identity.

## Security / Trust / Redaction Posture

Receipts contain repository-relative paths, public commits and package integrity; no credentials or machine-local paths.

## Lower Modes

Plain logs and JSON receipts provide complete evidence without color or rendered UI.
