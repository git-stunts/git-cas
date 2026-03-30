# TR-001 — Truth: Architecture Reality Gap

## Status

Active

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

[ARCHITECTURE.md](../../ARCHITECTURE.md) had drifted far enough from the shipped
system that it was teaching the wrong model:

- it still described manifests as flat-only
- it did not reflect the extracted `VaultService`
- it did not reflect the extracted `KeyResolver`
- it did not reflect the chunking, observability, and runtime-adapter seams that
  now exist in the code

That kind of drift is worse than no architecture map at all.

This cycle repairs the map without pretending the codebase is more decomposed
than it really is.

## Human Users, Jobs, And Hills

### Users

- maintainers
- contributors
- operators reading the repo before adoption or modification

### Jobs

- understand the current system shape quickly
- distinguish stable seams from implementation pressure points
- trust that the architecture docs describe shipped behavior

### Hill

A maintainer can read [ARCHITECTURE.md](../../ARCHITECTURE.md) and come away
with a correct current model of storage, layering, and system responsibilities
without having to reverse-engineer the code.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents

### Jobs

- reason from the docs without inheriting stale claims
- identify the current architecture boundaries before proposing changes
- separate current truth from future refactor intent

### Hill

An agent can use [ARCHITECTURE.md](../../ARCHITECTURE.md) as a reliable
high-level map of the shipped system instead of a historical artifact.

## Human Playback

- Does the doc explain what gets stored in Git and how those objects stay
  reachable?
- Does it explain the roles of `CasService`, `VaultService`, and the facade
  without pretending they are something they are not?
- Does it point readers toward the more detailed docs for API and security
  questions?

## Agent Playback

- Can an agent infer the current seams between domain, ports, infrastructure,
  and CLI surfaces without reading the entire repo first?
- Can it tell that Merkle manifests are already shipped behavior rather than a
  future plan?
- Can it identify the current central orchestration pressure in `CasService`
  without mistaking that for a landed decomposition?

## Explicit Non-Goals

- no code refactor in this cycle
- no attempt to turn the architecture doc into a full API reference
- no invented decomposition that the codebase does not yet implement

## Decisions

### Keep A Single Architecture Map

The repo still benefits from one durable architecture document.

The right fix is to repair [ARCHITECTURE.md](../../ARCHITECTURE.md), not delete
it and scatter the map across unrelated docs.

### Describe The Shipped Storage Model Explicitly

The repaired doc must describe the current storage truth:

- chunk blobs are stored in Git
- manifests are authoritative for ordered chunk reconstruction
- large assets already use Merkle-style sub-manifests
- Git trees keep manifests and chunks reachable
- the vault is a ref-backed slug-to-tree index with metadata

### Be Honest About Boundary Pressure

The doc should state that `CasService` remains the central content orchestration
unit even after extractions like `KeyResolver` and `VaultService`.

That is current truth, not a flaw to paper over.

## Implementation Outline

1. Audit the old architecture doc against the current facade and domain code.
2. Rewrite [ARCHITECTURE.md](../../ARCHITECTURE.md) as a current high-level map
   of system surfaces, layers, flows, and storage structures.
3. Add this cycle doc to the design index and surface it from the Truth legend.
4. Record the truth-repair change in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new executable tests.

This is a documentation-truth cycle. Verification is:

- direct cross-check against `index.js`
- direct cross-check against `CasService.js`, `VaultService.js`, and
  `KeyResolver.js`
- formatting validation for the touched Markdown files

## Risks And Unknowns

- the doc can still become stale later if follow-on refactors do not update it
- a high-level map can drift toward API reference if it becomes too detailed
- `CasService` remains a pressure point, so the doc needs to stay honest without
  overcommitting to a future split

## Retrospective

This cycle was worth doing first.

The old doc was short, but its brevity hid real inaccuracies. Rewriting it as a
current map repaired the biggest truth gap without forcing a premature
architectural refactor.
