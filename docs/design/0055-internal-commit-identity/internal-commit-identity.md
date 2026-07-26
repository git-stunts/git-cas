---
title: "INFRA-0055 - Internal Commit Identity"
cycle: "0055"
task_id: "internal-commit-identity"
legend: "INFRA"
release_home: "v6.5.5"
issue: "https://github.com/git-stunts/git-cas/issues/102"
goalpost_issue: "none"
tracker_source: "github"
status: "landed"
base_commit: "a2d23f5bfc5d00eecab897eadd9072dab4aff534"
owners:
  - "@git-stunts"
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: []
supersedes: []
superseded_by: null
created: "2026-07-26"
updated: "2026-07-26"
---

# INFRA-0055 - Internal Commit Identity

## Linked Issue

- https://github.com/git-stunts/git-cas/issues/102

## Linked Tracker

- Milestone: `v6.5.5`
- Goalpost issue: none
- Slice issue: https://github.com/git-stunts/git-cas/issues/102

## Design Type

- [ ] Runtime/API
- [x] Storage/substrate
- [x] Migration/release
- [ ] CLI/operator
- [ ] Docs/public guidance
- [ ] TUI/visual surface
- [x] Test/tooling

## Decision Summary

Every git-cas-owned commit created through `GitRefAdapter` supplies a stable
internal author and committer name and email to Git. The adapter owns this
metadata; callers and repositories do not need Git user configuration, and
git-cas does not mutate local or global configuration.

## Sponsored Human

An operator with a bare retained store wants storage writes to work without
configuring a personal Git identity in that store or on the machine.

## Sponsored Agent

An agent needs internal commit creation to have a self-contained, inspectable
contract so it can migrate or verify bare stores without inferring ambient
machine configuration.

## Hill

By the end of this cycle, root-set retention succeeds in a bare repository with
no ambient Git identity, and both unit and Git-backed integration tests prove
the exact commit metadata.

## Current Truth

`GitRefAdapter.createCommit()` invokes `git commit-tree` with arguments only.
Git therefore consults repository, global, or system identity. A clean Linux
verification of git-warp's retained-substrate migration fails with
`WORKSPACE_RETENTION_FAILED`; the nested Git error is `Author identity unknown`.
Issue #102 records the defect.

## Problem

Git identity is process input, not storage authority. Depending on ambient
identity makes identical git-cas operations succeed or fail based on the host
and may leak a human identity into internal storage commits.

## Scope

This cycle includes:

- stable internal author and committer metadata for adapter-created commits;
- a unit proof of the exact Git execution request;
- a real bare-repository root-set proof;
- patch-release notes and git-warp migration verification.

## Non-Goals

This cycle does not include:

- fixed commit timestamps or byte-identical commit OIDs;
- changes to commit messages, trees, refs, or compare-and-swap behavior;
- caller-selectable internal identities;
- mutation of repository, global, or system Git configuration.

## Runtime / API Contract

The public API is unchanged. Internally, every `GitRefPort.createCommit()`
request lowered through `GitRefAdapter` executes with:

- author name: `git-cas`
- author email: `git-cas@example.invalid`
- committer name: `git-cas`
- committer email: `git-cas@example.invalid`

Caller-provided ambient identity cannot override these values.

## User Experience / Product Shape

There is no rendered surface. The operator-visible outcome is that root-set,
publication, and vault writes work in unconfigured bare repositories.

## Data / State Model

| State | Source of truth | Derived state | Invalid states | Reset behavior | Serialization | Determinism assumptions |
| --- | --- | --- | --- | --- | --- | --- |
| Internal commit identity | `GitRefAdapter` constants | Commit author and committer headers | Missing or ambient-only identity | Not applicable | Native Git commit headers | Names and emails are stable; timestamps remain runtime-generated |

## Architecture / Anti-SLUDGE Posture

| Concern | Decision |
| --- | --- |
| Domain changes | None |
| Port changes | None |
| Adapter changes | Add one immutable identity map at the Git process boundary |
| Boundary validation | Plumbing filters the four permitted Git identity variables |
| Runtime-backed nouns introduced | None |
| Expected failure representation | Existing Git and CAS error contracts remain |
| Banned shortcuts avoided | No config writes, fallback identities, or caller branching |

## Cost / Residency Posture

| Surface | Current cost | Target cost | Limit/budget | Failure mode |
| --- | --- | --- | --- | --- |
| Internal commit creation | One `commit-tree` process | Same process with four environment values | No extra Git calls | Existing Git failure normalization |

## Determinism / Replay / Causality

Identity strings are deterministic. Commit timestamps remain current-time
metadata, so this cycle does not promise byte-identical commit OIDs. Parentless
root-set generation and compare-and-swap causality are unchanged.

## Git Substrate Impact

| Substrate area | Impact |
| --- | --- |
| refs | None |
| commits | Stable git-cas author and committer headers |
| trees/blobs | None |
| object ids | May differ from ambient-identity commits, as expected |
| tag/release behavior | Patch release `v6.5.5` |
| migration compatibility | Unblocks verification in identity-free bare stores |

