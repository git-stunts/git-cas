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
  - live backlog items only
- `docs/design/`
  - active and landed cycle design docs
- `docs/archive/BACKLOG/`
  - delivered or retired backlog history
- `docs/archive/design/`
  - superseded or retired cycle docs
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

Once a cycle lands:

1. keep the landed cycle doc in `docs/design/`
2. remove the consumed card from the live backlog
3. if the cheap planning history is still useful, move that backlog card into
   `docs/archive/BACKLOG/`

Cycle-closing pull requests should update statuses and indexes to the intended
post-merge state in the same change, so the merge result on `main` is already
honest without a cleanup follow-up.

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

## Document Lifecycle

### Backlog Lifecycle

`docs/BACKLOG/` is the live backlog.

It should contain only items that are:

- queued
- in cycle
- still carrying unresolved follow-on work

Delivered backlog items should not remain in the live backlog by default.
Archive them under `docs/archive/BACKLOG/` if their historical intent remains
useful.

When a branch is landing the work represented by a backlog card, it is correct
to remove that card from the live backlog in the same PR so the merge result is
truthful.

### Design Doc Lifecycle

`docs/design/` holds the current design surface.

Cycle docs there should use explicit statuses:

- `Proposed`
- `Active`
- `Landed`
- `Superseded`
- `Archived`

Landed cycle docs remain in `docs/design/`.

Only superseded, abandoned, or retired cycle docs should move to
`docs/archive/design/`.

When a branch is closing a cycle, it may update that cycle doc to `Landed`
before merge so the merged result on `main` reflects the delivered state
immediately. `main` remains the playback truth for already-merged work.

### Index Hygiene

Readme indexes in `docs/BACKLOG/`, `docs/design/`, and `docs/legends/` are part
of the workflow, not optional cleanup.

If a file moves lifecycle state, update the relevant indexes in the same change.

### Planning Index Consistency Review

Run a planning-index consistency review whenever a branch:

- changes backlog, design, archive, or legend indexes
- moves a backlog card between live and archived state
- closes a cycle and prepares the merged post-merge truth state
- discovers drift on `main`

This does not need a fixed calendar cadence. Run it when planning surfaces
change and as a Truth maintenance pass when drift is found.

The minimum review must confirm:

- the live backlog only lists pending, in-cycle, or unresolved follow-on work
- landed cycle docs are represented in `docs/design/`
- archived backlog history matches delivered or retired cards
- legend summaries agree with the current backlog and design surfaces
- empty-state wording stays consistent with the existing house style, such as
  `- none currently` in [docs/design/README.md](./docs/design/README.md),
  instead of inventing a new empty-list phrase for the same condition

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
- Doc-heavy branches should run [docs/DOCS_CHECKLIST.md](./docs/DOCS_CHECKLIST.md)
  before review.
- When a doc makes security or threat claims, link [SECURITY.md](./SECURITY.md)
  and [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md) instead of creating a
  second canonical narrative.
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
