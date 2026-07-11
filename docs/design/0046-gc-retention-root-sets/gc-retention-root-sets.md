---
title: "API-0046 - GC Retention Root Sets"
cycle: "0046"
task_id: "gc-retention-root-sets"
legend: "API"
release_home: "v6.1.0"
issue: "https://github.com/git-stunts/git-cas/issues/48"
goalpost_issue: "https://github.com/git-stunts/git-cas/issues/38"
tracker_source: "github"
status: "landed"
base_commit: "19bcf9b0b6738f811c0c49408d5cb06e1c348bee"
owners:
  - "@git-stunts"
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: []
supersedes: []
superseded_by: null
created: "2026-07-11"
updated: "2026-07-11"
---

<!-- markdownlint-disable MD013 MD025 MD034 -->

# API-0046 - GC Retention Root Sets

## Linked Issue

- https://github.com/git-stunts/git-cas/issues/48

## Linked Tracker

- Milestone: `v6.1.0`
- Goalpost issue: https://github.com/git-stunts/git-cas/issues/38
- Slice issue: https://github.com/git-stunts/git-cas/issues/48

## Design Type

This design is primarily:

- [x] Runtime/API
- [x] Storage/substrate
- [x] Migration/release
- [x] CLI/operator
- [x] Docs/public guidance
- [ ] TUI/visual surface
- [x] Test/tooling

## Decision Summary

`git-cas` should add a ref-backed `RootSet` API for current-generation
retention. A root set anchors named CAS objects while they are members of the
set and releases them when removed, giving callers a GC-safe middle ground
between unrooted plumbing and the vault's history-preserving durable registry.

## Sponsored Human

A maintainer with WARP graphs and large CAS-backed caches wants cache payloads
to stay alive while the application still indexes them so that normal Git GC
does not silently destroy live data, without having to put evictable cache state
into a permanent vault history.

## Sponsored Agent

An agent needs an inspectable retention contract so it can classify CAS objects
as anchored, orphaned, or volatile from Git reachability evidence, without
inferring durability from JSON fields that happen to contain object IDs.

## Hill

By the end of this cycle, a caller can store CAS tree OIDs in a named root set,
prove those trees are not reported by `git prune -n --expire=now` while present,
remove entries from the root set, and prove removed trees become prunable when
no other Git ref reaches them.

## Current Truth

- `src/domain/services/CasService.js#L370-L375@19bcf9b0` exposes
  `createTree({ manifest, merkleThreshold })` by delegating to
  `ManifestRepository.createTree()`.
- `src/domain/services/ManifestRepository.js#L51-L70@19bcf9b0` writes a
  manifest blob and Git tree entries, then returns the tree OID. It does not
  update a branch, tag, vault ref, or any other root.
- `docs/API.md#L374-L388@19bcf9b0` documents `createTree()` as returning a Git
  tree OID.
- `docs/WALKTHROUGH.md#L1200-L1207@19bcf9b0` warns that a tree returned by
  `createTree({ manifest })` is garbage-collectable when nothing references it,
  and names the vault as the ref-backed solution.
- `docs/API.md#L907-L918@19bcf9b0` says the vault is GC-safe because
  `refs/cas/vault` points at a commit chain whose tree indexes stored assets.
- `src/domain/services/VaultPersistence.js#L168-L194@19bcf9b0` writes vault
  metadata and asset entries to a tree, creates a commit, and updates
  `refs/cas/vault` with compare-and-swap semantics.
- Vault history is deliberately durable. `docs/API.md#L1261-L1261@19bcf9b0`
  says each vault mutation creates a new commit and `git log refs/cas/vault`
  can inspect that history.
- Local WARP investigation on 2026-07-11 found a live state-cache JSON index
  whose current payload tree OIDs were all reported by
  `git prune -n --expire=now`. That result is design input, not release
  evidence for this repository, because it is not yet captured in a committed
  witness.

## Problem

The public API has a durability cliff:

