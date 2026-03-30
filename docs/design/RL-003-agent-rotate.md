# RL-003 — Relay: Agent Rotate

## Status

Landed

## Linked Legend

- [RL — Relay](../legends/RL-relay.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

Relay can now:

- inspect recipient state
- add recipients
- remove recipients

The next bounded gap is key rotation through the machine-facing contract.

The human CLI already supports rotation. The Relay job here is not to invent a
new domain behavior. It is to make the rotate workflow deterministic,
non-interactive, and explicit about what changed.

## Human Users, Jobs, And Hills

### Users

- maintainers
- release engineers
- operators managing recipient rollover

### Jobs

- rotate an envelope recipient key without re-encrypting blob data
- know whether the vault entry changed or whether the result is only a detached
  tree

### Hill

A human operator can trust agent-driven key rotation because the resulting tree
and vault side effects are explicit in the machine contract.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- CI jobs
- access-management workflows

### Jobs

- rotate a recipient key by slug
- rotate a detached manifest tree by OID
- branch on no-match, unsupported-manifest, and recipient-label failures
  without parsing prose

### Hill

An agent can rotate keys through Relay and learn exactly which tree was created
and whether the vault was updated.

## Human Playback

- Can an operator see the new tree and vault update directly from the result
  row?
- Does the machine path make detached-tree behavior obvious instead of implying
  a vault mutation that never happened?

## Agent Playback

- Can an agent rotate a slug-targeted vault entry and then restore via the new
  key?
- Can it rotate a detached tree by OID and receive a new tree without a vault
  commit?
- Do domain failures surface as structured protocol errors with stable codes?

## Explicit Non-Goals

- no vault passphrase rotation in this cycle
- no recipient add/remove behavior in this cycle
- no interactive key prompts
- no long-lived session or streaming progress protocol

## Decisions

### Command Shape

Relay adds:

- `git cas agent rotate --slug <slug> --old-key-file <path> --new-key-file <path>`
- `git cas agent rotate --oid <tree-oid> --old-key-file <path> --new-key-file <path>`

Optional:

- `--label <label>`

Request payloads may also provide the same fields.

### Target Semantics

`--slug` means:

- resolve the current vault entry
- rotate the manifest
- create a new tree
- update the vault entry with `force: true`
- return the new tree and the new vault commit

`--oid` means:

- read the detached manifest tree directly
- rotate the manifest
- create a new tree
- do not update the vault
- return the new tree and explicitly report that the vault was not updated

Relay chooses explicit detached-tree persistence here because a machine-facing
rotate result is more useful when it returns a real follow-on tree OID instead
of an in-memory manifest dump.

### Result Shape

Successful rotation `result` rows should expose:

- `action`
- `slug`
- `label` when explicitly provided
- `previousTreeOid`
- `treeOid`
- `commitOid` when the vault was updated
- `updatedVault`
- `keyVersion`
- `recipientCount`
- `recipients`

`recipients` uses the same structured row shape as `recipient list` and
recipient mutation results.

### Error Behavior

Relay should preserve existing domain error codes where they already describe
the failure correctly:

- `NO_MATCHING_RECIPIENT`
- `DEK_UNWRAP_FAILED`
- `RECIPIENT_NOT_FOUND`
- `ROTATION_NOT_SUPPORTED`

Missing required inputs remain `INVALID_INPUT`.

## Implementation Outline

1. Add `rotate` to the Relay command registry.
2. Parse slug/OID targeting plus explicit old/new key file inputs.
3. Reuse the existing manifest-resolution helpers.
4. Apply the existing `cas.rotateKey()` domain operation.
5. Persist the rotated manifest as a new tree.
6. Update the vault only when the target came from `--slug`.
7. Return explicit tree/vault side-effect data.

## Tests To Write First

- slug-targeted rotate succeeds and reports new tree plus vault commit
- detached-tree rotate succeeds and reports a new tree without a vault commit
- rotated content restores with the new key
- missing slug/OID target surfaces as `INVALID_INPUT`
- wrong old key with an explicit label surfaces as `DEK_UNWRAP_FAILED`

These are Relay contract tests and belong in the agent CLI integration suite.

## Risks And Unknowns

- detached-tree rotation is useful for agents, but it is a semantic choice that
  differs from the human CLI's plain manifest output path
- the result shape should stay stable enough that future vault-wide rotation or
  session-based Relay work can build on it cleanly

## Retrospective

Pending.
