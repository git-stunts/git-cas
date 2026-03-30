# Contributing to @git-stunts/git-cas

`git-cas` is not just a bag of Git tricks.

It is a deterministic artifact system built on Git's object database, with two
product surfaces over one shared core:

- a human CLI/TUI
- a machine-facing agent surface

If you contribute here, the job is not just to make code pass. The job is to
protect that product shape while making the system more capable.

## Core Product Philosophy

- Git is the substrate, not the product.
- Integrity is sacred.
- Restore must be deterministic.
- Provenance matters.
- Verification matters.
- GC-safe storage is non-negotiable.
- Human and agent surfaces are separate products over one domain core.
- The substrate may be sophisticated; the default UX must still feel boring,
  trustworthy, and legible.

The highest-level rule is simple:

If a change makes storage less trustworthy, restore less deterministic,
automation less explicit, or the normal operator flow more demanding, it is
probably the wrong change.

## Development Philosophy

This project prefers:

- DX over ceremony
- behavior over architecture theater
- explicit boundaries over clever coupling
- local-first, self-contained operation over service dependency
- boring human defaults over impressive internals
- machine contracts over scraped text

In practice, that means:

- keep commands small and obvious
- keep the default human UX boring and legible
- keep Git internals out of normal UX unless they are operationally necessary
- keep future automation concerns out of the human path until they are earned
- keep every human CLI command machine-readable through `--json`
- keep the `git cas agent` surface JSONL-first and non-interactive

## Architectural Principles

### Hexagonal Architecture

The product should keep clear boundaries between:

- domain behavior
- application/use-case orchestration
- ingress adapters such as the human CLI/TUI and the agent CLI
- infrastructure such as Git persistence, refs, codecs, crypto, and filesystem

Do not let UI concerns leak into persistence.
Do not let storage details leak into normal UX.
Do not let terminal behavior define the application boundary.

### SOLID, Pragmatically Applied

Use SOLID as boundary discipline, not as a pretext for abstraction sprawl.

Good:

- narrow modules
- explicit seams
- dependency inversion around important adapters
- shared application behavior consumed by multiple surfaces

Bad:

- abstraction for its own sake
- indirection before there is pressure for it
- architecture rituals that slow delivery without protecting behavior

## Planning And Delivery Model

This project now plans fresh work through:

- legends
- cycles
- backlog items
- invariants

The working source of truth is [WORKFLOW.md](./WORKFLOW.md).

That means:

- legends carry broad thematic efforts
- cycles are the implementation and design loop
- backlog items are cheap, single-file work candidates
- invariants are explicit project truths that work cannot violate

This project still uses IBM Design Thinking framing, but it is now applied at
the cycle level with both human and agent passes:

- human users, jobs, and hills
- agent users, jobs, and hills
- human playback
- agent playback
- explicit non-goals

Fresh work should be grounded in human or agent value, not backend vanity.

Before promoting a new direction, ask:

- which legend does this support?
- which cycle hill does this support?
- what human or agent behavior does this improve?
- what trust does this increase?
- what invariant does this depend on or risk violating?

If the answer is unclear, the work probably belongs in
[`docs/BACKLOG/`](./docs/BACKLOG/), not in an active cycle doc.

Before opening a doc-heavy pull request, run the short maintainer pass in
[docs/DOCS_CHECKLIST.md](./docs/DOCS_CHECKLIST.md).

If the branch touches planning surfaces, include the planning-index review in
that checklist pass.

## Directory Model

New planning work uses:

- [`docs/legends/`](./docs/legends/)
- [`docs/BACKLOG/`](./docs/BACKLOG/)
- [`docs/design/`](./docs/design/)
- [`docs/invariants/`](./docs/invariants/)
- [`test/cycles/`](./test/cycles/)

`ROADMAP.md` and `STATUS.md` remain useful sequence and snapshot documents, but
they are now migration surfaces for planning, not the primary place where fresh
cycle planning starts.

## Build Order

The expected order of work is:

1. Write or revise design docs first.
2. Encode behavior as executable tests second.
3. Implement third.

Tests are the spec.

Do not insert a second prose-spec layer between design and tests.
Do not treat implementation details as the primary unit of correctness.

## Cycle Development Loop

Each cycle should follow the same explicit loop:

1. design docs first
2. tests as spec second
3. implementation third
4. human and agent playbacks
5. retrospective after delivery
6. update `docs/BACKLOG/` with debt and follow-on work
7. update the root [CHANGELOG.md](./CHANGELOG.md)
8. rewrite the root README when reality changed materially

This loop is part of the process, not optional cleanup.

