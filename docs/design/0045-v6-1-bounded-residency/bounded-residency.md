---
title: "PERF-0045 - Bounded Residency"
cycle: "0045"
task_id: "bounded-residency"
legend: "PERF"
release_home: "v6.1.0"
goalpost: "docs/goalposts/v6.1.0/bounded-residency.md"
issue: "not opened yet"
status: "draft"
base_commit: "662fcc7661114715670c0eb48e78bcce47cae43c"
owners:
  - "@git-stunts"
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: []
supersedes:
  - "docs/method/backlog/bad-code/vault-tree-memory-loading.md"
  - "docs/method/backlog/bad-code/TR_persistence-adapter-materialization.md"
superseded_by: null
created: "2026-06-13"
updated: "2026-06-13"
---

# PERF-0045 - Bounded Residency

## Linked Issue

- `not opened yet`

## Linked Goalpost

- [v6.1.0 Bounded Residency](../../goalposts/v6.1.0/bounded-residency.md)

## Design Type

This design is primarily:

- [x] Runtime/API
- [x] Storage/substrate
- [ ] Migration/release
- [ ] CLI/operator
- [x] Docs/public guidance
- [ ] TUI/visual surface
- [x] Test/tooling

## Decision Summary

`v6.1.0` will finish the bounded-residency contract for Git-backed reads. Single
vault entry lookup should use targeted tree reads when available, vault listing
should stay streaming when the adapter supports iteration, and unbounded payload
reads should use `readBlobStream()` rather than `readBlob()` materialization.

## Sponsored Human

A maintainer with a large vault wants lookup and list operations to have clear
residency bounds so that `git-cas` remains usable in constrained runtimes,
without having to split vaults or avoid the vault surface.

## Sponsored Agent

An agent needs inspectable tests and errors for residency boundaries so it can
choose safe restore and vault operations, without inferring memory behavior from
private adapter implementation details.

## Hill

By the end of this cycle, a reviewer can run focused tests that prove targeted
vault lookup, streaming vault list, and stream-first payload reads through the
public persistence contracts, and the release docs describe that behavior
without overstating custom adapter guarantees.

## Current Truth

- `docs/method/backlog/bad-code/vault-tree-memory-loading.md` says
  `VaultService.#readCachedVaultTree` and dependencies read and parse an entire
  Git tree into a slug map.
- `docs/method/backlog/bad-code/TR_persistence-adapter-materialization.md` says
  `GitPersistenceAdapter.readBlob` materialization creates O(N) residency
  pressure.
- `src/infrastructure/adapters/GitPersistenceAdapter.js` exposes
  `readBlobStream()`, `readTreeEntry()`, and `iterateTree()`, and guards
  `readBlob()` with a default 10 MB limit.
- `src/domain/services/VaultPersistence.js` already prefers `readTreeEntry()`
  in `readEntry()` and exposes `iterateEntries()` over `iterateTree()` when
  available.
- `src/domain/services/VaultService.js` still contains cached whole-tree paths,
  which means the existing primitives are not yet a complete product contract.
- `src/domain/services/ChunkRepository.js` already requires
  `readBlobStream()` for hard-limited buffered restore modes, but the release
  needs a complete proof pass across the relevant domain reads.

## Problem

The repo has streaming and targeted primitives, but the release contract is not
yet coherent. Some paths can still make a large-vault operation resident before
doing single-entry work, and some docs still describe materialization debt in a
way that no longer matches the partial guard already present in the adapter.

## Scope

This cycle includes:

- RED tests for single vault lookup avoiding `readTree()` when `readTreeEntry()`
  is available.
- RED tests for vault list using `iterateTree()` when available.
- RED tests or regression coverage for payload reads preferring
  `readBlobStream()` when payload size is unbounded.
- Implementation changes inside `VaultService`, `VaultPersistence`,
  `ChunkRepository`, `ManifestRepository`, or adapters as needed.
- Documentation updates to the goalpost, backlog cards, `STATUS.md`,
  `CHANGELOG.md`, and release evidence.

## Non-Goals

This cycle does not include:

- changing the vault tree format
- adding pagination to the public API unless targeted tests prove streaming
  iteration is insufficient
- browser or edge adapters
- new encryption modes
- changing the package's public storage format
- removing all custom adapter fallback behavior

## Runtime / API Contract

The target contract is:

- `GitPersistencePort.readTreeEntry(treeOid, treePath)` is the preferred
  single-entry tree read when implemented by an adapter.
- `GitPersistencePort.iterateTree(treeOid)` is the preferred list scan when
  implemented by an adapter.
- `GitPersistencePort.readBlob(oid, maxBytes?)` is for metadata-sized reads and
  must stay guarded.
- `GitPersistencePort.readBlobStream(oid)` is the required path for unbounded
  payload reads.
- Hard-limited modes that cannot verify their bound through streaming must fail
  with an explicit capability error instead of silently materializing.

No public storage format change is planned.

## User Experience / Product Shape