## Compatibility / Migration Posture

| Concern | Decision |
| --- | --- |
| Public API compatibility | Unchanged |
| Package export changes | None |
| Storage/read compatibility | Existing commits remain readable |
| Legacy behavior retained | No ambient identity dependency retained |
| Deprecation behavior | None |
| Migration path | Upgrade git-cas; no data rewrite |
| Release note impact | Fixed in `v6.5.5` |

## Error Contract

| Failure | Error/result | Caller recovery | Test |
| --- | --- | --- | --- |
| Ambient identity absent | Commit succeeds with internal identity | None | Root-set integration |
| Git commit fails for another reason | Existing plumbing/CAS error | Address the reported Git failure | Existing adapter and persistence suites |

## Security / Trust / Redaction Posture

- trust boundary: git-cas owns metadata for commits under its storage refs;
- authority or capability checked: unchanged ref allowlists and CAS updates;
- secret-bearing values: none;
- redaction behavior: no human name or email is sourced from ambient config;
- log/report behavior: unchanged;
- abuse or replay concern: identity is descriptive, not authorization.

## Lower Modes

The machine-readable lower mode is the native Git commit object. Tests inspect
its author and committer headers directly.

## Accessibility Posture

No visual interaction changes. The design, changelog, and witness use a linear
text reading order, and the failure/success evidence is available as plain test
output.

## User-Facing Text / Directionality

Only changelog and design prose changes. It uses logical sequence language and
has no direction-dependent layout.

## Agent Inspectability / Explainability Posture

An agent can inspect the exact environment passed to plumbing in the unit test
and the committed headers through `git show`; no pixel or prose inference is
required.

## Linked Invariants

- Internal storage commits do not require caller Git configuration.
- Root-set generations remain parentless and compare-and-swap protected.
- The adapter does not mutate caller repositories beyond the requested objects
  and refs.

## Design Alternatives Considered

### Option A: Configure every repository

Rejected because it mutates caller-owned configuration and leaves global/system
precedence questions.

### Option B: Supply identity only in `RootSetPersistence`

Rejected because publication and vault commits use the same adapter and have
the same hidden dependency.

### Option C: Supply identity in `GitRefAdapter`

Selected because it fixes the dependency once at the internal commit boundary
without changing the port or public API.

## Decision

Use option C. Pass an immutable internal identity map on every adapter-owned
`commit-tree` execution.

## Proof Surface

- actual surface under test: `GitRefAdapter.createCommit()` and Git-backed
  `rootSets.open().put()`;
- first RED test: adapter execution lacked the expected `env` map;
- required witness command: unit suite plus bare root-set integration;
- non-acceptable proof: setting `user.name` or `user.email` in the test repo.

## Implementation Slices

- Add failing adapter execution test.
- Add internal identity map and pass it to plumbing.
- Assert native commit headers in the bare-repository integration.
- Validate, publish the patch, and rerun git-warp's Linux migration proof.

## Tests To Write First

- [x] Adapter test that fails before the environment map exists.
- [x] Integration assertion against native Git commit headers.
- [x] Regression proof for the exact bare-root-set failure.

## Acceptance Criteria

- [x] Adapter behavior supplies all four identity values.
- [x] Bare root-set write records the internal identity.
- [x] Full unit and integration suites are green.
- [x] Changelog and issue are linked.
- [x] Implementation CI is green.
- [ ] The patch package is published.
- [ ] git-warp's clean-Linux migration verification passes on the patch.

## Validation Plan

```bash
pnpm vitest run test/unit/infrastructure/adapters/GitRefAdapter.test.js
GIT_STUNTS_DOCKER=1 pnpm vitest run test/integration/root-set.test.js --no-file-parallelism
npx eslint .
npm test
npm run release:verify -- --skip-jsr
```

The final integration and release checks run in the repository's supported
container workflow.

## Playback / Witness

The witness records the RED adapter assertion, the GREEN unit result, native
commit-header verification, full validation, release evidence, and the
downstream git-warp Linux proof.

## Risks

Known risk:

- internal commit OIDs change because identity is part of commit bytes.

Mitigation:

- git-cas treats these as opaque current-generation commits; tests assert
  semantic reachability and ref behavior, not historical OIDs.

## Follow-On Debt

None currently. New debt must be filed as a GitHub issue.

## Tracker Disposition

| Issue | Role | Expected disposition |
| --- | --- | --- |
| https://github.com/git-stunts/git-cas/issues/102 | primary | close when patch release and downstream proof are complete |

## Done Does Not Mean

When this lands, it does not prove deterministic timestamps, signed internal
commits, or a general public commit-author API.

## Retrospective

The adapter proved to be the narrow ownership boundary: one environment map
covers root-set, publication, and vault commits without repository
configuration or caller coupling. PR #103 merged after local and GitHub
cross-runtime verification passed. Release and downstream verification remain
pending.
