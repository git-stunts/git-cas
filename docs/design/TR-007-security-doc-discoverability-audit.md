# TR-007 — Truth: Security Doc Discoverability Audit

## Status

Landed

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

`git-cas` already has canonical security and threat-model docs:

- [SECURITY.md](../../SECURITY.md)
- [docs/THREAT_MODEL.md](../THREAT_MODEL.md)

The remaining problem is discoverability.

High-traffic docs still did not point readers to those canonical sources
consistently, which made the right guidance easy to miss even when it already
existed.

## Human Users, Jobs, And Hills

### Users

- maintainers
- contributors reading the repo front door and contributor guidance
- operators evaluating security and metadata tradeoffs

### Jobs

- find the right security and threat guidance from the docs they already read
- distinguish cryptographic design from threat boundary and non-goals
- navigate to canonical guidance without hunting through the repo

### Hill

A maintainer or operator can reach the canonical security and threat-model docs
from the main architecture, API, README, and contributor surfaces without
guesswork.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents

### Jobs

- navigate directly to canonical security truth
- avoid citing partial or secondary summaries when reviewing or planning
- tell where crypto design guidance ends and threat-model guidance begins

### Hill

An agent can find the canonical security and threat-model docs from the repo's
high-traffic docs instead of inferring around missing links.

## Human Playback

- Can a reader reach the security and threat-model docs from the front door?
- Do the affected docs distinguish cryptographic design from threat boundary?
- Did this cycle improve navigation without creating duplicate narratives?

## Agent Playback

- Can an agent find [SECURITY.md](../../SECURITY.md) and
  [docs/THREAT_MODEL.md](../THREAT_MODEL.md) from the docs most likely to be
  read first?
- Can it tell which document to cite for crypto design versus trust boundaries?
- Do the new links reduce ambiguity rather than multiply summaries?

## Explicit Non-Goals

- no rewrite of the security or threat-model documents themselves
- no attempt to link every markdown file in the repo to security docs
- no duplicate security narrative where a targeted link is enough

## Decisions

### Link Canonical Security Docs From High-Traffic Surfaces

This cycle should focus on the docs people and agents are most likely to read
first:

- [README.md](../../README.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
- [WORKFLOW.md](../../WORKFLOW.md), only where security guidance is materially
  relevant
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [docs/API.md](../API.md)

### Distinguish Security Design From Threat Boundary

The links should not collapse `SECURITY.md` and `docs/THREAT_MODEL.md` into one
concept. They answer different questions and should stay easy to distinguish.

### Keep The Change Surgical

This is a discoverability cycle, not a new security-writing cycle. Add links and
short routing language where it materially improves navigation, and stop there.

## Implementation Outline

1. Add this cycle doc.
2. Audit the high-traffic docs for missing or misleading security/threat-model
   links.
3. Add or repair the canonical links where they materially improve navigation.
4. Archive the consumed backlog card, update the Truth indexes, and record the
   change in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new executable tests.

This is a documentation-truth cycle. Verification is:

- direct cross-check of the affected top-level docs and their new links
- formatting validation for touched Markdown files
- whitespace and diff validation

## Risks And Unknowns

- too many links can turn into clutter if this pattern is overused later
- some relevant docs may still remain outside this bounded first-pass audit
- contributor reading habits may still favor README-only navigation

## Retrospective

This was the right next Truth cycle after the workflow and checklist work.

The repo already had the security truth. The missing piece was getting readers
to it reliably from the docs they actually open first.