Not applicable as a rendered workflow. The user-visible contract is operational:
large vaults and large payloads should fail less often due to memory residency,
and errors should explain missing adapter capabilities when a safe path is not
available.

## Data / State Model

| State | Source of truth | Derived state | Invalid states | Reset behavior | Serialization | Determinism assumptions |
| --- | --- | --- | --- | --- | --- | --- |
| Vault tree | Git tree at `refs/cas/vault` | slug-to-manifest mapping | missing metadata, malformed privacy index, invalid tree entries | reread from current ref | Git tree entries | tree OID fixes content |
| Blob content | Git blob OID | chunk or manifest bytes | blob exceeds guarded metadata read limit | reread stream from OID | Git blob bytes | OID fixes bytes |

## Architecture / Anti-SLUDGE Posture

| Concern | Decision |
| --- | --- |
| Domain changes | Keep use-case orchestration in `VaultService`; move substrate-specific lookup decisions into `VaultPersistence` when possible. |
| Port changes | Prefer existing `readTreeEntry`, `iterateTree`, and `readBlobStream`; add port surface only if tests prove a missing contract. |
| Adapter changes | Keep Git CLI implementation inside `GitPersistenceAdapter`. |
| Boundary validation | Guard metadata reads and capability errors at port/domain boundaries. |
| Runtime-backed nouns introduced | None planned. |
| Expected failure representation | `CasError` with existing error codes where possible. |
| Banned shortcuts avoided | Do not solve scale by raising heap limits or documenting "avoid large vaults". |

## Cost / Residency Posture

| Surface | Current cost | Target cost | Limit/budget | Failure mode |
| --- | --- | --- | --- | --- |
| Single vault entry lookup | may materialize full tree through cached map | targeted one-entry read when supported | O(1) tree entry result plus metadata reads | fallback documented when adapter lacks support |
| Vault list | streaming primitive exists, but cache paths can force residency | iterator-first list path | O(entry) streaming processing | malformed entry raises `CasError` |
| Metadata blob read | bounded by adapter default in Git adapter | explicitly metadata-sized and guarded | default 10 MB unless caller lowers it | `RESTORE_TOO_LARGE` or domain equivalent |
| Payload blob read | stream support exists | stream-first for unbounded data | chunk stream, not full blob buffer | explicit capability error if safe stream absent |

## Git Substrate Impact

| Substrate area | Impact |
| --- | --- |
| refs | Read `refs/cas/vault`; no ref format change. |
| commits | No commit format change. |
| trees/blobs | Prefer targeted tree entry and streaming tree/blob reads. |
| object ids | No object ID behavior change. |
| tag/release behavior | `v6.1.0` release evidence should include bounded-residency proof. |
| migration compatibility | No migration expected. |

## Compatibility / Migration Posture

| Concern | Decision |
| --- | --- |
| Public API compatibility | Preserve existing public API unless tests force a narrow addition. |
| Package export changes | None planned. |
| Storage/read compatibility | Existing vaults and manifests remain readable. |
| Legacy behavior retained | Adapter fallbacks stay where they are safe and documented. |
| Deprecation behavior | None planned. |
| Migration path | Not applicable. |
| Release note impact | Changelog should call this scale hardening, not a format change. |

## Error Contract

| Failure | Error/result | Caller recovery | Test |
| --- | --- | --- | --- |
| Metadata blob exceeds guard | `CasError` with size details | use stream path or inspect corrupt metadata | adapter readBlob test |
| Adapter lacks stream for hard-limited restore | explicit capability error | implement `readBlobStream()` | restore guard test |
| Targeted tree lookup unsupported | documented fallback | adapter may implement `readTreeEntry()` | vault persistence fallback test |
| Malformed tree entry | `CasError` from parsing boundary | repair Git tree or vault state | tree parser test |

## Security / Trust / Redaction Posture

- trust boundary: Git object database and configured persistence adapter
- authority or capability checked: adapter methods and vault encryption keys
- secret-bearing values: vault passphrases, encryption keys, and privacy index
  keys remain outside logs and docs
- redaction behavior: no new secret output
- log/report behavior: any witness must use synthetic fixture slugs and OIDs
- abuse or replay concern: no new write authority or replay surface

## Lower Modes

The lower mode is deterministic test and witness output:

- spy tests proving `readTree()` is not called on targeted lookup
- iterator tests proving list reads consume `iterateTree()`
- restore tests proving stream reads are selected
- release witness summarizing focused and full validation commands

## Accessibility Posture

This is not rendered UI work. Accessibility is preserved through linear docs,
plain error text, and machine-readable error metadata. No meaning should depend
on color, layout, or terminal cursor behavior.

## User-Facing Text / Directionality

Visible text changes should be limited to docs, changelog, and any new or
clarified error message. Text is English, left-to-right, and should have a
machine-readable equivalent in `CasError` metadata where runtime errors change.

## Agent Inspectability / Explainability Posture

Agents can inspect the result through:

