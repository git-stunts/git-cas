# RL-001 — Relay: Agent Recipient List

## Status

Landed

## Linked Legend

- [RL — Relay](../legends/RL-relay.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

Relay now has the first read-heavy commands plus initial write primitives.

The next bounded gap is recipient inspection. Before an agent can safely add,
remove, or rotate recipients, it needs a stable way to inspect the current
recipient state.

This cycle keeps the slice read-only on purpose.

## Human Users, Jobs, And Hills

### Users

- maintainers
- release engineers
- operators preparing recipient or rotation changes

### Jobs

- inspect envelope recipient state before mutation
- confirm that automation is pointed at the right asset

### Hill

A human operator can trust automation around recipient lifecycle work because
recipient inspection is explicit and structured before any write path lands.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- CI jobs
- release workflows

### Jobs

- resolve recipient state from a stable command
- branch on envelope vs non-envelope assets
- prepare for add, remove, and rotate operations

### Hill

An agent can inspect recipient state through `git cas agent recipient list`
without scraping human CLI output and without guessing whether the asset is
envelope-encrypted.

## Human Playback

- Can an operator ask Relay for recipient state and get an obviously structured
  answer?
- Does the result clearly identify which asset and tree were inspected?

## Agent Playback

- Can an agent call one command and learn whether the asset uses recipients?
- Can it get recipient labels in stable order without parsing prose?
- Can it target by slug or OID like the other Relay inspection commands?

## Explicit Non-Goals

- no recipient mutation in this cycle
- no key rotation in this cycle
- no long-lived session behavior
- no attempt to unify the human and agent command syntax beyond useful target
  parity

## Decisions

### Command Shape

Relay adds:

- `git cas agent recipient list --slug <slug>`
- `git cas agent recipient list --oid <tree-oid>`

It also accepts request payloads that provide `slug` or `oid`, following the
existing Relay target pattern.

### Result Shape

Successful `result` rows should expose:

- `slug`
- `treeOid`
- `envelope`
- `recipientCount`
- `recipients`

`recipients` should be a stable array of structured rows containing:

- `label`
- `keyVersion` when present

### Non-Envelope Behavior

This command remains successful for non-envelope assets.

Instead of throwing, it should return:

- `envelope: false`
- `recipientCount: 0`
- `recipients: []`

That keeps inspection composable and avoids turning an expected state into an
exception path.

## Implementation Outline

1. Add the new command to the Relay command registry.
2. Extend namespace resolution to support `recipient ...` in the agent path.
3. Reuse the existing target resolution flow (`--slug` or `--oid`).
4. Read the manifest and normalize recipient rows for machine use.
5. Keep the command read-only and protocol-only.

## Tests To Write First

- recipient list succeeds for an envelope-encrypted asset targeted by slug
- recipient list succeeds for an envelope-encrypted asset targeted by request
  payload or OID
- recipient list returns `envelope: false` and an empty array for a non-envelope
  asset
- recipient list emits structured invalid-input when no target is provided

These tests belong in the existing agent CLI integration suite because this
slice extends the shared Relay protocol contract rather than introducing a new
test namespace.

## Risks And Unknowns

- result shape should stay useful without leaking noisy recipient ciphertext
  fields
- future add/remove/rotate cycles will need to build on this shape without
  breaking callers

## Retrospective

Keeping this slice read-only was the right call.

It established the recipient result shape and the non-envelope success path that
later recipient mutation and rotation work reused directly, without forcing
agents to branch through avoidable exception cases.
