# TR — Truth

## Status

Active

## Theme

Keep the repo honest about what `git-cas` is, how it works, what it protects,
and what tradeoffs it makes.

## Why This Legend Exists

`git-cas` now has a strong front door and a substantial shipped surface, but
parts of the repo still drift out of sync with reality:

- architectural docs can lag shipped behavior
- security docs can stop short of a real threat model
- benchmark entrypoints can exist without stable published results
- planning history can accumulate faster than current-state truth

That kind of drift is costly for both humans and agents. It makes the repo
harder to trust, harder to review, and harder to extend cleanly.

## Human Users, Jobs, And Hills

### Users

- maintainers
- contributors
- operators evaluating storage and security tradeoffs

### Jobs

- understand the current architecture without reverse-engineering the code
- understand what the cryptographic and operational guarantees do and do not
  cover
- understand performance tradeoffs before adopting a mode or default

### Hill

A maintainer or operator can read the docs and make correct architectural,
security, and adoption decisions without discovering later that the repo told
them something stale or incomplete.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents
- CI and release workflows that depend on repo truth

### Jobs

- reason from current docs without inheriting stale assumptions
- plan refactors and follow-on work from explicit architectural seams
- cite threat and benchmark guidance without inventing missing context

### Hill

An agent can treat the repo docs and planning surfaces as reliable inputs for
implementation, review, and follow-on planning.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Current Cycle Surface

Current Truth design docs:

- [TR-001 — Truth: Architecture Reality Gap](../design/TR-001-architecture-reality-gap.md)
- [TR-002 — Truth: Threat Model](../design/TR-002-threat-model.md)
- [TR-003 — Truth: Benchmark Baselines](../design/TR-003-benchmark-baselines.md)
- [TR-004 — Truth: Design Doc Lifecycle](../design/TR-004-design-doc-lifecycle.md)
- [TR-006 — Truth: Docs Maintainer Checklist](../design/TR-006-docs-maintainer-checklist.md)
- [TR-007 — Truth: Security Doc Discoverability Audit](../design/TR-007-security-doc-discoverability-audit.md)
- [TR-009 — Truth: Pre-PR Doc Cross-Link Audit](../design/TR-009-pre-pr-doc-cross-link-audit.md)
- [TR-010 — Truth: Planning Index Consistency Review](../design/TR-010-planning-index-consistency-review.md)
- [TR-013 — Truth: Guide Accuracy Audit](../design/TR-013-guide-accuracy-audit.md)
- [TR-014 — Truth: Markdown Surface Rationalization](../design/TR-014-markdown-surface-rationalization.md)

Current Truth backlog items:

- [TR-005 — CasService Decomposition Plan](../BACKLOG/TR-005-casservice-decomposition-plan.md)
- [TR-008 — Empty-State Phrasing Consistency](../BACKLOG/TR-008-empty-state-phrasing-consistency.md)
- [TR-011 — Streaming Encrypted Restore](../BACKLOG/TR-011-streaming-encrypted-restore.md)
- [TR-012 — Examples Surface Audit](../BACKLOG/TR-012-examples-surface-audit.md)

Truth work under this legend is currently focused on:

- repairing stale architecture truth
- publishing security and threat guidance that matches shipped behavior
- defining planning-document lifecycle rules
- publishing benchmark guidance that matches shipped behavior
- evaluating service decomposition where the current boundary is under strain
- improving documentation review hygiene through a shared maintainer checklist
- improving security doc discoverability from high-traffic repo surfaces
- keeping the long-form guide accurate and positioned as a docs surface instead
  of a root-level front door
- making the tracked Markdown surface explicit so root, docs, archive, and
  local-only placement decisions stop living only in memory
- running a lightweight pre-PR doc cross-link audit on doc-heavy branches
- running planning-index consistency reviews and keeping empty-state language
  consistent over time
- investigating lower-memory restore paths for encrypted and compressed assets

## Explicit Non-Goals

- no documentation churn without a concrete truth gap to close
- no architecture refactor for purity alone
- no archival cleanup that destroys useful decision history
