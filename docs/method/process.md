# git-cas METHOD

_A backlog, a loop, and honest bookkeeping._

This file is the canonical planning and delivery process for fresh work in
`git-cas`.

## Principles

- The human and the agent sit at the same table. Both are named in every
  design. Both must agree before work ships.
- Default to building the agent surface first. If the work is human-first
  exploratory design, say so explicitly in the design doc.
- Everything traces to a playback question. If a cycle cannot say which
  question it answers, the cycle is drifting.
- Tests are the executable spec. Design names the hill and the playback
  questions. Tests prove the answers.
- Truth should lower honestly. If meaning disappears without color, layout,
  motion, or shared context, the design is unfinished.
- Accessibility is a product concern. Every design names the linear reading
  model and any reduced-complexity experience.
- Localization is an early design constraint. Prefer logical start/end language
  over hardcoded left/right assumptions.
- Agent surfaces must be explicit and inspectable. Design must say what is
  agent-generated, what evidence it relies on, and what action it expects next.
- The filesystem is the database. A directory is a priority. A filename is an
  identity. Moving a file is a decision.
- Process should stay calm. No sprints, velocity theater, or burndown charts.

## Structure

Fresh planning now uses:

```text
docs/
  method/
    backlog/
      inbox/
      asap/
      up-next/
      cool-ideas/
      bad-code/
    legends/
    retro/<cycle>/<task>.md
    graveyard/
    process.md
    release.md
  design/
    <cycle>/<task>.md
    *.md
```

Repo-specific notes:

- `docs/design/<cycle>/witness/` holds playback evidence for the cycle.
- Top-level legacy cycle docs already in `docs/design/` remain in place for
  history and link stability.
- Legacy planning compatibility surfaces remain in `docs/BACKLOG/` and
  `docs/legends/`, but they are no longer the source of truth for fresh work.

## Backlog

Backlog items are Markdown files. The directory lane is the priority.

### Lanes

- `inbox/` — raw capture, anyone anytime
- `asap/` — pull this soon
- `up-next/` — likely after the current pull
- `cool-ideas/` — interesting, not committed
- `bad-code/` — working debt that bothers us

Anything outside those lanes but still under `docs/method/backlog/` is an
exception surface and should be rare.

### Naming

Use a legend prefix when the work belongs to a named domain. Do not use numeric
IDs in backlog filenames.

Examples:

- `TR_streaming-encrypted-restore.md`
- `RL_agent-session-protocol.md`
- `debt-tui-layout-coupling.md`

### Promoting

Pulling a backlog item into a cycle means:

1. remove the backlog file from its lane
2. create the next numbered cycle directory under `docs/design/`
3. write the cycle doc inside that directory

`git-cas` cycle directories now use four-digit sequential prefixes:

- `docs/design/0020-method-adoption/`
- `docs/design/0021-something-else/`

The promoted backlog file does not go back. Follow-on work re-enters the
backlog as a new file if the cycle pivots or ends partial.

## Legends

Legends are reference frames, not work queues.

Each legend should say:

- what it covers
- who cares
- what success looks like
- how we know

Legend docs for fresh work live in `docs/method/legends/`.

## Cycles

A cycle is a unit of shipped work. For `git-cas`, every cycle should cover:

- sponsor human
- sponsor agent
- hill
- playback questions for both perspectives
- accessibility or assistive-reading posture
- localization or directionality posture
- agent inspectability or explainability posture
- non-goals

If a posture is not relevant, say so explicitly.

### The Loop

0. Pull the work from the backlog and own it.
1. Write the design doc in `docs/design/<cycle>/`.
2. Write failing tests. Default to the agent surface first unless the design
   explicitly says otherwise.
3. Make the tests pass.
4. Produce witness material in `docs/design/<cycle>/witness/` that answers the
   playback questions for both the human and agent views.
5. Open the PR and iterate until merge.
6. After merge, write the retro in `docs/method/retro/<cycle>/<task>.md`,
   perform the drift check, and feed new debt or ideas back into the backlog.

## Playback And Witness

Witness material must be concrete. Good witness includes:

- test output
- command transcripts
- screenshots
- recorded JSON or JSONL output
- short written answers tied directly to the playback questions

No clear yes means no.

## Release Discipline

Not every cycle is a release, but every cycle updates:

- [CHANGELOG.md](../../CHANGELOG.md)
- [README.md](../../README.md) when behavior or the front door changed

Release procedure lives in [release.md](./release.md).

## Legacy Surfaces

The following are compatibility or historical surfaces now:

- [docs/BACKLOG/README.md](../BACKLOG/README.md)
- [docs/legends/README.md](../legends/README.md)
- top-level legacy cycle docs in [docs/design/README.md](../design/README.md)

Keep them readable. Do not let them outrank the METHOD surfaces.
