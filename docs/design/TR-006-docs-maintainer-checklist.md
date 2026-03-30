# TR-006 — Truth: Docs Maintainer Checklist

## Status

Landed

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

Recent review cycles kept finding the same documentation hazards late:

- public and internal boundaries were left implicit
- summary docs did not always point to canonical truth sources
- planning and legend surfaces drifted in wording and index state

None of those failures required large rewrites. They required a short, explicit
quality pass that maintainers and agents could both run before review.

## Human Users, Jobs, And Hills

### Users

- maintainers
- contributors opening doc-heavy pull requests
- reviewers trying to verify documentation truth quickly

### Jobs

- run a repeatable final pass on documentation changes
- catch truth and discoverability gaps before review comments do
- keep planning and current-state docs honest without over-process

### Hill

A maintainer can use one short checklist to catch the recurring documentation
truth failures before opening a doc-heavy pull request.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents

### Jobs

- apply the same documentation quality pass humans are expected to run
- check canonical links, boundary clarity, and index hygiene explicitly
- avoid inventing a private documentation review standard per branch

### Hill

An agent can use one canonical checklist as the expected pre-review pass for
doc-heavy changes.

## Human Playback

- Is there now one obvious checklist to run before a doc-heavy PR?
- Does it stay short enough to use on every relevant branch?
- Does it focus on the recurring review failures instead of generic style lore?

## Agent Playback

- Can an agent tell which documentation hazards matter most in this repo?
- Can it find the checklist from the main contribution and workflow surfaces?
- Does the checklist point agents toward canonical docs instead of duplicate
  narratives?

## Explicit Non-Goals

- no attempt to solve every future docs review issue in one cycle
- no replacement for normal proofreading or technical review
- no large documentation reorganization beyond what this checklist needs

## Decisions

### Publish One Canonical Checklist

The repo should keep one short maintainer-facing checklist in
[docs/DOCS_CHECKLIST.md](../DOCS_CHECKLIST.md) instead of scattering these
review heuristics through comments and memory.

### Wire The Checklist Into Doctrine

The checklist should be linked from the tracked contribution and workflow docs
so it is part of the normal process, not an orphaned reference file.

### Keep It Focused On Recurring Truth Failures

The checklist should focus on:

- public versus internal boundary clarity
- canonical-source linking
- cross-doc discoverability
- planning index hygiene
- empty-state wording discipline

It should not become a generic writing-style manifesto.

## Implementation Outline

1. Add [docs/DOCS_CHECKLIST.md](../DOCS_CHECKLIST.md) as the canonical
   maintainer-facing checklist.
2. Link it from [CONTRIBUTING.md](../../CONTRIBUTING.md) and
   [WORKFLOW.md](../../WORKFLOW.md).
3. Add this cycle doc, archive the consumed backlog card, update the Truth
   indexes, and record the cycle in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new executable tests.

This is a documentation-truth cycle. Verification is:

- direct doc cross-check against the recurring review failures it is meant to
  prevent
- formatting validation for touched Markdown files
- index cross-checks for backlog and design lifecycle updates

## Risks And Unknowns

- the checklist can rot into boilerplate if maintainers stop using it
- some review churn will still belong to content accuracy, not checklist gaps
- empty-state wording still has a dedicated follow-on cycle in the backlog

## Retrospective

This is the right kind of small Truth cycle.

The repo did not need a bigger process model. It needed one short, canonical
pass in the tracked doctrine surface that turns repeated review lessons into
normal maintainer behavior.
