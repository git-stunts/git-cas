# TR-012 — Truth: Examples Surface Audit

## Status

Landed

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

The `examples/` directory is part of the repo's teaching surface, not just a
miscellaneous folder of throwaway scripts.

That means it has the same truth burden as the rest of the docs:

- examples should use current public APIs
- examples should not teach stale internal access patterns
- the example index should say which files are still maintained and why

Before this cycle, the examples surface had drifted:

- `examples/README.md` still taught manual manifest decoding via service
  internals
- the README still described progress tracking as if `CasService` itself were
  the event surface
- `store-and-restore.js` still demonstrated the older internal manifest-read
  path instead of `readManifest()`

## Human Users, Jobs, And Hills

### Users

- maintainers
- adopters reading examples before the API reference
- contributors checking whether examples still represent current usage

### Jobs

- trust that examples still teach maintained public APIs
- tell which examples remain worth keeping
- avoid copying internal or stale patterns into new code

### Hill

A maintainer or adopter can run the examples and learn current `git-cas`
workflows without inheriting stale internal access patterns.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents

### Jobs

- reason about which examples are maintained and what they teach
- repair or cite examples without treating stale patterns as canonical
- distinguish between public facade helpers and internal service plumbing

### Hill

An agent can use the examples surface as a maintained teaching aid instead of a
historical code dump.

## Human Playback

- Does `examples/README.md` now state which example files are kept and why?
- Do the maintained examples use current public APIs instead of internal
  manifest-decoding patterns?
- Is the progress example described through `EventEmitterObserver` rather than
  a stale EventEmitter claim about `CasService`?

## Agent Playback

- Can an agent tell which example files are worth keeping?
- Do the repaired examples favor public package entrypoints and public helpers?
- Does the examples surface now align with the guide and API docs more closely?

## Explicit Non-Goals

- no attempt to add a large new example suite
- no conversion of examples into tested fixtures or integration tests in this
  cycle
- no removal of examples that are still accurate enough to teach current usage

## Decisions

### Keep The Current Example Set

The current set is still small and useful:

- `store-and-restore.js`
- `encrypted-workflow.js`
- `progress-tracking.js`

No file currently needs to be cut or moved.

### Refresh The Example Index

`examples/README.md` should explicitly record the recommendation for each file
and should stop teaching stale internals in its reference snippets.

### Prefer Public Helpers Over Internal Plumbing

Where the public facade already provides a helper, the examples should prefer
that helper. `readManifest()` is the right example for tree-to-manifest reads.

## Implementation Outline

1. Audit `examples/README.md` and the three example programs.
2. Refresh the README with per-file recommendations and current API guidance.
3. Repair `store-and-restore.js` to use `readManifest()`.
4. Add this cycle doc, archive the consumed backlog card, update the Truth
   indexes, and record the cycle in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new automated tests.

This cycle verifies the examples directly:

- run the example scripts under Node
- validate formatting and whitespace on touched files
- run the repo lint and test gates after code changes

## Risks And Unknowns

- examples can still drift later if they are not treated as a maintained docs
  surface
- the examples are Node-oriented and do not themselves prove Bun or Deno example
  ergonomics
- future API changes may create pressure to split examples by audience or
  runtime

## Retrospective

This was the right next cycle after rationalizing the Markdown surface.

The examples did not need expansion. They needed a truth pass so the repo stops
teaching stale internal patterns through supposedly friendly entrypoint code.