- stable test names
- `CasError` codes and metadata
- command transcripts in `docs/design/0045-v6-1-bounded-residency/witness/`
- goalpost closeout checkboxes
- changelog entries that name the actual bounded surfaces

## Linked Invariants

- [I-001 - Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)
- Tests Are the Spec
- Runtime Truth Wins
- Hexagonal Architecture
- Docs Are Evidence, Not Proof

## Design Alternatives Considered

### Option A: Only update docs

Pros:

- quick
- acknowledges that some primitives already exist

Cons:

- does not prove `VaultService` uses the primitives safely
- leaves active debt unresolved
- risks release notes overstating behavior

### Option B: Add a new paginated vault API first

Pros:

- gives operators explicit paging controls
- can be useful later for TUI and agent surfaces

Cons:

- public API work before proving internal residency
- may create API churn when existing `iterateTree()` is enough

### Option C: Finish the existing bounded primitives

Pros:

- uses already-established port boundaries
- keeps public API stable
- maps directly to current active debt

Cons:

- custom adapters still need honest fallback handling
- some domain paths may still need careful audit

## Decision

Choose Option C. Finish the existing bounded primitives and prove them through
unit, integration, and release evidence before adding new public paging
surfaces.

## Proof Surface

The implementation must be proven through:

- actual surface under test: vault service/persistence, Git persistence adapter,
  CAS restore/read paths
- first RED test: single vault entry lookup with `readTreeEntry()` available
  must fail if `readTree()` is called
- required witness command: focused tests plus `npm test`
- non-acceptable proof: docs-only assertions or heap-limit anecdotes

## Implementation Slices

- Add targeted vault lookup tests.
- Add streaming vault list tests.
- Add or tighten `readBlob()`/`readBlobStream()` residency tests.
- Implement the bounded read behavior.
- Update docs, changelog, goalpost, and witness evidence.

Each slice should be independently reviewable and should close with a concrete
test or witness.

## Tests To Write First

Behavior tests required:

- [ ] Vault lookup does not call `readTree()` when `readTreeEntry()` can answer
      the requested slug.
- [ ] Vault list consumes `iterateTree()` when supported.
- [ ] Metadata blob reads are guarded by size.
- [ ] Payload restore paths prefer `readBlobStream()` and do not fall back to
      unbounded `readBlob()` in hard-limited modes.
- [ ] Fallback behavior is covered for custom adapters that lack targeted tree
      reads.

Documentation/process tests, only if relevant:

- [ ] Goalpost and roadmap links point to real files.
- [ ] Backlog cards are updated or dispositioned after implementation.

Rule: documentation tests cannot be the only proof for implementation work.

## Acceptance Criteria

The work is done when:

- [ ] Behavior tests prove targeted vault lookup.
- [ ] Behavior tests prove streaming vault listing.
- [ ] Runtime tests prove the blob read contract.
- [ ] Errors are explicit when safe streaming support is missing.
- [ ] Docs, changelog, and release notes are updated.
- [ ] Goalpost closeout is updated.
- [ ] CI and local validation are green.

## Validation Plan

Commands expected before PR:

```bash
npx vitest run test/unit/vault
npx vitest run test/unit/infrastructure/adapters/GitPersistenceAdapter.readBlob.test.js
npx vitest run test/unit/domain/services/CasService.readBlobStream.test.js
npx eslint .
npm test
npm run release:verify -- --skip-jsr
```

## Playback / Witness

Create `docs/design/0045-v6-1-bounded-residency/witness/verification.md` during
implementation. It should include:

- focused test commands and outputs
- full unit-suite output
- release verifier output if run
- answers to whether each proof story passed

## Risks

Known risks:

- Some existing tests may rely on whole-tree cache behavior.
- Custom persistence adapters may not implement targeted reads or streaming
  reads.
- Metadata reads need small-buffer ergonomics while payload reads need strict
  stream-first behavior.

Mitigations:

- Preserve safe fallbacks and test them.
- Keep public API changes out unless necessary.
- Document capability requirements precisely.

## Follow-On Debt

Create backlog files or GitHub issues for:

- public paginated vault APIs, if tests prove operator need
- browser/edge read-path adapter work
- custom adapter conformance tests beyond the current fixture suite

## Tracker Disposition

| Issue | Role | Expected disposition |
| --- | --- | --- |
| `docs/method/backlog/bad-code/vault-tree-memory-loading.md` | primary input | close or mark resolved when tests and implementation land |
| `docs/method/backlog/bad-code/TR_persistence-adapter-materialization.md` | primary input | close or rewrite to remaining custom-adapter risk |
| `not opened yet` | umbrella issue | open before implementation PR |

## Done Does Not Mean

When this lands, it does not prove:

- browser or edge runtime support
- public pagination API ergonomics
- memory bounds inside every third-party custom adapter
- formal performance benchmarking

## Retrospective

Fill this in after implementation.

What changed from the design:

- `not implemented yet`

What the tests proved:

- `not implemented yet`

What remains open:

- `not implemented yet`

PR:

- `not opened yet`
