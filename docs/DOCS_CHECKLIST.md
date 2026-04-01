# Docs Maintainer Checklist

Run this checklist before opening a doc-heavy pull request or closing a
documentation-focused cycle.

The goal is not exhaustive proofreading. The goal is to catch the recurring
truth and discoverability failures that keep surfacing late in review.

## Checklist

- Public versus internal boundary:
  If a doc describes an API, command, or service boundary, make sure it is
  clear what is public contract and what is internal implementation detail.
- Human versus agent surface:
  If the change touches CLI or protocol docs, make sure human `--json` behavior
  and agent JSONL behavior are not described as the same contract.
- Canonical source links:
  If the doc summarizes security, threat, benchmark, release, or workflow
  truth, link the canonical source instead of leaving the summary isolated.
- Cross-doc discoverability:
  Check that adjacent top-level docs can find each other where a maintainer or
  reviewer would reasonably expect a link.
- Planning index hygiene:
  If a backlog card, cycle doc, or legend state changed, update the affected
  indexes in the same change.
- Empty-state wording:
  If an index or legend now has an empty list, use the documented house style
  already present in the planning surface instead of inventing a new phrase.
- Canonical wording drift:
  If a summary doc repeats claims that are already maintained elsewhere, reduce
  it to a short summary plus a link instead of maintaining two full narratives.

## Pre-PR Doc Cross-Link Audit

Run this extra pass before opening a doc-heavy pull request when a branch
changes:

- [README.md](../README.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [WORKFLOW.md](../WORKFLOW.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/API.md](./API.md)
- [docs/THREAT_MODEL.md](./THREAT_MODEL.md)
- [docs/BENCHMARKS.md](./BENCHMARKS.md)
- planning indexes under [`docs/BACKLOG/`](./BACKLOG/README.md),
  [`docs/design/`](./design/README.md),
  [`docs/archive/BACKLOG/`](./archive/BACKLOG/README.md), and
  [`docs/legends/`](./legends/README.md)

This is not exhaustive link checking. It is a lightweight routing pass for the
docs people and agents are most likely to read first.

At minimum, confirm the following before review:

- front-door docs still route to the canonical adjacent docs a maintainer would
  expect from that surface
- summary docs link canonical truth instead of becoming a second narrative
- security-sensitive docs route to [SECURITY.md](../SECURITY.md) and
  [docs/THREAT_MODEL.md](./THREAT_MODEL.md) where those boundaries matter
- planning indexes and legends point to the current backlog, design, and
  archive surfaces they describe
- no touched doc loses an important discoverability link that existed before

## Planning Index Review

Run this extra pass whenever a branch changes:

- `docs/BACKLOG/README.md`
- `docs/design/README.md`
- `docs/archive/BACKLOG/README.md`
- a legend's current-cycle summary
- a backlog card's lifecycle state

Confirm all of the following before review:

- live backlog entries are still pending, in cycle, or carrying unresolved
  follow-on work
- landed cycle docs are represented in `docs/design/`
- archived backlog history reflects moved or retired backlog cards
- legend summaries agree with the current backlog and design surfaces
- empty-state wording does not introduce a new house style accidentally

## Use It On These Files

This checklist is most useful when a change touches files like:

- [README.md](../README.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [WORKFLOW.md](../WORKFLOW.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/API.md](./API.md)
- [docs/THREAT_MODEL.md](./THREAT_MODEL.md)
- [docs/BENCHMARKS.md](./BENCHMARKS.md)
- planning indexes under [`docs/BACKLOG/`](./BACKLOG/README.md),
  [`docs/design/`](./design/README.md),
  [`docs/archive/BACKLOG/`](./archive/BACKLOG/README.md), and
  [`docs/legends/`](./legends/README.md)

## Exit Criteria

Before a doc-heavy branch is ready for review:

- the changed docs point at the right canonical truth
- the pre-PR doc cross-link audit passed for the touched surfaces
- public and internal boundaries are not blurred
- planning indexes match the files they describe
- empty-state wording does not introduce a new style accidentally
