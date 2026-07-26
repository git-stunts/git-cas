---
title: 'PERF-0054 - Batched Page Retention'
cycle: '0054'
task_id: 'batched-page-retention'
legend: 'PERF'
release_home: 'v6.5.4'
issue: 'https://github.com/git-stunts/git-cas/issues/99'
goalpost_issue: 'https://github.com/git-stunts/git-cas/issues/99'
tracker_source: 'github'
status: 'active'
base_commit: 'd446d97e0436afccdfc0398091ba18888375d8b0'
owners:
  - '@git-stunts'
sponsors:
  human: 'James'
  agent: 'Codex'
blocking_issues: []
supersedes: []
superseded_by: null
created: '2026-07-26'
updated: '2026-07-26'
---

# PERF-0054 - Batched Page Retention

## Linked Issue

- https://github.com/git-stunts/git-cas/issues/99

## Linked Tracker

- Milestone: `v6.5.4`
- Goalpost issue: https://github.com/git-stunts/git-cas/issues/99
- Slice issue: https://github.com/git-stunts/git-cas/issues/99

## Design Type

- [x] Runtime/API
- [x] Storage/substrate
- [x] Migration/release
- [ ] CLI/operator
- [x] Docs/public guidance
- [ ] TUI/visual surface
- [x] Test/tooling

## Decision Summary

Staging workspaces will expose `pages.putBatch()`. It will delegate bounded
page creation to the existing page-batch service, resolve every returned page,
and install the complete batch in one compare-and-swap workspace generation.
Results remain ordered and individually witnessed.

## Sponsored Human

A storage operator wants large bounded page sets retained without a growing
root-set rewrite for every page, so one-time migrations finish in practical
time without weakening reachability.

## Sponsored Agent

An agent needs an explicit bounded batch contract and per-page witnesses so it
can prove retention and cost without inferring safety from loose Git objects.

## Hill

By the end of this cycle, git-warp can stage thousands of bounded index pages
through page batches, and git-cas proves that each batch creates one workspace
generation while returning exact retained witnesses.

## Current Truth

`PageService.putBatch()` already validates and writes a bounded ordered page
batch. `StagingWorkspace.pages` exposes only `put()`, and each call invokes
`#install()` with the growing set of workspace targets. A git-warp v19
rehearsal measured 8,188 required pages; after 75 minutes, 5,213 pages had
produced about 1.16 GiB of loose scratch objects because every page rewrote the
flat root set. Issue #99 owns the release blocker.

## Problem

The workspace API forces page-oriented callers into quadratic root-set write
amplification even though git-cas already has a bounded bulk-write primitive.

## Scope

This cycle includes:

- `workspace.pages.putBatch()` with the `PageService.putBatch()` options
- one serialized workspace installation for all unique batch handles
- ordered retained results and exact per-page witnesses
- limit, failure, duplicate, and generation-count tests
- public API and release documentation

## Non-Goals

This cycle does not include:

- changing page, handle, root-set, or workspace serialization
- retaining an unbounded batch
- changing single-page `put()` behavior
- changing bundle layout or garbage-collection policy
- migrating existing refs or objects

## Runtime / API Contract

`workspace.pages.putBatch(options)` accepts the same bounded `pages`,
`maxBatchBytes`, and `maxBatchPages` fields as `ContentAddressableStore.pages`.
It returns a frozen array in input order. Every result is a retained staged
page whose witness names the same workspace generation. Duplicate page content
may share one target entry while preserving one ordered result per input.

## User Experience / Product Shape

There is no rendered interface. The public JavaScript API and its inspectable
retention witnesses are the user-visible surface.

## Data / State Model

| State             | Source of truth       | Derived state | Invalid states                  | Reset behavior                   | Serialization             | Determinism assumptions    |
| ----------------- | --------------------- | ------------- | ------------------------------- | -------------------------------- | ------------------------- | -------------------------- |
| staged pages      | Git blobs             | page handles  | unresolved or wrong-type handle | failed objects stay unanchored   | unchanged blob format     | content-addressed          |
| workspace targets | current workspace ref | witnesses     | missing batch target            | release deletes exact generation | unchanged root-set format | targets sorted canonically |

## Architecture / Anti-SLUDGE Posture

| Concern                         | Decision                                                    |
| ------------------------------- | ----------------------------------------------------------- |
| Domain changes                  | Compose existing page-batch and workspace-install contracts |
| Port changes                    | None                                                        |
| Adapter changes                 | None                                                        |
| Boundary validation             | Reuse `PageService.putBatch()` limits and handle resolution |
| Runtime-backed nouns introduced | None                                                        |
| Expected failure representation | Existing `CasError` codes and retention wrapping            |
| Banned shortcuts avoided        | No unretained success result and no legacy path             |

## Cost / Residency Posture

| Surface          | Current cost                   | Target cost              | Limit/budget             | Failure mode             |
| ---------------- | ------------------------------ | ------------------------ | ------------------------ | ------------------------ |
| stage N pages    | N growing root-set generations | one generation per batch | explicit pages and bytes | batch or retention error |
| result witnesses | N exact witnesses              | N exact witnesses        | workspace target maximum | workspace state error    |

