# TR-010 — Truth: Planning Index Consistency Review

## Status

Landed

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

The planning model now spans several linked surfaces:

- the live backlog
- landed design history
- archived backlog history
- legend summaries

Those files can drift even when the underlying work is correct. The failure
mode is usually small but costly:

- a landed cycle stays listed in the live backlog
- a legend summary lags the current design surface
- archive state and design state stop matching

The repo already says indexes are part of the workflow. This cycle makes the
review pass explicit enough to run reliably.

## Human Users, Jobs, And Hills

### Users

- maintainers
- contributors closing cycles or moving planning artifacts
- reviewers checking whether planning docs tell the truth

### Jobs

- verify that planning surfaces agree before opening or merging a PR
- catch backlog, design, archive, and legend drift without manual spelunking
- keep the planning model trustworthy without adding ceremony for its own sake

### Hill

A maintainer can run one short planning-index review and know that the backlog,
design, archive, and legend surfaces agree with the real lifecycle state.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- documentation agents
- review agents

### Jobs

- check planning-surface alignment explicitly instead of inferring around drift
- know when a planning-index review is required
- distinguish live work from landed history and archived intent reliably

### Hill

An agent can treat the planning surfaces as one coherent system because the repo
defines both the review triggers and the minimum consistency checks.

## Human Playback

- Is it obvious when a planning-index review must run?
- Does the review stay short enough to use on every cycle-closing PR?
- Does it say exactly what must match across backlog, design, archive, and
  legends?

## Agent Playback

- Can an agent tell when a branch must review planning-index consistency?
- Can it enumerate the minimum alignment checks without inventing its own list?
- Does the doctrine stay pragmatic instead of turning into calendar-driven
  ceremony?

## Explicit Non-Goals

- no attempt to build automated linting for every planning surface in this cycle
- no requirement for a fixed calendar schedule
- no broad rewrite of unrelated legacy planning artifacts

## Decisions

### Use The Existing Docs Checklist

The planning-index review should live inside
[docs/DOCS_CHECKLIST.md](../DOCS_CHECKLIST.md), not as a separate maintainer
ritual disconnected from the normal docs review pass.

### Define Trigger Conditions In Workflow

[WORKFLOW.md](../../WORKFLOW.md) should say when the planning-index review is
required:

- when a branch changes backlog, design, archive, or legend indexes
- when a backlog card moves lifecycle state
- when a cycle-closing PR is preparing the post-merge truth state
- when drift is discovered on `main`

### Define The Minimum Alignment Matrix

The review should verify, at minimum:

- live backlog items are still pending, in cycle, or carrying unresolved
  follow-on work
- landed cycle docs appear in `docs/design/`
- archived backlog history matches landed or retired cards
- legend current-cycle summaries agree with the backlog and design surfaces
- empty-state wording does not invent a new house style accidentally

## Implementation Outline

1. Add this cycle doc.
2. Extend [docs/DOCS_CHECKLIST.md](../DOCS_CHECKLIST.md) with a planning-index
   review section and the minimum alignment checks.
3. Update [WORKFLOW.md](../../WORKFLOW.md) and
   [CONTRIBUTING.md](../../CONTRIBUTING.md) so the planning-index review is
   both required and discoverable from tracked doctrine.
4. Archive the consumed backlog card, update the Truth indexes, and record the
   cycle in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new executable tests.

This is a documentation-truth cycle. Verification is:

- direct cross-check of backlog, design, archive, and legend surfaces after the
  edits
- formatting validation for touched Markdown files
- whitespace and diff validation

## Risks And Unknowns

- a manual review can still be skipped if contributors ignore the doctrine
- the repo may eventually want automated linting for some of these checks
- legacy historical docs outside the legends model can still drift without
  violating this cycle directly

## Retrospective

This is the right follow-through after the earlier Truth cycles.

The workflow already said indexes mattered. What was missing was a clear,
repeatable pass for keeping those indexes aligned when real branches land. The
small drift that showed up on `main` after the previous cycle was exactly the
kind of failure this review is meant to catch quickly.