- low-level plumbing can create Git objects but does not anchor them;
- the vault anchors objects, but it also preserves mutation history through a
  commit chain;
- cache and graph applications need "anchored while live, prunable after
  removal" semantics.

Object IDs stored inside JSON are not Git reachability. A caller can believe a
tree is pinned because an application index references its OID, while Git still
classifies that tree as unreachable and prunable. That is the wrong failure mode
for state caches, checkpoint accelerators, graph materializations, and repair
indexes.

## Scope

This cycle includes:

- a public root-set API that can anchor tree OIDs under caller-owned refs
- a storage format that represents only the current live set by default
- compare-and-swap update semantics for concurrent writers
- metadata that records retention policy separately from Git reachability
- doctor checks for root-set integrity and prune-risk detection
- docs that distinguish plumbing, vault, and root-set GC behavior
- Git-backed tests using `git prune -n --expire=now` without running `git gc`

## Non-Goals

This cycle does not include:

- replacing the vault
- changing the vault's historical audit behavior
- automatically running `git gc`
- relying on pack `.keep` files for normal application retention
- recovering objects that were already pruned before repair starts
- implementing WARP-specific state-cache migration inside `git-cas`
- making root sets confidential or encrypted in the first pass
- adding a rendered TUI workflow

## Runtime / API Contract

The target public shape is a root-set service reachable from the library facade.
Exact naming can change during implementation, but the contract should preserve
these nouns:

```javascript
const rootSet = await cas.rootSets.open({
  ref: 'refs/cas/rootsets/warp/state-cache',
});

await rootSet.put({
  name: snapshotId,
  oid: payloadTreeOid,
  type: 'tree',
  retention: 'pinned',
});

await rootSet.remove({ name: evictedSnapshotId });
const entries = await rootSet.list();
```

The root-set API must provide:

- `open({ ref })`: construct a service for one validated ref namespace
- `read()`: return current metadata, entries, and head OID
- `list()`: return current entries without exposing stale history as live state
- `put({ name, oid, type, retention, metadata? })`: add or replace one entry
- `remove({ name })`: remove one entry
- `replace({ entries, expectedHead? })`: atomically replace the current set
- `mutate(callback, { expectedHead? })`: read-modify-write with retry support
- `contains({ oid })`: inspect whether an OID is anchored by this root set

The implementation may expose a narrower first slice if the design and tests
preserve the same state transitions.

### Retention Vocabulary

The API should avoid using one word for two different concepts.

| Term | Kind | Meaning |
| --- | --- | --- |
| `anchored` | Git reachability state | Object is reachable from a Git ref, tag, branch, or reflog. |
| `orphaned` | Git reachability state | Object is unreachable but still inside Git's grace period. |
| `volatile` | Git reachability state | Object is unreachable and eligible for the next prune. |
| `pinned` | Application retention policy | Root-set policy says this entry must not be evicted by normal cache policy. |
| `evictable` | Application retention policy | Root-set policy says this entry may be removed by cache policy. |
| `ephemeral` | Application retention policy | Caller accepts loss without repair; no root-set anchor is required. |

`Pinned` should not mean "stored in a packfile with `.keep`" in the normal API.
That Git mechanism is a repository maintenance tool, not the product-level
retention primitive this design needs.

## User Experience / Product Shape

There is no rendered workflow in the first slice. The user-visible contract is
operator confidence:

- docs and API names state whether a tree is unrooted, anchored, or vault-kept
- doctor output can explain why an object is safe or prune-risky
- repair guidance can tell downstream applications to adopt live OIDs into a
  root set before running destructive cleanup

CLI exposure can follow the library API:

```bash
git cas root-set inspect refs/cas/rootsets/warp/state-cache
git cas root-set doctor refs/cas/rootsets/warp/state-cache
```

Write-capable CLI commands are optional in this cycle unless tests show the
library-only surface leaves operators without a repair path.

## Data / State Model

