# git-cas METHOD

_A backlog, a loop, and honest bookkeeping._

This file is the canonical planning and delivery process for fresh work in
`git-cas`.

The core rule is:

> If it is actionable work, it must be a GitHub Issue. If it only appears in a
> Markdown file, it is not tracked work.

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
- GitHub Issues are the tracker. Milestones, labels, issue state, issue links,
  and pull requests own active work status.
- The filesystem is the design and evidence ledger. Markdown explains decisions,
  proof plans, witnesses, public docs, and historical context; it does not own
  open work state.
- Process should stay calm. No sprints, velocity theater, or burndown charts.

## Structure

Fresh work now uses:

```text
GitHub
  milestones/
  issues/
  labels/

docs/
  method/
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
- Legacy planning compatibility surfaces remain in `docs/BACKLOG/`,
  `docs/legends/`, and `docs/archive/`, but they are not active tracking
  surfaces.

## Roadmap And Goalposts

[ROADMAP.md](../../ROADMAP.md) lists the intended release train and points to
GitHub Milestones. A release milestone is made of GitHub Issues:

- `type:goalpost` issues own release-scale features, invariants, or evidence
  packets.
- `type:slice` issues or sub-issues own turn-sized proof work.
- Pull requests should normally carry one goalpost issue or one coherent slice
  under a goalpost.

Goalposts and slices are tracked in GitHub, not in repo-local Markdown.

Use [docs/templates/design-doc.md](../templates/design-doc.md) for new cycle
designs. Use the GitHub issue forms under `.github/ISSUE_TEMPLATE/` for
goalposts, slices, bugs, debt, and ideas.

## GitHub Tracker

GitHub owns:

- release membership through milestones
- work identity through issues
- priority and routing through labels
- status through issue state and labels
- parent/child relationships through sub-issues, linked issues, or task lists
- pull request linkage through closing keywords and issue references

Recommended label families:

- `type:goalpost`, `type:slice`, `type:bug`, `type:debt`, `type:idea`,
  `type:design`, `type:release`
- `area:storage`, `area:vault`, `area:tui`, `area:agent`, `area:docs`,
  `area:security`, `area:runtime`
- `status:blocked`, `status:needs-design`, `status:ready`,
  `status:in-progress`, `status:review`, `status:carried-forward`

## Retired Repo Backlog

The former repo-local backlog is retired. Historical cards may remain under
`docs/archive/`, but active work must be promoted to GitHub Issues before it is
considered tracked.

Do not add new work cards under `docs/method/backlog/`. Use GitHub Issues.

## Promoting Work To Design

Pulling a GitHub Issue into a design cycle means:

1. confirm the issue is in the correct milestone and has the right type labels
2. create the next numbered cycle directory under `docs/design/`
3. write the cycle doc inside that directory
4. link the design doc from the issue
5. keep issue status in GitHub, not in Markdown

- `docs/design/0020-method-adoption/`
- `docs/design/0021-something-else/`

### Empty-State Style

For planning surfaces and legend summaries, the house empty-state phrasing is:

- `none currently`

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

0. Select or open the canonical GitHub Issue and own it.
1. Write or revise the design doc in `docs/design/<cycle>/`.
2. Write failing tests. Default to the agent surface first unless the design
   explicitly says otherwise.
3. Make the tests pass.
4. Produce witness material in `docs/design/<cycle>/witness/` that answers the
   playback questions for both the human and agent views.
5. Open the PR and iterate until merge.
6. After merge, write the retro in `docs/method/retro/<cycle>/<task>.md`,
   perform the drift check, and open GitHub follow-up issues for new debt or
   ideas.

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
