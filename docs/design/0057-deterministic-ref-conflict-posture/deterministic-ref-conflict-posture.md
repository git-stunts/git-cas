---
title: "TRUST-0057 - Deterministic Ref Conflict Posture"
cycle: "0057"
task_id: "deterministic-ref-conflict-posture"
legend: "TRUST"
release_home: "v6.5.6"
issue: "https://github.com/git-stunts/git-cas/issues/111"
goalpost_issue: "https://github.com/git-stunts/git-cas/issues/105"
tracker_source: "github"
status: "landed"
base_commit: "e802269ab6035eae75c2d61a8e8a898800cffbb8"
owners:
  - "@git-stunts"
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: []
supersedes: []
superseded_by: null
created: "2026-07-29"
updated: "2026-07-30"
---

# TRUST-0057 - Deterministic Ref Conflict Posture

## Linked Issue

- https://github.com/git-stunts/git-cas/issues/111

## Linked Tracker

- Milestone: `v6.5.6`
- Goalpost issue: https://github.com/git-stunts/git-cas/issues/105
- Slice issue: https://github.com/git-stunts/git-cas/issues/111

## Design Type

- [x] Runtime/API
- [x] Storage/substrate
- [x] Migration/release
- [ ] CLI/operator
- [ ] Docs/public guidance
- [ ] TUI/visual surface
- [x] Test/tooling

## Decision Summary

Failed checked ref mutations are classified from structured post-failure ref
posture instead of human-readable Git diagnostics. The Git adapter observes
whether each relevant ref is symbolic, direct at a specific OID, or absent;
only posture that disproves the attempted precondition becomes the existing
conflict result or `GIT_REF_CONFLICT`.

## Sponsored Human

An operator wants acquisition and workspace release races to fail through the
documented conflict contract on every supported Git runtime, without depending
on a particular Git diagnostic string or locale.

## Sponsored Agent

An agent needs checked ref failures to carry a stable error code and structured
actual posture so it can distinguish concurrency from repository or process
failures without scraping stderr.

## Hill

By the end of this cycle, checked update, atomic anchor, and checked delete
failures are classified from ref state, and unit plus real-Git race tests prove
that diagnostic-free conflicts normalize while unrelated failures remain
unchanged.

## Current Truth

`GitRefAdapter.anchorRef()` and `deleteRef()` call
`isUpdateRefConflict()`, which searches lowercased error text for a ref name and
six English fragments. `updateRef()` has no post-failure normalization. A
checked-delete race can therefore escape as the plumbing error when Git reports
the mismatch without one of those fragments. Existing tests prove several
symbolic-ref races, but the unit conflict tests supply matching English stderr.

## Problem

Git diagnostics are explanatory prose, not a machine contract. Exit status
alone is also insufficient because compare-and-swap mismatches, lock failures,
permissions, missing repositories, and invalid objects may share an exit code.
The stable semantic evidence is the ref posture observed after the failed
checked operation.

## Scope

This cycle includes:

- one structured post-failure inspection path for symbolic, direct, and absent
  refs;
- posture-based normalization for `updateRef()`, `anchorRef()`, and
  `deleteRef()`;
- removal of `isUpdateRefConflict()` and its diagnostic-text dependency;
- unit tests for diagnostic-free conflicts and preserved unrelated errors;
- real-Git checked-delete race coverage;
- port documentation and `v6.5.6` release notes.

## Non-Goals

This cycle does not include:

- parsing or standardizing Git's stderr;
- treating every non-zero `update-ref` exit as a conflict;
- changing ref names, commit contents, object formats, or public method
  signatures;
- adding retries or weakening fail-closed ownership behavior;
- changing the idempotency policy of higher-level release operations.

## Runtime / API Contract

The existing API remains:

- `updateRef()` resolves on success and rejects with `GIT_REF_CONFLICT` when
  observed posture disproves its compare-and-swap precondition;
- `anchorRef()` returns `false` when the source no longer names the expected
  direct OID or the target is no longer absent;
- `deleteRef()` returns `true` after deletion and rejects with
  `GIT_REF_CONFLICT` when the expected direct OID is absent, changed, or
  replaced by a symbolic ref;