| State | Source of truth | Derived state | Invalid states | Reset behavior | Serialization | Determinism assumptions |
| --- | --- | --- | --- | --- | --- | --- |
| Root-set ref | caller-supplied ref under the accepted namespace | current root-set head | ref points to missing object, wrong object type, or invalid namespace | update ref with compare-and-swap | Git ref to commit | ref OID fixes the set generation |
| Root-set commit | Git object database | commit metadata and tree OID | parentful commit when historyless mode is required, missing tree | replace with a valid commit | parentless Git commit by default | commit OID fixes tree and message |
| Root-set tree | Git object database | anchored entry targets | missing metadata, invalid entry path, wrong target type | rewrite tree from valid entries | Git tree | tree OID fixes entry set |
| Entry metadata | `.rootset.json` blob | policy and caller metadata | malformed JSON, unknown version, unsupported retention | rewrite from validated entries | JSON, stable key order | encoded bytes are deterministic |
| Anchored target | Git object database | reachability from root set | missing target OID, type mismatch | remove or repair entry | tree entry with mode for target type | target OID fixes content |

The default root-set commit should not point to the previous root-set commit.
That is the central distinction from the vault. Once a ref moves away from an
old generation, the old commit and objects reachable only from it can become
prunable under normal Git rules.

## Architecture / Anti-SLUDGE Posture

| Concern | Decision |
| --- | --- |
| Domain changes | Add a root-set domain service instead of overloading vault behavior. |
| Port changes | Reuse existing Git persistence primitives where possible; add narrow ref/object helpers only if tests require them. |
| Adapter changes | Keep ref updates and Git object writes in infrastructure adapters. |
| Storage codecs | Introduce a small root-set metadata codec with explicit schema versioning. |
| Naming | Prefer `RootSet` for the API noun; avoid `Locker` because the object is a reachability root, not a lock. |
| Boundary validation | Validate refs, OIDs, object types, names, and retention policy before writing. |
| Expected failure representation | Use `CasError` with root-set-specific codes when existing codes would hide recovery steps. |
| Banned shortcuts avoided | Do not make JSON OID references appear durable without a Git ref. |

## Cost / Residency Posture

| Surface | Current cost | Target cost | Limit/budget | Failure mode |
| --- | --- | --- | --- | --- |
| Root-set read | not available | metadata plus current tree entries | O(number of live entries) | explicit malformed-root-set error |
| Single entry lookup | not available | targeted tree entry when adapter supports it | O(1) plus metadata | fallback to tree scan when safe |
| Root-set replace | not available | one tree write, one commit write, one CAS ref update | O(number of live entries) | conflict error after retries |
| Prune-risk check | manual `git prune -n` interpretation | doctor summarizes reachability policy | bounded by checked OIDs | explicit unknown-object report |

Root sets do not solve large-list pagination by themselves. If WARP or other
callers need very large root sets, a later design can add sharded root-set
layouts or iterator-first listing.

## Determinism / Replay / Causality

- Root-set metadata encoding must be stable so equivalent entry sets produce
  equivalent metadata blobs.
- Entry ordering must be deterministic.
- Compare-and-swap ref updates must surface conflicts instead of silently
  overwriting concurrent writers.
- The default no-parent commit model intentionally drops old generations from
  reachability. Replay of historical root-set state is a non-goal unless a
  caller explicitly opts into history.
- Witnesses must use synthetic repositories so prune dry-runs are repeatable.

## Git Substrate Impact

| Substrate area | Impact |
| --- | --- |
| refs | Add caller-owned refs under a validated namespace such as `refs/cas/rootsets/<name>`. |
| commits | Write parentless root-set commits by default so old generations are not retained as history. |
| trees | Root-set trees contain metadata plus tree/blob entries that anchor targets. |
| blobs | Metadata blobs store entry policy and caller metadata, not payload data. |
| object ids | OID strings in metadata are descriptive; tree entries create reachability. |
| pruning | Entries present in the current root set must not appear in `git prune -n --expire=now`. Removed entries may appear when no other ref reaches them. |
| migration compatibility | Existing vaults and manifests remain unchanged. |

