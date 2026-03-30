# 0001 — M18 Relay: Agent CLI Foundation

## Status

Landed

## Context

`git-cas` now has a real human surface and a missing machine surface.

What is already true:

- the human CLI/TUI can store, inspect, verify, restore, rotate, manage vault
  entries, and explore repository-backed CAS state
- `--json` exists on the human CLI, but it is convenience structured output, not
  a first-class automation contract
- `main` already contains early human-surface explorer work beyond the old docs

What is still missing:

- a machine-native entrypoint
- stable protocol semantics
- explicit non-interactive input handling
- exact exit-code behavior
- a clean app-layer boundary that the human surface can later reuse

The product gap is now protocol, not raw capability.

## Sponsor User

A maintainer or release engineer who wants to automate `git-cas` workflows
without scraping human terminal text.

## Sponsor Agent

A coding agent, CI job, release bot, or backup workflow that needs exact,
replayable outcomes and explicit side effects.

## Hills

- A sponsor agent can inspect, verify, and query `git-cas` state through a
  stable machine protocol without depending on TTY behavior or human-readable
  formatting.
- A sponsor user can trust automation built on `git-cas` because failures,
  warnings, and requested inputs are explicit and machine-actionable.

## Explicit Non-Goals

- No long-lived interactive session protocol.
- No attempt to redefine the human `--json` path as the automation contract.
- No Bijou rendering or TTY-aware formatting in the agent path.
- No binary restore payload over protocol `stdout`.
- No large human-surface feature push before the machine surface is credible.

## Decision

Introduce a dedicated `git cas agent` namespace with a JSONL-first contract.

The agent CLI will:

- use a dedicated machine runner rather than the current human `runAction()` path
- treat every invocation as a one-shot command
- accept explicit flags plus `--request -` and `--request @file.json`
- avoid implicit prompts entirely
- produce protocol rows instead of human terminal text
- separate human convenience output from machine contract design

## Protocol Principles

- Deterministic enough to be tested across Node, Bun, and Deno.
- Explicit about side effects.
- Explicit about missing inputs.
- Explicit about failure class.
- Replayable from captured rows.
- Safe to consume without parsing prose.

## Stream Contract

The agent CLI uses JSONL on both streams, with different responsibilities:

- `stdout`: lifecycle and ordinary command data
- `stderr`: structured warnings, `needs-input`, and structured errors

After the first protocol row is emitted, both streams are protocol-only.

Human-readable text is suppressed.

## Record Envelope

Every row is one JSON object with this envelope:

```json
{
  "protocol": "git-cas-agent/v1",
  "command": "inspect",
  "type": "result",
  "seq": 3,
  "ts": "2026-03-26T01:23:45.678Z",
  "data": {}
}
```

Required fields:

- `protocol`: string version identifier
- `command`: command name without the `git cas agent` prefix
- `type`: record type
- `seq`: monotonically increasing integer per invocation
- `ts`: RFC 3339 UTC timestamp
- `data`: record payload object

## Record Types

### `start`

Emitted on `stdout` once the command has validated argv and normalized its input.

Purpose:

- confirm the resolved command
- expose normalized request shape
- expose side-effect intent before work begins

### `progress`

Emitted on `stdout` zero or more times.

Purpose:

- communicate bounded work-state changes without forcing humans to scrape TUI
- carry stable progress semantics for long-running reads and writes

### `warning`

Emitted on `stderr` zero or more times.

Purpose:

- communicate non-fatal issues
- surface policy and safety signals without poisoning `stdout`

Examples:

- encryption-policy warnings
- ignored optional input
- degraded fallback behavior

### `needs-input`

Emitted on `stderr` when required input is missing or must be supplied through a
request object instead of an interactive prompt.

Purpose:

- replace prompting
- allow agents to branch cleanly

Examples:

- missing passphrase file
- missing encryption key source
- missing request payload for a required machine-only field

### `result`

Emitted on `stdout` one or more times with ordinary command data.

