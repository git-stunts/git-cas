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

Backlog items under this legend are currently focused on:

- repairing stale architecture truth
- publishing security and benchmark guidance that matches shipped behavior
- defining planning-document lifecycle rules
- evaluating service decomposition where the current boundary is under strain

## Explicit Non-Goals

- no documentation churn without a concrete truth gap to close
- no architecture refactor for purity alone
- no archival cleanup that destroys useful decision history