The implementation must prove that a root-set tree entry pointing at a target
tree is sufficient Git reachability for all payload blobs reachable from that
target tree.

## Compatibility / Migration Posture

| Concern | Decision |
| --- | --- |
| Public API compatibility | Additive API only. |
| Package export changes | Add root-set exports only after behavior tests exist. |
| Storage/read compatibility | Existing CAS trees, manifests, and vaults remain readable. |
| Legacy behavior retained | `createTree()` remains low-level and unanchored. |
| Deprecation behavior | No immediate deprecation; docs should warn more clearly about unrooted trees. |
| Migration path | Downstream applications can adopt known-live OIDs into a root set before cleanup. |
| Release note impact | Release notes must distinguish root sets from vault durability. |

## Error Contract

| Failure | Error/result | Caller recovery | Test |
| --- | --- | --- | --- |
| Invalid root-set ref | `CasError` with root-set ref validation code | choose an allowed ref namespace | ref validation unit test |
| Target OID missing | `CasError` with object-not-found metadata | repair source data or skip entry | Git-backed put test |
| Target type mismatch | `CasError` naming expected and actual type | correct caller metadata | object type test |
| Concurrent update conflict | `CasError` with conflict code and observed head | retry read-modify-write | CAS update test |
| Malformed root-set metadata | `CasError` with schema path | run doctor/repair or rewrite set | metadata decode test |
| Removed object still anchored elsewhere | successful removal plus `anchoredElsewhere` doctor fact | inspect other refs | prune-risk integration test |
| Object already pruned | missing-object doctor finding | restore from source or drop entry | doctor missing-object test |

## Security / Trust / Redaction Posture

- trust boundary: Git object database and configured persistence adapter
- authority checked: caller permission to update the selected root-set ref
- secret-bearing values: none introduced by the base root-set format
- redaction behavior: caller metadata must be treated as visible Git metadata
- log/report behavior: doctor output should print object IDs and entry names,
  but no secret payload bytes
- abuse concern: broad root-set refs can prevent GC from reclaiming large
  objects, so APIs and docs must make retention explicit

Root sets are not encrypted vaults. A private caller that needs confidential
names or metadata should not assume root sets hide entry names.

## Lower Modes

The lower mode is deterministic command and test output:

- unit tests for codecs and validation
- Git-backed tests for prune dry-run behavior
- doctor JSON output for root-set health
- witness commands under the design directory during implementation

## Accessibility Posture

This is not rendered UI work. Accessibility is preserved through linear docs,
plain CLI text, and machine-readable doctor output. No meaning should depend on
color, cursor position, or layout.

## User-Facing Text / Directionality

Visible text changes should be limited to docs, CLI help, doctor output, and
error messages. Text is English and left-to-right. Machine-readable doctor
facts should carry stable keys for:

- root-set ref
- head OID
- entry count
- missing objects
- prune-risky objects
- entries anchored elsewhere
- retention policy counts

## Agent Inspectability / Explainability Posture

Agents can inspect the result through:

- explicit root-set refs
- `doctor` facts that separate reachability from retention policy
- stable `CasError` codes
- Git-backed prune dry-run witnesses
- API docs that name whether a method is unrooted, root-set anchored, or vault
  durable

An agent should never need to parse arbitrary application JSON to decide
whether Git considers a tree reachable.

## Linked Invariants

- [I-001 - Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)
- Tests Are the Spec
- Runtime Truth Wins
- Hexagonal Architecture
- Docs Are Evidence, Not Proof
- Git Reachability Is the Storage Truth

## Design Alternatives Considered

### Option A: Tell callers to use the vault

Pros:

- no new storage format
- already GC-safe
- already documented

Cons:

- vault history intentionally preserves old generations
- evictable cache entries may stay reachable through historical vault commits
- callers must abuse durable asset semantics for cache state

### Option B: Add a `Locker` API

Pros:

- communicates protection
- easy to explain as "put this in the locker"

Cons:

- sounds like concurrency locking rather than Git reachability
- does not name the substrate mechanism
- can hide the distinction between application policy and Git reachability

### Option C: Add root sets

Pros:

- names the actual mechanism: a ref-backed reachability root
- fits both pinned and evictable retention policy
- gives doctor a concrete object to inspect
- keeps unrooted plumbing and vault history semantics intact

Cons:

- adds another public storage noun
- needs careful docs so callers do not confuse root sets with encrypted vaults
- large root sets may need sharding or streaming follow-up work

### Option D: Use pack `.keep` files for pinned data

Pros:

- Git-native retention behavior
- can make objects immune to ordinary repacking decisions

Cons:

- coarse repository maintenance primitive
- hard to express per-entry cache eviction
- not portable across all storage adapters
- poor fit for application-level repair and doctor output

## Decision

Choose Option C. Add `RootSet` as the first-class API noun for mutable
reachability roots.

`Locker` is a useful informal metaphor, but the implementation should expose
root sets because the product contract is not mutual exclusion. The contract is
"these object IDs are reachable from this ref-backed set right now."

## Proof Surface

The implementation must be proven through:

- actual surface under test: public library API plus Git-backed persistence
- first RED test: a tree added to a root set must not appear in
  `git prune -n --expire=now`
- second RED test: a tree removed from a root set must appear in
  `git prune -n --expire=now` when no other ref reaches it
- required witness command: focused root-set tests plus `npm test`
- non-acceptable proof: docs-only assertions, JSON OID presence, or a test that
  never asks Git about prune eligibility

## Implementation Slices

- Add root-set storage codec and validation tests.
- Add Git-backed reachability tests for add/remove behavior.
- Implement the root-set domain service and facade entry point.
- Add compare-and-swap update and conflict tests.
- Add doctor checks for root-set health and prune-risk findings.
- Update API docs, guide/walkthrough language, and release evidence.
- Track implementation, Git reachability proof, doctor/repair, docs, and
  release evidence in the unified slice issue #48.

Each slice should be independently reviewable and should close with behavior
tests or a witness.

## Tests To Write First

Behavior tests required:

- [x] Root-set `put()` anchors a tree so `git prune -n --expire=now` does not
      list the target tree or its reachable payload blobs.
- [x] Root-set `remove()` releases a tree so `git prune -n --expire=now` lists
      the target when no other ref reaches it.
- [x] `replace()` writes exactly the supplied live set and drops entries absent
      from the replacement.
- [x] Concurrent `replace()` with a stale expected head fails with a conflict
      error.
- [x] Invalid refs, names, OIDs, object types, and retention policies fail
      before writing Git objects.
- [x] Doctor reports missing root-set targets and malformed metadata.
- [x] Doctor separates `pinned` and `evictable` policy from `anchored`,
      `orphaned`, and `volatile` reachability.

Documentation/process tests, only if relevant:

- [x] API docs include a retention matrix for plumbing, root sets, and vault.
- [x] The design witness records prune dry-run commands and outputs.
- [x] GitHub issue links point to the goalpost and unified slice issue before active
      implementation.

Rule: documentation tests cannot be the only proof for implementation work.

## Acceptance Criteria

The work is done when:

- [x] Public API can create/open a root set and add, remove, replace, and list
      entries.
- [x] Root-set writes use compare-and-swap ref updates.
- [x] Current entries are Git-reachable from the root-set ref.
- [x] Removed entries are not retained by root-set history by default.
- [x] Git-backed tests prove add/remove prune dry-run behavior.
- [x] Doctor reports root-set integrity and prune-risk facts.
- [x] Docs clearly distinguish unrooted plumbing, root-set anchoring, and vault
      durability.
- [x] The unified GitHub implementation slice is opened and linked.
- [x] CI and local validation are green.

## Validation Plan

Commands expected before PR:

```bash
npx vitest run test/unit/root-set
npx vitest run test/integration/root-set
npx eslint .
npm test
npm run release:verify -- --skip-jsr
```