## Git Substrate Impact

| Substrate area          | Impact                                       |
| ----------------------- | -------------------------------------------- |
| refs                    | one CAS workspace-ref update per batch       |
| commits                 | one parentless root-set generation per batch |
| trees/blobs             | unchanged page blobs; one current root tree  |
| object ids              | unchanged content addressing                 |
| tag/release behavior    | patch release `v6.5.4`                       |
| migration compatibility | no stored-format migration                   |

## Compatibility / Migration Posture

| Concern                    | Decision               |
| -------------------------- | ---------------------- |
| Public API compatibility   | additive               |
| Package export changes     | none                   |
| Storage/read compatibility | unchanged              |
| Legacy behavior retained   | `pages.put()` remains  |
| Deprecation behavior       | none                   |
| Migration path             | none                   |
| Release note impact        | document batch staging |

## Error Contract

| Failure                    | Error/result                      | Caller recovery            | Test              |
| -------------------------- | --------------------------------- | -------------------------- | ----------------- |
| page/byte limit            | existing page-batch limit error   | reduce batch               | focused unit test |
| page write failure         | original page-service error       | retry a new batch          | failure test      |
| resolution/install failure | workspace retention failure       | release or retry workspace | failure test      |
| concurrent mutation        | serialized operation or CAS error | retry                      | concurrency test  |

## Security / Trust / Redaction Posture

- trust boundary: application handles become workspace roots only after type resolution
- authority or capability checked: existing workspace and root-set capabilities
- secret-bearing values: none added
- redaction behavior: unchanged
- log/report behavior: no payload logging
- abuse or replay concern: explicit byte/page limits prevent unbounded batches

## Lower Modes

The lower mode is the ordered array of handles and machine-readable retention
witnesses; no visual context is required.

## Accessibility Posture

Documentation and witness evidence use a linear text reading order. No color,
layout, motion, or pointer interaction carries meaning.

## Agent Inspectability / Explainability Posture

An agent can compare result order, handle identities, witness generations, ref
update count, and reachable tree entries directly through the API and tests.

## Linked Invariants

- staged success always includes an anchored retention witness
- workspace mutations are serialized and compare-and-swap
- root sets remain parentless current-generation authority
- page batches remain explicitly bounded

## Design Alternatives Considered

### Option A: Keep staging one page at a time

Rejected because it preserves the measured quadratic root-set amplification.

### Option B: Write unretained pages and retain only a final bundle

Rejected because it weakens the explicit workspace retention contract between
page creation and bundle publication.

### Option C: Batch page creation and install the batch once

Selected because it composes existing bounded primitives, preserves individual
witnesses, and changes no stored format.

## Decision

Add `pages.putBatch()` to `StagingWorkspace`, backed by one page-service batch
and one workspace installation.

## Proof Surface

- actual surface under test: `StagingWorkspace.pages.putBatch()`
- first RED test: three pages share one witness generation and one ref update
- required witness command: focused unit and Git-backed integration tests
- non-acceptable proof: timing claims without generation/object evidence

## Implementation Slices

- add RED unit coverage for ordering, witness identity, and one generation
- implement batch staging and dependency validation
- add Git-backed integration and limit/failure coverage
- update public docs, changelog, and witness

## Tests To Write First

- [x] one batch returns ordered retained pages under one generation
- [x] duplicate content preserves ordered results without duplicate targets
- [x] page-batch limits fail before workspace mutation
- [x] a batch retention failure returns no retained result

## Acceptance Criteria

The work is done when:

- [x] behavior tests prove one installation per batch
- [x] every result has an exact anchored witness
- [x] limits and failure containment remain explicit
- [x] public docs and changelog describe the additive API
- [x] issue and PR are linked correctly
- [x] local validation is green; CI is pending the pull request

## Validation Plan

```bash
npx vitest run test/unit/domain/services/StagingWorkspace.test.js
npx vitest run test/integration/staging-workspace.test.js
npx eslint .
npm test
npm run release:verify -- --skip-jsr
```

## Playback / Witness

The witness records the focused test output, the root-set update count, and the
git-warp migration benchmark before and after bounded batches.

## Risks

- a duplicate handle could lose one ordered result; preserve results separately
  from the deduplicated target map
- a partial page-service failure could leave unreachable blobs; never return
  retained success and rely on normal object cleanup
- a large caller-selected target set could hit the workspace maximum; retain
  the existing explicit failure

## Follow-On Debt

None currently. Any new deferred work must be opened as a GitHub issue.

## Tracker Disposition

| Issue                                           | Role    | Expected disposition |
| ----------------------------------------------- | ------- | -------------------- |
| https://github.com/git-stunts/git-cas/issues/99 | primary | close after merge    |

## Done Does Not Mean

When this lands, it does not prove every downstream caller uses batches, nor
does it authorize git-warp v19 release without its full migration rehearsal.

## Retrospective

Fill this section after implementation and review.
