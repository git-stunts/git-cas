# Git-CAS Workflow

_The planning and delivery model for `git-cas`_

## Planning Model

`git-cas` now plans new work through:

- **Legends**
  - broad thematic efforts such as Relay, Nouveau, Sentinel, or Atelier
- **Cycles**
  - short design and implementation loops focused on one deliverable
- **Backlog items**
  - single-file work items that can be rough, partial, or speculative
- **Invariants**
  - project-wide truths that design and implementation are not allowed to
    violate

This is a forward-looking workflow change.

Older milestone language can remain in historical docs where useful for release
history, but new planning should start from legends, cycles, backlog items, and
invariants instead.

## Directory Model

- `docs/legends/`
  - one document per legend
- `docs/BACKLOG/`
  - one file per backlog item
- `docs/design/`
  - active and landed cycle design docs
- `docs/invariants/`
  - explicit project-wide invariants
- `test/cycles/<cycle>/`
  - cycle-owned playback, regression, and spec tests

This repo uses `test/`, not `tests/`, so cycle-owned tests live under
`test/cycles/`.

## Naming Conventions

### Backlog Items

Backlog items are named:

`<Legend code>-<numerical identifier>-<name>.md`

Example:

`RL-001-recipient-lifecycle.md`

### Cycle Docs

Cycle docs use the same code and live in `docs/design/`.

When a cycle begins:

1. pick a backlog item
2. move or copy that file into `docs/design/`
3. enrich it with the information required to implement the cycle

### Cycle Tests

Cycle-owned tests live under:

`test/cycles/<cycle>/`

Package-local unit and integration tests can still live in the normal test
locations when that is the better fit.

## Required Design Sections

Every active cycle design doc should include:

- linked legend
- human users, jobs, and hills
- agent users, jobs, and hills
- human playback
- agent playback
- linked invariants
- implementation outline
- tests to write first
- risks and unknowns
- retrospective

Design here follows IBM Design Thinking twice:

- once for humans
- once for agents

Agents are first-class users of `git-cas`, not a derived audience.

## Cycle Workflow

1. Design docs first, using the human and agent IBM Design Thinking passes.
2. Tests are the spec. Write failing tests first.
3. Green the tests.
4. Run human and agent playbacks.
5. Write a retrospective and assess drift.
6. Update `docs/BACKLOG/` with debt, follow-on work, and new questions.
7. Update [CHANGELOG.md](./CHANGELOG.md).
8. Iterate through review until accepted.
9. Merge and sync.
10. Bump version or cut a release if needed.
11. Triage the backlog and pick the next cycle.

## Process Rules

- No new milestone planning for fresh work.
- No new roadmap-first planning artifacts for fresh work.
- Legends deserve their own docs and should be linked when referenced.
- Important project-wide invariants must be documented explicitly and linked
  when referenced.
- `main` is the playback truth when docs and branches drift.
- Human CLI/TUI and agent CLI are separate surfaces over one shared core.
- The human `--json` surface and the agent JSONL surface are not the same
  contract.

## Relationship To Existing Docs

Some older documents still reflect the previous planning model:

- [ROADMAP.md](./ROADMAP.md)
- [STATUS.md](./STATUS.md)
- legacy numeric cycle docs in `docs/design/`

Those remain migration surfaces and historical context, not the source of truth
for new planning work.

The source of truth for new planning is:

- this file
- `docs/legends/`
- `docs/BACKLOG/`
- `docs/design/`
- `docs/invariants/`
