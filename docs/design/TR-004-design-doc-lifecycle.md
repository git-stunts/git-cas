# TR-004 — Truth: Design Doc Lifecycle

## Status

Active

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

The repo had adopted legends, cycles, backlog items, and invariants, but the
document lifecycle was still blurry in practice:

- delivered backlog items still lived in the active backlog
- landed cycle docs still claimed `Active` or `Proposed`
- the workflow described how to start work, but not how to retire planning
  artifacts cleanly

That makes the planning surface noisier than it needs to be and weakens the
"current truth" promise.

## Human Users, Jobs, And Hills

### Users

- maintainers
- contributors navigating current and historical planning artifacts

### Jobs

- tell current work from historical work quickly
- retain useful decision history without turning the active backlog into an
  archive
- understand whether a cycle doc is proposed, active, landed, or superseded

### Hill

A maintainer can open the planning docs and immediately tell what is still
queued, what has landed, and what is historical context.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents

### Jobs

- reason about current priorities from the active backlog only
- treat landed cycle docs as implementation history
- avoid mistaking stale planning cards for unfinished work

### Hill

An agent can distinguish active planning truth from archived planning history
without inventing its own heuristics.

## Human Playback

- Does the current backlog only show work that is still pending or in cycle?
- Do landed cycle docs say `Landed` instead of pretending they are still active?
- Is there an obvious home for archived planning artifacts?

## Agent Playback

- Can an agent infer backlog state from the current backlog index without
  reading delivered cards?
- Can it tell whether a design doc is still proposed, currently active, landed,
  or superseded?
- Can it find archived backlog history when it needs provenance?

## Explicit Non-Goals

- no attempt to archive every historical document in the repo
- no retroactive rewrite of unrelated ADRs or roadmap-era docs
- no deletion of useful decision records

## Decisions

### Backlog Means Pending Work

`docs/BACKLOG/` is the live backlog.

It should contain only items that are:

- queued
- in cycle
- still carrying unresolved follow-on work

Once a cycle lands cleanly, its consumed backlog card should leave the live
backlog.

### Landed Cycle Docs Stay In `docs/design/`

Landed cycle docs remain in `docs/design/` as the durable record of what was
designed and delivered.

They are still useful implementation history and should stay easy to find.

Only superseded, abandoned, or otherwise retired cycle docs should move to
`docs/archive/design/`.

### Archive Delivered Backlog Items

Delivered backlog cards move to `docs/archive/BACKLOG/`.

That preserves cheap planning history without cluttering the live backlog.

### Normalize Status Vocabulary

Cycle docs should use explicit status values:

- `Proposed`
- `Active`
- `Landed`
- `Superseded`
- `Archived`

Delivered Relay cycle docs that had stale `Proposed` or `Active` states should
be corrected to `Landed` in this cycle.

## Implementation Outline

1. Add this lifecycle cycle doc.
2. Update [WORKFLOW.md](../../WORKFLOW.md) with explicit lifecycle rules and
   archive directories.
3. Add archive readmes for backlog and design artifacts.
4. Move delivered backlog items out of `docs/BACKLOG/` into
   `docs/archive/BACKLOG/`.
5. Normalize delivered cycle-doc statuses and update the live indexes and
   legends to reflect current truth.

## Tests To Write First

No new executable tests.

This is a documentation and repository-organization cycle. Verification is:

- cross-check that indexes match moved files and current statuses
- formatting validation for touched Markdown files

## Risks And Unknowns

- future contributors can still bypass the lifecycle if the indexes are not
  maintained
- some older historical docs outside the legends/cycles model will remain as
  migration surfaces

## Retrospective

This was overdue.

The workflow was directionally right, but it was not yet being enforced by the
shape of the docs tree. Applying the lifecycle immediately made the planning
surface quieter and more honest.