Implementation may adjust paths to match the actual test layout, but the
validation must include a Git-backed prune dry-run proof.

## Playback / Witness

Create `docs/design/0046-gc-retention-root-sets/witness/verification.md` during
implementation. It should include:

- focused root-set test commands and outputs
- prune dry-run command transcripts from a synthetic repository
- full unit-suite output
- release verifier output if run
- answers to whether each proof story passed

## Risks

Known risks:

- A root set can retain large objects indefinitely if callers never evict.
- Parentless commits remove built-in Git history, which may surprise users who
  expect vault-like audit behavior.
- Shallow or custom Git adapters may not expose enough object-type inspection
  for precise doctor output.
- Downstream repair can only anchor objects that still exist locally.
- Root-set metadata can leak names unless callers choose opaque entry names.

Mitigations:

- Keep the vocabulary explicit in API docs and doctor output.
- Make history retention an explicit future option, not the default.
- Start with Git-backed adapter proof before claiming custom adapter support.
- Document adoption-before-cleanup as the repair order.
- Treat metadata visibility like vault tree visibility in security docs.

## Follow-On Debt

Create GitHub issues for:

- repository-wide reachability classification for root-set doctor output
  ([#49](https://github.com/git-stunts/git-cas/issues/49))
- WARP state-cache migration onto root sets after the API lands
- root-set sharding or streaming list support if large sets need bounded reads
- optional historical root sets if any caller needs audit history
- CLI write commands if library-only repair is insufficient
- privacy-preserving root-set entry names if opaque cache indexes become common

## Tracker Disposition

| Issue | Role | Expected disposition |
| --- | --- | --- |
| https://github.com/git-stunts/git-cas/issues/38 | current `v6.1.0` goalpost | link this draft as scale/GC-safety design input |
| https://github.com/git-stunts/git-cas/issues/48 | unified root-set implementation slice | close after release proof and downstream adoption begin |

## Done Does Not Mean

When this lands, it does not prove:

- WARP has migrated its state cache
- already-pruned WARP payload trees can be recovered
- root sets are encrypted or metadata-private
- all third-party adapters support root sets
- pack `.keep` maintenance is unnecessary for every repository operator
- large root sets have bounded pagination ergonomics

## Retrospective

What changed from the design:

- Implementation stayed with one unified slice issue (#48) instead of splitting
  the work into several tracker issues.
- The first release has no caller-defined metadata field. Entry name, target
  OID, target type, and retention policy are the complete canonical record.
- `contains(name)` tests entry membership by name. It does not search by OID.
- Target validation required `GitPersistencePort.readObjectType()`, while
  enforcing parentless heads required `GitRefPort.resolveParents()`.
- `replace()` and `mutate()` expose `expectedHeadOid` so callers can guard a
  state derived from a specific generation; unguarded calls retain bounded
  retry behavior.
- The release gate serializes Bun unit files and all integration files to avoid
  runtime starvation and transient Git subprocess failures under contention.

What the tests proved:

- Current entries are real Git tree edges reachable from a root-set ref.
- Removing the only edge makes the target tree appear in an immediate prune
  dry-run without running destructive cleanup.
- Every root-set generation is parentless, stale guarded updates conflict, and
  unguarded mutations retry from freshly read state.
- Invalid targets do not publish a ref, and malformed state can be diagnosed
  and rebuilt from an authoritative entry list.
- The release verifier passed 12/12 steps and observed 5,521 tests across Node,
  Bun, Deno, and their integration suites.

What remains open:

- Repository-wide classification of objects anchored by other refs versus
  orphaned or volatile is outside a single root set's bounded doctor report.
- Large-set sharding or streaming, optional historical root sets, CLI mutation,
  and privacy-preserving entry names remain follow-on work.
- WARP must adopt existing live payloads before cleanup and provide its own
  doctor/repair path; already-pruned payloads remain unrecoverable.

PR:

- No PR. The maintainer authorized a direct `main` implementation and release
  for this cross-repository repair.