Purpose:

- carry the machine-usable result payload
- avoid trace noise in ordinary data rows

### `error`

Emitted on `stderr` for fatal failures.

Purpose:

- expose a stable machine-readable failure record
- preserve error code, message, and optional metadata

### `end`

Emitted on `stdout` exactly once for successful or protocol-complete invocations.

Purpose:

- mark normal protocol completion
- summarize exit status and row counts

## Exit Codes

Initial exit-code policy:

- `0`: success
- `1`: fatal execution failure
- `2`: required input missing, invalid request payload, or `needs-input`
- `3`: integrity or verification failure

This must be consistent across Node, Bun, and Deno.

## Request Handling

The agent CLI supports three input shapes:

1. normal explicit flags
2. `--request @file.json`
3. `--request -` for JSON request payload on stdin

Rules:

- request payloads augment flags; they do not silently reinterpret them
- conflicts between flags and request payload must fail explicitly
- secrets are passed by explicit source, never by prompt
- the normalized request shape should be visible in the `start` payload when it
  is safe to expose

## Command Rollout

### Foundation Wave

These commands come first because they are read-heavy and define the contract
shape without forcing the full write-path problem on day one:

- `agent inspect`
- `agent verify`
- `agent vault list`
- `agent vault info`
- `agent vault history`
- `agent doctor`
- `agent vault stats`

### Follow-through Wave

These commands follow once the protocol and request semantics are proven:

- `agent store`
- `agent tree`
- `agent restore`
- `agent rotate`
- `agent recipient add`
- `agent recipient remove`
- `agent recipient list`
- the relevant vault write flows

## Data Shape Principles

Command payloads should:

- expose real command data, not just trace metadata
- preserve domain terms where they are materially useful
- avoid TUI-specific or Bijou-specific concepts
- avoid requiring agents to infer state from absent fields

Examples:

- `inspect` should expose manifest/tree information
- `verify` should expose integrity result and chunk counts
- `vault list` should expose entry rows, not formatted tables
- `doctor` should expose issue rows, not prose reports

## Error Shape

Structured error payloads should include:

- `code`
- `message`
- `hint` when useful
- `meta` when stable and actionable
- `retryable` when the caller can safely branch on it

The agent CLI should reuse existing domain error codes where they are already
good enough instead of inventing parallel code vocabularies.

## Human Surface Consequence

The human CLI and TUI should eventually consume the same application-layer
operations and normalized result models that fall out of the agent CLI.

That does not mean the human surface becomes JSONL-first.
It means the agent CLI should force the shared boundary to become explicit.

The TUI should become a client of that boundary, not its substitute.

## Testing Plan

The protocol contract must be test-first.

Contract tests should pin:

- record order
- record shape
- stream purity
- exact exit codes
- missing-input behavior
- integrity-failure behavior
- non-interactive behavior across Node, Bun, and Deno

Tests should avoid:

- timing assertions
- TTY assumptions
- shell-wrapped subprocesses
- human-text snapshots as protocol truth

## Acceptance

M18 is complete when:

- the protocol is documented in-repo
- read-heavy `git cas agent` commands exist
- protocol contract tests pass on Node, Bun, and Deno
- `stdout` and `stderr` roles are explicit and stable
- missing-input flows are machine-actionable instead of interactive
- the agent surface is clearly no longer “human CLI plus `--json`”

## Open Questions

- Should `end` always emit on failure, or only on successful protocol completion?
- Which warnings deserve protocol rows versus result metadata?
- How much normalized request data is safe to echo in `start` when secrets are
  involved?
- Which state-changing flows belong in the first follow-through wave versus a
  later parity wave?

## Retrospective

The dedicated agent entrypoint was the right architectural cut.

It created a real machine-facing contract instead of stretching the human
`--json` path past its limits, and later review feedback validated that the
protocol boundary needed to own redaction, explicit input handling, and stable
error semantics from the beginning.
