# v6.0.1 Release Truth Closeout

## Identity

| Field | Value |
| --- | --- |
| Goalpost id | `v6.0.1-gp-release-truth-closeout` |
| Release home | `v6.0.1` |
| Umbrella issue | `not opened yet` |
| Goalpost doc | `docs/archive/goalposts-pre-issues/v6.0.1/release-truth-closeout.md` |
| Design cycle | `not active yet` |
| Slice budget | `3` |
| Status | `scaffolded` |
| Sponsor human | `James` |
| Sponsor agent | `Codex` |

## Outcome

The `v6.0.1` patch release can be tagged or intentionally abandoned from a
truthful state: release docs, backlog lanes, changelog, and verification
evidence all agree with what is on `main`.

## Current Truth

- [STATUS.md](../../../../STATUS.md) describes `v6.0.1` as a patch candidate on
  `main` and records `npm run release:verify -- --skip-jsr` passing 12/12 steps
  with 5,383 observed tests.
- [ROADMAP.md](../../../../ROADMAP.md) now treats release planning as goalpost
  driven rather than milestone fiction.
- [docs/method/backlog/README.md](../../../method/backlog/README.md) has empty
  `asap/` and `up-next/` lanes.
- Some older TUI backlog cards still describe pre-ship states and need a truth
  pass before they become `v6.2.0` goalpost work.

## Scope

- Decide whether `v6.0.1` should ship as a patch release or be folded into
  `v6.1.0`.
- Reconcile `STATUS.md`, `CHANGELOG.md`, and release evidence.
- Reclassify stale backlog entries that already shipped, became obsolete, or
  need a new goalpost.

## Out Of Scope

- New runtime behavior.
- Large-vault scale fixes.
- TUI feature work.
- JSR publication unless the upstream dry-run blocker has cleared.

## Proof Stories

```text
A maintainer needs one truthful patch-release state
so that the next tag or non-tag decision is auditable,
without relying on scattered memory of previous release runs.
```

| Story issue | Actor | Need | Reason | Slice budget |
| --- | --- | --- | --- | ---: |
| `not opened yet` | maintainer | release truth reconciliation | avoid tagging stale evidence | 1 |
| `not opened yet` | maintainer | backlog truth pass | prevent old TUI cards from masquerading as active work | 1 |
| `not opened yet` | agent | deterministic release-state checks | inspect release readiness without reading prose manually | 1 |

## Slice Budget

| Slice | Status | Description | Expected proof |
| ---: | --- | --- | --- |
| 1 | open | Reconcile patch release docs and changelog state. | docs test or release-state witness |
| 2 | open | Audit stale backlog cards and reclassify them. | backlog index check |
| 3 | open | Record tag/no-tag decision for `v6.0.1`. | release witness or closeout note |

## Acceptance Criteria

- [ ] The patch release decision is explicit.
- [ ] `STATUS.md`, `CHANGELOG.md`, `ROADMAP.md`, and backlog indexes agree.
- [ ] Stale TUI cards are either rewritten, moved, or carried forward with
      current truth.
- [ ] Local docs tests and release-state checks pass.

## Deterministic Evidence

| Claim | Canonical fixture or input | Witness | Replay command | Expected deterministic result |
| --- | --- | --- | --- | --- |
| Release docs agree | active release docs | docs test output | `npx vitest run test/unit/docs` | no stale release claims |
| Backlog index agrees | lane files | planning surface test | `npx vitest run test/unit/docs/planning-surfaces.test.js` | lane links match files |

## Substrate / Residency Geometry

| Reading claim | Basis | Aperture | Law/projection | Support obligations | Witness posture |
| --- | --- | --- | --- | --- | --- |
| Release truth is doc-backed | `main` docs | active release docs only | parse documented release state | docs tests cover stale claims | committed witness or test output |

## Validation Plan

```bash
npx vitest run test/unit/docs
npx eslint .
npm test
```

## Release Gate Impact

This goalpost decides whether `v6.0.1` is cut from the current patch candidate
or folded into `v6.1.0`. It should not change package behavior.

## Residual Risks

| Risk | Rationale | Owner | Follow-up issue |
| --- | --- | --- | --- |
| JSR remains deferred | The blocker is upstream of this repo. | maintainer | `not opened yet` |

## Closeout

- [ ] Slices complete or honestly dispositioned.
- [ ] Proof matrix replayed.
- [ ] Goalpost issue updated.
- [ ] Child proof-story issues closed, superseded, or carried forward.
- [ ] Pull request merged for this goalpost.
- [ ] Release evidence updated when release-relevant.
- [ ] Retrospective or closeout note written.
