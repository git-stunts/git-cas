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

Active Truth cycle docs:

- [TR-001 — Truth: Architecture Reality Gap](../design/TR-001-architecture-reality-gap.md)
- [TR-002 — Truth: Threat Model](../design/TR-002-threat-model.md)
- [TR-004 — Truth: Design Doc Lifecycle](../design/TR-004-design-doc-lifecycle.md)

Current Truth backlog items:

- [TR-001 — Architecture Reality Gap](../BACKLOG/TR-001-architecture-reality-gap.md)
- [TR-002 — Threat Model](../BACKLOG/TR-002-threat-model.md)
- [TR-003 — Benchmark Baselines](../BACKLOG/TR-003-benchmark-baselines.md)
- [TR-004 — Design Doc Lifecycle](../BACKLOG/TR-004-design-doc-lifecycle.md)
- [TR-005 — CasService Decomposition Plan](../BACKLOG/TR-005-casservice-decomposition-plan.md)

Truth work under this legend is currently focused on:

- repairing stale architecture truth
- publishing security and threat guidance that matches shipped behavior
- defining planning-document lifecycle rules
- publishing benchmark guidance that matches shipped behavior
- evaluating service decomposition where the current boundary is under strain

## Explicit Non-Goals

- no documentation churn without a concrete truth gap to close
- no architecture refactor for purity alone
- no archival cleanup that destroys useful decision history
