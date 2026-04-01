# TR-009 — Truth: Pre-PR Doc Cross-Link Audit

## Status

Landed

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

Recent Truth cycles kept landing real documentation improvements, but review was
still catching a cheap class of issue late: missing discoverability links
between top-level docs, canonical truth docs, and planning indexes.

The repo already had the right documentation surfaces.

The missing piece was a lightweight pre-PR routing pass that contributors and
agents can run before review instead of relying on comment-driven cleanup after
the PR is already open.

## Human Users, Jobs, And Hills

### Users

- maintainers opening doc-heavy pull requests
- reviewers checking doc truth and navigation
- contributors editing high-traffic docs

### Jobs

- catch missing cross-links before reviewers do
- keep top-level docs routing to the right canonical docs
- avoid turning small doc cycles into reactive review churn

### Hill

A maintainer can run one lightweight pre-PR pass and know that touched
high-traffic docs still route readers to the canonical adjacent docs they need.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- documentation agents
- review agents

### Jobs

- follow an explicit routing check before opening a doc-heavy PR
- verify discoverability without inventing a second planning layer
- cite the same checklist and workflow truth a human maintainer would use

### Hill

An agent can run the same lightweight routing audit as a human maintainer
before review and reduce reactive doc-link fixes in PR feedback.

## Human Playback

- Can a maintainer tell when the cross-link audit should run?
- Is the audit lightweight enough to use routinely before opening a PR?
- Does it focus on canonical routing instead of turning into exhaustive link
  policing?

## Agent Playback

- Can an agent identify the touched doc surfaces that trigger the audit?
- Can it follow the checklist without guessing which canonical docs should be
  adjacent?
- Does the workflow point to the checklist instead of duplicating a second
  process?

## Explicit Non-Goals

- no exhaustive Markdown link checker
- no second planning layer outside the existing checklist and workflow
- no broad rewrite of product docs that are already routing correctly

## Decisions

### Keep The Audit Inside The Existing Checklist

The right place for this audit is [docs/DOCS_CHECKLIST.md](../DOCS_CHECKLIST.md),
not a separate standalone process document.

That keeps the workflow small and discoverable.

### Audit High-Traffic And Canonical Surfaces Explicitly

The audit should run when a branch changes top-level or canonical docs such as
README, CONTRIBUTING, WORKFLOW, ARCHITECTURE, SECURITY, API, THREAT_MODEL,
BENCHMARKS, and planning indexes.

That makes the trigger concrete without pretending every markdown file needs the
same treatment.

### Focus On Routing, Not Exhaustive Link Checking

This cycle is about discoverability between canonical docs, not about turning
maintainers into broken-link crawlers.

The pass should confirm that touched docs still point to the canonical adjacent
docs a maintainer or agent would reasonably expect from that surface.

## Implementation Outline

1. Add this cycle doc.
2. Extend [docs/DOCS_CHECKLIST.md](../DOCS_CHECKLIST.md) with a named pre-PR
   doc cross-link audit and minimum routing checks.
3. Wire that audit into [WORKFLOW.md](../../WORKFLOW.md) and
   [CONTRIBUTING.md](../../CONTRIBUTING.md) so contributors know when to run it.
4. Archive the consumed backlog card, update Truth indexes, and record the
   change in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new executable tests.

This is a documentation and workflow cycle. Verification is:

- direct review of the checklist and workflow wording
- formatting validation for touched Markdown files
- whitespace and diff validation

## Risks And Unknowns

- the audit can drift back into vague wording if later edits remove the
  concrete trigger list
- too much duplication between checklist and workflow would make the process
  heavier than intended
- contributors may still skip the pass if doc review discipline slips

## Retrospective

This was the right follow-through after the checklist, security-discoverability,
and planning-index cycles.

The repo did not need another large docs framework. It needed one clearer,
lighter pre-PR routing pass in the doctrine people and agents already use.