The point is to keep the repo honest about:

- what is planned
- what is specified
- what is actually implemented
- what was learned

## Release Discipline

Cycle closure and release discipline are coupled when a landed cycle materially
changes the product.

Rules:

- keep the root [CHANGELOG.md](./CHANGELOG.md)
- keep `package.json` and `jsr.json` versioned to reality, not aspiration
- when a release-worthy cycle or grouped set of cycles is closed, bump the
  in-flight version on the release commit
- create a Git tag on the commit that lands on `main` for that release
- follow [docs/RELEASE.md](./docs/RELEASE.md) instead of improvising release flow

The version and tag should reflect shipped reality, not hopeful scope.

## Testing Rules

Tests must be deterministic.

That means:

- no real network dependency
- no ambient home-directory state
- no ambient Git config assumptions
- no interactive shell expectations in the core suite
- no timing-based flakes
- no shared mutable repository state between tests

Every test that touches storage should use isolated temp state.

Prefer:

- throwaway local repos
- throwaway bare remotes when needed
- fixed env and fixed IDs where practical
- direct argv subprocess execution instead of shell-wrapped commands

Tests should pin:

- user-visible behavior
- integrity and restore correctness
- provenance and verification behavior
- immutability boundaries
- honest backup/storage semantics
- `--json` output contracts for the human CLI
- JSONL protocol contracts for the agent CLI as it lands

Tests should not overfit:

- class layout
- file-private helpers
- incidental implementation structure

Local testing policy:

- `npm test` is the default fast suite
- `npx eslint .` must stay clean
- integration tests run through Docker-backed runtime targets
- `pnpm release:verify` is the release truth source
- install hooks with `bash scripts/install-hooks.sh`

## Human Surface Guardrails

Do not introduce any of the following into the normal operator path unless
explicitly re-approved:

- hidden side effects
- smart guessing in place of explicit state
- TUI-only access to essential behavior
- substrate jargon when plain language will do
- prompts where flags or files should be accepted

The human path should feel trustworthy and boring, not magical.

## Agent Surface Guardrails

The `git cas agent` surface is the automation contract.

That implies:

- no TTY branching
- no implicit prompts
- stdout carries only protocol data
- stderr carries structured warnings and errors
- side effects must be explicit
- failure modes must be actionable without scraping prose
- binary payloads do not share protocol stdout

Do not let the agent surface become “human CLI plus `--json`.”

## UX Language Rules

Default human-facing language should prefer artifact and storage language over
Git internals.

Prefer:

- `stored`
- `verified`
- `restored`
- `encrypted`
- `vault`
- `backup pending` or `not yet backed up`, when such language is accurate

Avoid leading with:

- raw object-database trivia
- refs, trees, blobs, and OIDs unless the operator actually needs them

Every human CLI command must also support `--json`.

In `--json` mode:

- human-readable text should be suppressed
- stdout should carry only the structured result payload
- stderr should carry warnings and errors

For the agent CLI, the automation contract is JSONL-first and should stay
separate from the human `--json` surface.

## Git Workflow

Prefer small, honest commits.

Do not rewrite shared history casually.
Prefer additive commits over history surgery.
Prefer merges over rebases for shared collaboration unless there is a compelling,
explicitly discussed reason otherwise.

The point is not aesthetic Git history. The point is trustworthy collaboration.

## What To Read First

Before making non-trivial changes, read:

- [README.md](./README.md)
- [WORKFLOW.md](./WORKFLOW.md)
- [STATUS.md](./STATUS.md)
- [ROADMAP.md](./ROADMAP.md)
- [docs/legends/README.md](./docs/legends/README.md)
- [docs/invariants/README.md](./docs/invariants/README.md)
- [docs/BACKLOG/README.md](./docs/BACKLOG/README.md)
- [docs/design/README.md](./docs/design/README.md)
- [docs/design/0001-m18-relay-agent-cli.md](./docs/design/0001-m18-relay-agent-cli.md)
- [SECURITY.md](./SECURITY.md)
- [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md)
- [docs/API.md](./docs/API.md)
- [docs/RELEASE.md](./docs/RELEASE.md)
- [COMPLETED_TASKS.md](./COMPLETED_TASKS.md)
- [CODE-EVAL.md](./CODE-EVAL.md)

## Decision Rule

When in doubt:

- choose more trustworthy behavior
- choose clearer boundaries
- choose lower ceremony
- choose fewer hidden behaviors
- choose deterministic outputs
- choose main as the playback truth
- choose behavior over architecture theater
- protect the human path from unnecessary sophistication
- protect the agent path from ambiguity
