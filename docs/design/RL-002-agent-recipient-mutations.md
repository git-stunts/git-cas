# RL-002 — Relay: Agent Recipient Mutations

## Status

Landed

## Linked Legend

- [RL — Relay](../legends/RL-relay.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

Relay can now inspect recipient state with `agent recipient list`.

The next bounded step is mutation parity for the envelope recipient lifecycle:

- `agent recipient add`
- `agent recipient remove`

This is the first recipient-management write slice for the machine contract.

## Human Users, Jobs, And Hills

### Users

- maintainers
- release engineers
- operators automating envelope access changes

### Jobs

- grant a new recipient access using an existing trusted recipient key
- remove a recipient explicitly and know what changed in the vault

### Hill

A human operator can trust recipient-management automation because the machine
path makes vault-updating side effects explicit instead of hiding them behind
human CLI text.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- CI jobs
- release and access-management workflows

### Jobs

- add a recipient deterministically
- remove a recipient deterministically
- branch on duplicate-label, missing-label, and last-recipient failures without
  parsing prose

### Hill

An agent can mutate envelope recipients through a stable Relay contract and
learn exactly which tree and vault commit were produced.

## Human Playback

- Can an operator inspect the result and see what changed without additional
  lookup commands?
- Are failure modes specific enough to act on without opening the human CLI?

## Agent Playback

- Can an agent add a recipient using explicit key files and a slug target?
- Can it remove a recipient and observe the new tree and commit directly?
- Do expected domain failures surface as structured protocol errors?

## Explicit Non-Goals

- no recipient key rotation in this cycle
- no OID-only mutation path
- no implicit prompting for key material
- no long-lived session behavior

## Decisions

### Command Shape

Relay adds:

- `git cas agent recipient add --slug <slug> --label <label> --key-file <path> --existing-key-file <path>`
- `git cas agent recipient remove --slug <slug> --label <label>`

Request payloads may also provide these fields.

These commands stay slug-based because they update the vault entry, not just an
arbitrary detached tree.

### Result Shape

Successful mutation `result` rows should expose:

- `action`
- `slug`
- `label`
- `previousTreeOid`
- `treeOid`
- `commitOid`
- `recipientCount`
- `recipients`

`recipients` uses the same structured row shape as `recipient list`.

### Error Behavior

The command should preserve existing domain error codes where they already say
the right thing:

- `RECIPIENT_ALREADY_EXISTS`
- `RECIPIENT_NOT_FOUND`
- `CANNOT_REMOVE_LAST_RECIPIENT`
- `DEK_UNWRAP_FAILED`

Missing required flags remain `INVALID_INPUT`.

## Implementation Outline

1. Add `recipient add` and `recipient remove` to the Relay command registry.
2. Parse explicit slug, label, and key-file inputs from flags or request
   objects.
3. Resolve the current vault tree and manifest by slug.
4. Apply the existing domain recipient mutation methods.
5. Create the new tree, update the vault, and return explicit side-effect data.

## Tests To Write First

- recipient add succeeds and reports the new tree, commit, and recipient rows
- recipient add supports request-payload input
- recipient remove succeeds and reports the new tree, commit, and recipient rows
- duplicate recipient label surfaces as `RECIPIENT_ALREADY_EXISTS`
- removing the last recipient surfaces as `CANNOT_REMOVE_LAST_RECIPIENT`

These tests belong in the existing agent CLI integration suite because they are
protocol contract tests over the Relay boundary.

## Risks And Unknowns

- the result shape must stay stable enough for later rotation work
- slug-only targeting is deliberate here, but future detached-tree workflows may
  want a different mutation path

## Retrospective

This slice proved that recipient mutation should return explicit side effects,
not just "success" status.

The result shape and edge-case failures here became the contract foundation for
later rotation work and for review hardening around machine-visible error
semantics.
