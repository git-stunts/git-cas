# TR-003 — Truth: Benchmark Baselines

## Status

Landed

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

`git-cas` already had a benchmark harness, but it did not yet publish stable
benchmark guidance that maintainers, operators, or agents could cite.

That left a recurring gap:

- the repo could measure chunking tradeoffs
- the repo could not point readers to a maintained baseline
- default and tuning guidance therefore risked slipping into guesswork

This cycle closes that gap by publishing the first benchmark baseline instead of
expanding the benchmark surface.

## Human Users, Jobs, And Hills

### Users

- maintainers
- operators evaluating storage tradeoffs
- adopters deciding between fixed chunking and CDC

### Jobs

- understand the current chunking cost/benefit tradeoff
- compare fixed chunking and CDC with real observed numbers
- rerun and refresh the benchmark doc intentionally later

### Hill

A maintainer or operator can read [ADVANCED_GUIDE.md](../../ADVANCED_GUIDE.md) and
come away with an honest current baseline for chunking throughput and edit-shift
dedupe behavior.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents

### Jobs

- cite current benchmark tradeoffs without inventing missing numbers
- recommend chunking strategies from published repo truth
- plan performance follow-up work from explicit observed behavior

### Hill

An agent can reference [ADVANCED_GUIDE.md](../../ADVANCED_GUIDE.md) as the canonical
published chunking baseline instead of extrapolating from raw benchmark source
files alone.

## Human Playback

- Does the published doc explain both throughput cost and dedupe benefit?
- Does it say what machine and runtime produced the numbers?
- Does it avoid pretending local measurements are universal truth?

## Agent Playback

- Can an agent tell which benchmark results are published versus merely possible
  to derive from the harness?
- Can it distinguish fixed-chunk speed from CDC edit-shift reuse benefits?
- Can it tell how to refresh the baseline later without inventing a new method?

## Explicit Non-Goals

- no code changes to the chunkers in this cycle
- no attempt to publish every existing benchmark in one pass
- no claim that these local measurements are portable across all environments

## Decisions

### Publish Chunking Guidance First

The first maintained benchmark baseline should cover the highest-value tradeoff:
fixed-size chunking versus CDC.

That is the benchmark question most likely to affect defaults, tuning, and
adoption guidance.

### Reuse The Existing Harness

This cycle should publish results from the committed benchmark harness in
[`test/benchmark/chunking.bench.js`](../../test/benchmark/chunking.bench.js),
not create a second ad hoc benchmark path.

### Keep The Baseline Local And Dated

The right claim is "these are observed local baseline numbers on a documented
machine and runtime," not "these are universal performance truths."

## Implementation Outline

1. Audit the current chunking benchmark harness and capture its actual input
   sizes and chunker settings.
2. Run the harness and record the observed throughput and dedupe output.
3. Add [ADVANCED_GUIDE.md](../../ADVANCED_GUIDE.md) with methodology, environment,
   results, interpretation, and rerun instructions.
4. Add this cycle doc, archive the consumed backlog card, update the Truth
   indexes, and record the change in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new executable tests.

This is a documentation-truth cycle. Verification is:

- rerunning the committed benchmark harness
- direct cross-check against benchmark input sizes and chunker options in
  `test/benchmark/chunking.bench.js`
- formatting validation for the touched Markdown files

## Risks And Unknowns

- local benchmark results can drift as the machine, Node version, or Vitest
  behavior changes
- readers can overread a local baseline as a universal recommendation if the doc
  stops being explicit about scope
- the repo still does not publish end-to-end store/restore or cross-runtime
  benchmark baselines

## Retrospective

This was the right next Truth cycle after the architecture and threat-model
work.

The repo already knew how to measure chunking tradeoffs. The missing piece was a
published, refreshable statement of what those measurements currently say.
