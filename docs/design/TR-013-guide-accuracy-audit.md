# TR-013 — Truth: Guide Accuracy Audit

## Status

Landed

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

The guide had two distinct problems:

- placement drift: it still lived at the repo root even though it is a
  long-form secondary teaching surface, not a front-door canonical doc
- accuracy drift: several examples still taught stale CLI syntax, internal
  import paths, and pre-observability behavior

That made the guide unusually risky because it is long, authoritative in tone,
and easy to copy from.

## Human Users, Jobs, And Hills

### Users

- maintainers
- contributors trying to learn the product from one long document
- adopters looking for a progressive walkthrough beyond the README

### Jobs

- find the guide in a more appropriate docs location
- trust that the examples use current public entrypoints and CLI syntax
- distinguish canonical API/security docs from the long-form tutorial surface

### Hill

A maintainer or adopter can use the guide as a current long-form walkthrough
without being pushed toward stale root placement, outdated restore semantics, or
internal import paths.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents

### Jobs

- treat the guide as a secondary maintained docs surface instead of a root-level
  canonical artifact
- cite or repair guide examples without inheriting stale package boundaries
- route readers to the canonical API, architecture, and security docs when
  needed

### Hill

An agent can reason about the guide as a maintained tutorial under `docs/`,
with current examples and explicit links to the repo's canonical truth sources.

## Human Playback

- Does the guide now live under `docs/` instead of competing with root-level
  front-door docs?
- Do the obvious CLI and public-API examples still match the shipped surface?
- Does the guide tell readers where the canonical API and security docs live?

## Agent Playback

- Can an agent find the guide under `docs/` and tell that it is a long-form
  walkthrough rather than the only canonical source?
- Do the repaired examples avoid stale internal imports for common workflows?
- Are the most obviously stale behavior claims about restore and observability
  now accurate?

## Explicit Non-Goals

- no full rewrite of the guide into multiple smaller docs
- no attempt to eliminate all overlap with the README and API reference
- no architecture refactor or API-surface change just to simplify the guide

## Decisions

### Move The Guide Under `docs/`

The guide should remain in the repo, but not at the root. It belongs under
`docs/` as a maintained long-form tutorial, with the README linking to it.

### Repair Public-Surface Accuracy First

This cycle should fix the most consequential accuracy problems:

- restore examples should use current `--oid` / `--slug` CLI syntax
- tree restore should use `readManifest()` instead of internal plumbing and
  source imports
- observability should be documented through `ObservabilityPort` and
  `EventEmitterObserver`, not as `CasService extends EventEmitter`
- obvious public-package import examples should stop pointing at internal
  `src/...` paths when a public path or duck-typed example is enough

### Keep The Result Honest About Scope

The guide is still a long-form teaching surface, not the sole canonical source.
It should point readers toward the API, architecture, security, and threat docs
instead of pretending to replace them.

## Implementation Outline

1. Move [GUIDE.md](../../GUIDE.md) under `docs/`.
2. Update front-door references so readers can still find it.
3. Repair the stale public-surface examples and behavior claims that materially
   affect trust.
4. Add this cycle doc, archive the consumed backlog card, update the Truth
   indexes, and record the cycle in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new executable tests.

This is a documentation-truth cycle. Verification is:

- direct cross-check of the moved guide against the current public CLI and
  package surface
- formatting validation for touched Markdown files
- planning-surface validation for backlog, archive, design, and legend updates

## Risks And Unknowns

- the guide is still long enough to drift again if it is not kept in normal doc
  review flow
- some deeper sections may still deserve future rationalization even after this
  accuracy pass
- moving the guide under `docs/` may require a short adjustment period for
  readers used to the old root path

## Retrospective

This was the right next move once the repo started auditing its root Markdown
surface.

The guide did not need to be deleted. It needed to stop pretending to be a
root-level front door and stop teaching stale internals as if they were the
current public surface.
