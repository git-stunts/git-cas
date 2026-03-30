# TR-002 — Truth: Threat Model

## Status

Active

## Linked Legend

- [TR — Truth](../legends/TR-truth.md)

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Context

`git-cas` already had meaningful security documentation in
[SECURITY.md](../../SECURITY.md), but it did not yet have a dedicated threat
model.

That left several important questions under-specified:

- what exactly is protected when encryption is enabled
- what remains visible when a repository or `refs/cas/vault` is exposed
- what "vault passphrase" means operationally
- which compromises are out of scope
- which responsibilities stay with the operator

For an encryption-capable tool, that gap is material.

## Human Users, Jobs, And Hills

### Users

- operators storing sensitive artifacts
- maintainers documenting or reviewing security-sensitive changes
- adopters deciding whether `git-cas` fits their repository threat posture

### Jobs

- understand the actual security boundary of encrypted storage
- understand which metadata remains visible
- understand which threats `git-cas` does not attempt to solve

### Hill

An operator can read the threat model and decide whether `git-cas` is suitable
for a given environment without mistaking cryptographic features for a complete
security system.

## Agent Users, Jobs, And Hills

### Users

- coding agents
- review agents
- documentation agents

### Jobs

- cite the repo's real guarantees and non-guarantees
- avoid inventing security claims during implementation or review
- reason correctly about vault exposure, manifest exposure, and host compromise

### Hill

An agent can use [docs/THREAT_MODEL.md](../THREAT_MODEL.md) as the canonical
statement of what `git-cas` protects, what it exposes, and what remains the
operator's responsibility.

## Human Playback

- Does the document explain what encryption protects and what it does not?
- Does it explain what repo readers can still learn from manifests, trees, and
  vault state?
- Does it make host compromise, key compromise, and metadata exposure explicit
  instead of burying them in caveats?

## Agent Playback

- Can an agent distinguish repository exposure from key compromise?
- Can it tell that vault metadata is not the same thing as encrypted vault
  contents?
- Can it tell which guarantees come from AES-GCM and SHA-256 verification, and
  which are simply not provided?

## Explicit Non-Goals

- no implementation changes in this cycle
- no promise of access control, key custody, or secure deletion
- no attempt to make `SECURITY.md` and the threat model identical documents

## Decisions

### Add A Dedicated Threat Model

The repo needs a separate [docs/THREAT_MODEL.md](../THREAT_MODEL.md).

`SECURITY.md` remains the cryptographic and operational security reference.
The new threat model is the place to define assets, attacker classes, trust
boundaries, guarantees, and non-goals.

### Clarify Vault Passphrase Semantics

The threat model must state that the vault passphrase does not make
`refs/cas/vault` opaque by itself.

What it does is:

- configure KDF-backed key derivation metadata in `.vault.json`
- support passphrase-derived encryption workflows for assets stored and restored
  through the vault path
- support DEK re-wrapping for envelope-encrypted entries during passphrase
  rotation

The slug index, vault tree shape, and metadata blob are still visible to anyone
who can read the repository.

### Call Metadata Exposure Out Explicitly

The document must state that encryption does not hide all metadata.

Visible repository metadata still includes:

- slugs
- filenames
- manifest structure
- chunk sizes and counts
- blob and tree object IDs
- recipient labels and wrapped-recipient records when envelope encryption is
  used

## Implementation Outline

1. Audit [SECURITY.md](../../SECURITY.md), [docs/API.md](../../docs/API.md),
   and the vault/key code paths.
2. Add [docs/THREAT_MODEL.md](../THREAT_MODEL.md) as the canonical threat model
   document.
3. Add light cross-links and wording corrections where existing docs imply more
   confidentiality than the code actually provides.
4. Add this cycle doc to the design index, surface it from the Truth legend,
   and record the change in [CHANGELOG.md](../../CHANGELOG.md).

## Tests To Write First

No new executable tests.

This is a documentation-truth cycle. Verification is:

- cross-check against `VaultService`, `rotateVaultPassphrase`, `KeyResolver`,
  and CLI passphrase resolution
- formatting validation for touched Markdown files

## Risks And Unknowns

- older docs can still drift if later security work does not update both
  `SECURITY.md` and the threat model together
- "vault encryption" language is easy to overread if docs do not stay precise
- future remote or multi-user workflows may require threat model expansion

## Retrospective

This was the right second Truth cycle.

The architecture rewrite fixed the system map; this cycle fixes the security
boundary map. The main value is precision, not volume.