- operational failures whose post-failure posture still satisfies the attempted
  precondition preserve the original error object.

## User Experience / Product Shape

There is no rendered surface. The operator- and agent-visible contract is the
stable error code and structured conflict metadata returned by existing APIs.

## Data / State Model

| State | Source of truth | Derived state | Invalid states | Reset behavior | Serialization | Determinism assumptions |
| --- | --- | --- | --- | --- | --- | --- |
| Ref posture | Git ref database after a failed mutation | `direct`, `symbolic`, or `absent` observation | Malformed structured ref inventory | Fail with the inventory error | Git `symbolic-ref` plus `for-each-ref` output | Classification uses values, not diagnostic prose |

## Architecture / Anti-SLUDGE Posture

| Concern | Decision |
| --- | --- |
| Domain changes | None |
| Port changes | Clarify the existing checked-mutation error contract |
| Adapter changes | Centralize structured post-failure posture inspection |
| Boundary validation | Ref names and OIDs retain existing validation |
| Runtime-backed nouns introduced | None |
| Expected failure representation | Existing boolean conflict result or `GIT_REF_CONFLICT` |
| Banned shortcuts avoided | No stderr matching, exit-code-only classification, or blanket conversion |

## Cost / Residency Posture

| Surface | Current cost | Target cost | Limit/budget | Failure mode |
| --- | --- | --- | --- | --- |
| Successful ref mutation | Existing preflight plus one mutation | Unchanged | No added reads | Existing operational error |
| Failed checked mutation | Diagnostic parsing, then up to two ref reads | Up to two structured ref reads | Relevant refs only | Original error if posture does not prove conflict |

## Determinism / Replay / Causality

Classification is deterministic for the observed post-failure posture. The
design does not claim a global atomic snapshot after Git rejects the mutation;
it claims that no English diagnostic is needed and that every normalized
conflict carries the state actually observed by the adapter.

## Git Substrate Impact

| Substrate area | Impact |
| --- | --- |
| refs | Failed checked mutations gain structured post-failure inspection |
| commits | None |
| trees/blobs | None |
| object ids | Compared canonically through `Oid` |
| tag/release behavior | Patch release `v6.5.6` |
| migration compatibility | No data migration |

## Compatibility / Migration Posture

| Concern | Decision |
| --- | --- |
| Public API compatibility | Signatures unchanged; documented conflict behavior becomes reliable |
| Package export changes | None |
| Storage/read compatibility | Unchanged |
| Legacy behavior retained | Non-conflict operational errors remain original |
| Deprecation behavior | None |
| Migration path | Upgrade package only |
| Release note impact | Fixed in `v6.5.6` |

## Error Contract

| Failure | Error/result | Caller recovery | Test |
| --- | --- | --- | --- |
| Update expected old OID changed, disappeared, or became symbolic | `GIT_REF_CONFLICT` with observed posture | Retry from fresh state | Unit |
| Anchor source changed or target appeared | `false` | Reacquire from fresh source | Unit and integration |
| Checked delete target changed, disappeared, or became symbolic | `GIT_REF_CONFLICT` with observed posture | Treat release as conflicted and inspect | Unit and integration |
| Mutation fails while checked posture still holds | Original error object | Address repository/process failure | Unit |
| Structured inspection is malformed or fails | Inspection error | Address repository/process failure | Existing inventory validation |

## Security / Trust / Redaction Posture

- trust boundary: the Git adapter owns ref mutation authority;
- authority or capability checked: exact ref name, expected direct OID, and
  no-dereference behavior;
- secret-bearing values: none;
- redaction behavior: unchanged;
- abuse or replay concern: a concurrent actor cannot turn a managed ref into a
  symbolic authority path without conflict detection.

## Lower Modes

The lower mode is the existing machine-readable `CasError` with
`GIT_REF_CONFLICT` and `ref`, `expectedOldOid`, `actualOldOid`, and
`actualSymref` metadata.

## Accessibility Posture

No visual interaction changes. Design, errors, tests, and witness output use a
linear text order and do not rely on color or terminal layout.

## User-Facing Text / Directionality

No new interactive text is introduced. Existing conflict messages retain their
wording; machine behavior depends on error codes and metadata.

