# 0002 — M18 Relay: Write Flows and Input Semantics

## Status

Landed

## Context

`0001` established the Relay foundation for read-heavy commands and the JSONL
record envelope.

The next gap is not protocol shape. It is write behavior:

- `store` must report side effects explicitly
- `restore` must write files without polluting protocol `stdout`
- encrypted flows must never fall back to prompting
- missing credentials must be distinguishable from generic failures

This is the boundary-forcing step for the agent surface.

## Sponsor User

A maintainer who wants to automate storage and restore workflows without human
escape hatches in the normal success path.

## Sponsor Agent

An agent or CI workflow that must perform state-changing `git-cas` operations
with exact inputs, explicit side effects, and deterministic recovery branches.

## Hills

- A sponsor agent can `store` and `restore` through Relay without scraping
  human text, and can reason about what changed from protocol output alone.
- A sponsor user can trust encrypted automation because missing credentials are
  surfaced as `needs-input`, not hidden prompts or ambiguous failures.

## Explicit Non-Goals

- No long-lived interactive session.
- No binary payload on protocol `stdout`.
- No implicit prompting for passphrases or key material.
- No attempt to redesign the human `store` and `restore` UX in this slice.
- No full write-surface parity beyond `store` and `restore` yet.

## Decisions

### `agent store`

Initial Relay write support for `store` will mirror the human CLI shape closely
enough to preserve product behavior:

- input file may be supplied positionally or via request payload
- `slug` remains required
- `--tree` creates a CAS tree and updates the vault
- `--force` is valid only with `--tree`
- plaintext store is valid when no encryption source is supplied
- vault-level encryption may be supplied by:
  - `--key-file <path>`
  - `--vault-passphrase <pass>`
  - `--vault-passphrase-file <path|->`

`result` for a successful `store` must expose:

- `slug`
- `manifest`
- `treeOid` when created
- `commitOid` when the vault changed
- `addedToVault`
- `chunkCount`
- `encrypted`
- `compressed`

### `agent restore`

Relay restore remains file-output only. It never emits restored bytes to
protocol `stdout`.

Required input:

- `--out <path>`
- exactly one of `--slug` or `--oid`

Credential sources:

- `--key-file <path>`
- `--vault-passphrase <pass>`
- `--vault-passphrase-file <path|->`

`result` for a successful `restore` must expose:

- `slug`
- `treeOid`
- `outputPath`
- `bytesWritten`
- `encrypted`

## `needs-input` Semantics

Relay uses `needs-input` when the command is otherwise valid but cannot proceed
because required credentials are missing.

Initial cases in scope:

- encrypted restore with no key source
- restore branches where the command can identify the accepted credential
  sources before attempting work

`needs-input` data should include:

- `code`
- `message`
- `requiredInputs`
- command-specific context that helps an agent retry correctly

This is not a generic validation bucket. Bad flags, conflicting sources, or
impossible stdin combinations remain ordinary `error` / invalid-input failures.

## Request Handling

Write flows continue to accept:

1. explicit flags
2. `--request @file.json`
3. `--request -`

Rules:

- flags override request-object fields
- request objects may provide ordinary command fields like `file`, `slug`, and
  `out`
- secrets may be passed explicitly, but Relay must not silently consume the same
  stdin stream for both the request object and a passphrase file
- `--request -` combined with `--vault-passphrase-file -` is invalid

## Protocol Consequences

- `stdout` stays protocol-only for both commands
- `stderr` carries `needs-input` or fatal `error` rows when applicable
- `end` still closes the invocation on both success and failure
- side effects are communicated through structured `result` payloads rather than
  human summaries

## Testing Plan

Contract coverage for this slice must pin:

- successful plaintext `agent store`
- successful plaintext `agent restore`
- successful encrypted `agent store`
- successful encrypted `agent restore`
- encrypted restore with missing credentials emits `needs-input` and exits `2`
- `stdout` remains JSONL-only throughout write flows
- behavior is consistent across Node, Bun, and Deno

## Acceptance

- `agent store` and `agent restore` are implemented and documented
- side effects are explicit in `result` rows
- encrypted missing-credential branches emit `needs-input`
- the supported runtime matrix passes for unit and integration suites

## Retrospective

Write flows were the boundary-forcing step Relay needed.

They made request-source conflicts, stdout purity, and missing-credential
classification impossible to hand-wave, and the later review rounds were mostly
about tightening exactly those seams rather than rethinking the overall
direction.
