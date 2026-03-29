# 0003 — M18 Relay: Tree Creation Primitive

## Status

Proposed

## Context

Relay now supports read commands plus the `store` and `restore` write boundary.

The next useful primitive is `agent tree`:

- it lets an agent materialize a Git tree from a manifest without scraping the
  human CLI
- it is a shared building block for later repo automation and TUI follow-on
  work
- it adds machine-native manifest input without dragging vault mutation into the
  same slice

## Sponsor User

A maintainer who wants machine-driven manifest workflows to use the same core
tree-creation behavior as the human CLI.

## Sponsor Agent

An agent that already has manifest data and needs a stable way to create a Git
tree from it without writing terminal-oriented glue code.

## Hills

- A sponsor agent can create a CAS tree from either a manifest file or an
  inline request-object manifest and receive the resulting `treeOid` as
  protocol data.
- A sponsor user can trust that Relay tree creation uses the same manifest
  validation rules as the existing domain model.

## Explicit Non-Goals

- No vault mutation in this slice.
- No manifest editing workflow.
- No binary input or output path handling.
- No attempt to redesign the human `tree` command.

## Decisions

### Input shape

`agent tree` accepts manifest input in two forms:

- `--manifest <path>` for parity with the human CLI
- `request.manifest` as an inline JSON object for agent-native use

If both exist, flags win because Relay flags override request-object fields.

### Validation

Both input forms are validated through the existing `Manifest` value object.
Relay should not create a second manifest schema or parallel validation path.

### Result shape

Successful `result` rows should expose:

- `treeOid`
- `slug`
- `chunkCount`
- `encrypted`
- `compressed`

This is enough for an agent to branch on tree creation without re-reading the
manifest immediately.

## Testing Plan

Contract coverage for this slice must pin:

- successful `agent tree --manifest <path>`
- successful `agent tree` with `request.manifest`
- invalid input when no manifest source is supplied
- JSONL-only protocol behavior on `stdout`

## Acceptance

- `agent tree` is implemented in Relay
- manifest file and inline request-object inputs both work
- invalid-input behavior stays structured
- the supported runtime matrix passes