## Agent Inspectability / Explainability Posture

An agent can inspect the exact expected and actual ref posture through error
metadata. It does not need locale-specific Git text or private adapter state.

## Linked Invariants

- [I-001 - Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)
- Managed ref mutation never follows a symbolic ref.
- Compare-and-swap mismatches fail through explicit conflict contracts.
- Unrelated operational failures are not mislabeled as concurrency.

## Design Alternatives Considered

### Option A: Match more diagnostic strings

Rejected because the classification remains version-, locale-, and
wording-dependent.

### Option B: Use only the Git exit code

Rejected because Git does not assign a unique exit code to compare-and-swap
conflicts.

### Option C: Re-read structured ref posture

Selected because it tests the semantic precondition directly while preserving
unexplained failures.

## Decision

Use option C. Catch failures only around known ref mutations, inspect the
relevant refs, normalize only when the observed posture disproves the
operation's precondition, and otherwise rethrow the original error.

## Proof Surface

- actual surface under test: `GitRefAdapter` checked ref operations;
- first RED tests: diagnostic-free update, anchor, and delete conflicts;
- required runtime witness: real-Git checked-delete race with a diagnostic-free
  wrapper error;
- non-acceptable proof: asserting on Git stderr text.

## Implementation Slices

- Add posture-based RED unit tests.
- Add structured post-failure inspection and remove diagnostic parsing.
- Add or revise the real-Git race witness.
- Update the port contract, changelog, and design lifecycle.
- Validate, merge, and publish `v6.5.6`.

## Tests To Write First

- [x] Diagnostic-free failed update becomes `GIT_REF_CONFLICT` when the OID
  changed.
- [x] Diagnostic-free failed anchor returns `false` when source or target
  posture changed.
- [x] Diagnostic-free failed delete becomes `GIT_REF_CONFLICT` when the ref
  disappeared, changed, or became symbolic.
- [x] Each operation preserves its original error when posture still satisfies
  the attempted precondition.
- [x] Real Git proves the checked-delete race without diagnostic matching.

## Acceptance Criteria

- [x] No checked ref classification depends on diagnostic text.
- [x] The three mutation methods implement the documented posture decision.
- [x] Focused unit and real-Git integration tests pass.
- [x] Full lint, unit, integration, and release verification pass.
- [x] PR review and CI are green.
- [ ] `v6.5.6` is tagged, published to npm, and represented by a GitHub Release.

## Validation Plan

```bash
pnpm vitest run test/unit/infrastructure/adapters/GitRefAdapter.test.js
pnpm vitest run test/integration/cache-set.test.js --no-file-parallelism
pnpm run lint
pnpm test
pnpm run release:verify
```

The final release workflow repeats lint, unit, and Node/Bun/Deno integration
validation from the reviewed tag.

## Playback / Witness

The witness is the linked pull request plus CI and release workflow. It records
the RED diagnostic-free tests, GREEN unit and real-Git results, full verifier
counts, merged SHA, signed tag, npm version, and GitHub Release URL.

## Risks

The ref can change again after post-failure inspection. The design therefore
reports observed posture and does not claim a durable lock. False conflict
classification is bounded by requiring the observed posture to contradict the
attempted precondition.

## Follow-On Debt

None currently. New debt must be filed as a GitHub issue.

## Tracker Disposition

| Issue | Role | Expected disposition |
| --- | --- | --- |
| https://github.com/git-stunts/git-cas/issues/111 | primary | close when `v6.5.6` publication is verified |

## Done Does Not Mean

This cycle does not make Git ref inspection and mutation one atomic operation,
introduce distributed locking, or promise that all Git failures have dedicated
Git exit codes.

## Retrospective

PR #112 merged the posture-based classifier as
`4327effd31c6d8ff00980512d6c59fc5064432d7` after all six GitHub checks
passed, CodeRabbit approved the exact head, and no review threads existed.
Re-reading structured state after a failed checked mutation proved narrower
than both diagnostic parsing and exit-code classification: only a contradicted
precondition becomes concurrency, while repository and process failures retain
their original identity. The v6.5.6 release candidate then passed the complete
14-step verifier.
