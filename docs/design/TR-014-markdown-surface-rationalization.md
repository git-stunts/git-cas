# TR-014 — Truth: Markdown Surface Rationalization

## Status

Landed

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

The repo had already fixed several individual documentation truth gaps:

- stale architecture truth
- missing threat model
- benchmark publication
- design lifecycle clarity
- docs-review checklist and cross-link audits
- guide placement and guide accuracy

What was still missing was one explicit map of the Markdown surface itself.

Without that, each docs-heavy review had to rediscover the same questions:

- which files actually belong at the repo root
- which ones are canonical versus migration surfaces
- which ones should be cut, merged, or moved instead of kept indefinitely

## Human Users, Jobs, And Hills

### Users

- maintainers
- contributors opening docs-heavy pull requests
- reviewers trying to judge whether a file belongs where it is

### Jobs

- see the whole tracked Markdown surface at once
- distinguish canonical docs from migration and archive surfaces
- make future cut/move/merge decisions from one explicit map instead of memory

### Hill

A maintainer can look at one repo-native document and tell where each tracked
Markdown file belongs, whether it should stay, and which root-level artifacts
still need follow-on cleanup.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents

### Jobs

- reason about the Markdown surface without treating every file as equally
  canonical
- plan docs changes from explicit keep/cut/merge/move recommendations
- stop rediscovering root-versus-docs placement policy on every branch

### Hill

An agent can use one tracked Markdown-surface map as the repo's current
placement and rationalization reference.

## Human Playback

- Is there now one explicit Markdown-surface map with a recommendation for each
  tracked Markdown file?
- Does it say which artifacts belong at the root and which do not?
- Does it separate canonical, planning, archive, and local-only surfaces
  clearly?

## Agent Playback

- Can an agent tell which Markdown files are canonical, archival, migration, or
  tool-specific?
- Does the audit cover tracked files broadly enough to avoid branch-local
  guesswork?
- Does it make future move/cut/merge work easier without performing all of it
  prematurely?

## Explicit Non-Goals

- no attempt to execute every recommended move or cut in this cycle
- no full content-accuracy rewrite of every Markdown file in the repo
- no destruction of useful planning or archive history

## Decisions

### Publish One Explicit Markdown-Surface Map

The repo should have one tracked Markdown-surface audit at
[docs/MARKDOWN_SURFACE.md](../MARKDOWN_SURFACE.md) instead of leaving these
placement decisions implicit.

### Keep The Audit File-Specific

This cycle should make a recommendation for each tracked Markdown file, not
just broad directory-level guidance. That keeps the result actionable for both
humans and agents.

### Separate Placement Guidance From Execution

The audit should identify candidates for `CUT`, `MERGE`, and `MOVE` without
trying to execute every recommendation at once. That keeps the cycle honest and
reviewable.

## Implementation Outline

1. Add [docs/MARKDOWN_SURFACE.md](../MARKDOWN_SURFACE.md) with per-file
   recommendations across the tracked Markdown surface.
2. Add this cycle doc.
3. Archive the consumed backlog card, update the Truth indexes, and record the
   audit in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new executable tests.

This is a documentation-truth cycle. Verification is:

- cross-check against the tracked Markdown file inventory
- formatting validation for touched Markdown files
- planning-surface validation for backlog, archive, design, and legend updates

## Risks And Unknowns

- some recommendations may age as the repo evolves
- the audit surfaces content-accuracy follow-ons it does not itself fix
- tool-specific root files may require a separate policy decision before they
  can be removed or relocated

## Retrospective

This cycle was necessary once the repo had enough documentation cleanup behind
it to stop making purely local decisions.

The repo now has an explicit Markdown placement map. That does not finish the
cleanup, but it turns future cleanup into deliberate work instead of repeated
review improvisation.
