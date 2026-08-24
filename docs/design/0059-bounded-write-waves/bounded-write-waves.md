---
title: 'PERF-0059 - Bounded Git Write Waves'
cycle: '0059'
task_id: 'bounded-write-waves'
legend: 'PERF'
release_home: 'v6.5.8'
issue: 'https://github.com/git-stunts/git-cas/issues/119'
goalpost_issue: 'https://github.com/git-stunts/git-cas/issues/119'
tracker_source: 'github'
status: 'landed'
base_commit: 'cc5028a9acb1bfa4d5483a1fb8f7e8a954c3ca9c'
owners:
  - '@git-stunts'
sponsors:
  human: 'James'
  agent: 'Codex'
blocking_issues: []
supersedes: []
superseded_by: null
created: '2026-08-23'
updated: '2026-08-23'
---

# PERF-0059 - Bounded Git Write Waves

## Linked Issue

- [#119 - Batch bounded Git write and retention waves](https://github.com/git-stunts/git-cas/issues/119)
- [#110 - Batch bounded sequences of small asset writes through Git](https://github.com/git-stunts/git-cas/issues/110)

## Linked Tracker

- Milestone: [`v6.5.8`](https://github.com/git-stunts/git-cas/milestone/18)
- Goalpost issue: [#119](https://github.com/git-stunts/git-cas/issues/119)
- Asset-write slice: [#110](https://github.com/git-stunts/git-cas/issues/110)
- Required substrate: [`plumbing#16`](https://github.com/git-stunts/plumbing/pull/16)
- Downstream consumer: [`git-warp#852`](https://github.com/git-stunts/git-warp/pull/852)

## Design Type

This design is primarily:

- [x] Runtime/API
- [x] Storage/substrate
- [x] Migration/release
- [ ] CLI/operator
- [x] Docs/public guidance
- [ ] TUI/visual surface
- [x] Test/tooling

## Decision Summary

`git-cas` will expose bounded, input-ordered asset and ordered-bundle batch
operations and mirror them through staging workspaces. Internally, a bounded
write-wave coordinator will admit independent blob and tree requests, use the
new Plumbing batch methods when present, and retain typed one-shot fallbacks.
Asset batches will complete their bounded store pipelines before emitting all
manifest trees in one final dependency wave.
Bundle batches will preplan the existing deterministic fanout graph, pipeline
all descriptor blobs, then pipeline tree layers bottom-up without changing one
serialized byte. Workspace batches will retain all returned handles in one
exact compare-and-swap RootSet generation. The Git adapter will also pipeline
metadata inspection and reuse one `update-ref --stdin` process while preserving
the existing symbolic-ref preflight and post-failure posture checks.

## Sponsored Human

An application operator wants git-warp and Think materialization to spend time
doing causal work rather than launching hundreds of tiny Git processes, while
retaining the existing Git-native object model, recovery tools, pruning safety,
and repository interoperability.

## Sponsored Agent

An agent needs explicit bounded batch APIs and machine-readable process
topology so it can choose efficient storage operations without receiving raw
Git session authority, guessing whether a fallback exists, or treating noisy
wall time as proof of semantic equivalence.

## Hill

By the end of this cycle, a bounded group of small assets or independent
bundles produces the same manifests, trees, handles, and OIDs as repeated
single calls, but Git process count scales with protocol and dependency waves.
A workspace batch returns only after all handles share one retained generation.
SHA-1 and SHA-256 real-Git witnesses prove identity, process topology, checked
ref behavior, bounded residency, failure cleanup, and session closure before
`v6.5.8` is published.

## Current Truth

- `GitObjectSessionPool.writeBlobs()` invokes `session.writeBlob()` once per
  item and has no metadata or tree batch method, so git-cas does not consume
  Plumbing's new pipelined methods.
  [cite: `src/infrastructure/adapters/GitObjectSessionPool.js#34-70@cc5028a9acb1bfa4d5483a1fb8f7e8a954c3ca9c`]
- `PageService.putBatch()` already collects one explicitly bounded page group,
  calls `persistence.writeBlobs()`, preserves input order, and verifies result
  cardinality.
  [cite: `src/domain/services/PageService.js#69-123@cc5028a9acb1bfa4d5483a1fb8f7e8a954c3ca9c`]
- `BundleFanoutBuilder` writes every descriptor with `writeBlob()` and every
  node with `writeTree()`. Descriptor content depends on member summaries, not
  the eventual OIDs of descriptor or child tree objects.
  [cite: `src/domain/services/BundleFanoutBuilder.js#145-213@cc5028a9acb1bfa4d5483a1fb8f7e8a954c3ca9c`]
- `StagingWorkspace` mirrors page batches only. Every asset or bundle call
  builds one artifact and immediately installs a new growing RootSet
  generation.
  [cite: `src/domain/services/StagingWorkspace.js#58-71@cc5028a9acb1bfa4d5483a1fb8f7e8a954c3ca9c`]
  [cite: `src/domain/services/StagingWorkspace.js#164-318@cc5028a9acb1bfa4d5483a1fb8f7e8a954c3ca9c`]
- `RootSet.replace()` receives an exact expected head from a workspace but
  still rereads and validates the current ref, commit, tree, and metadata before
  attempting the checked write.
  [cite: `src/domain/services/RootSet.js#98-109@cc5028a9acb1bfa4d5483a1fb8f7e8a954c3ca9c`]
  [cite: `src/domain/services/RootSet.js#197-224@cc5028a9acb1bfa4d5483a1fb8f7e8a954c3ca9c`]
- `GitRefAdapter.updateRef()` performs one symbolic-ref preflight and launches
  one `git update-ref --no-deref` child for every successful mutation.
  [cite: `src/infrastructure/adapters/GitRefAdapter.js#116-155@cc5028a9acb1bfa4d5483a1fb8f7e8a954c3ca9c`]
- The corrected git-warp reference benchmark at `d9ca35486` reports 641 cold
  and 349 incremental Git processes. The cold census includes 233
  `hash-object`, 66 `commit-tree`, 67 `symbolic-ref`, and 67 `update-ref`
  operations. This is consumer evidence, not a claim that every command comes
  from one git-cas surface.
- Plumbing PR #16 adds bounded `infoMany()`, `writeBlobs()`, `writeMany()`, and
  `openUpdateRefSession()` contracts. Its measured 1,000-operation protocol
  benchmarks reduce wall time by 48.0%, 41.6%, 87.4%, and 89.5% respectively,
  with exact ordered output identity. Plumbing v3.3.0 publishes those contracts
  from merge commit `b7067988209c63f09b2fe1ff8859aa6f98cdc933`.

## Measured Implementation Posture

At clean git-cas commit `59c9d1a0` against clean Plumbing commit `eee0dfd8`,
the five-sample SHA-1/SHA-256 witness records identical ordered handle digests
for individual and batch modes. Sixteen assets fall from 49 Git children to two
and sixteen workspace bundles fall from 147 to eight. Median wall time falls
86.6-87.3% and 90.9% respectively. Raising the explicit active-asset bound from
four to sixteen keeps the two-child floor, reduces typed interactions from 19
to seven, and trims another 17.9-22.1% from this fixture.

The readable analysis and exact JSON are committed under
[`witness/`](./witness/verification.md). These are implementation witnesses,
not release or downstream-consumer claims.

At clean git-cas commit `f34acd0e`, the same five-sample fixture consumes the
published `@git-stunts/plumbing@3.3.0` package from the registry. It reproduces
the exact 49-to-two asset and 147-to-eight workspace-bundle process topology,
with identical SHA-1/SHA-256 semantic digests. Median wall time falls
86.7-87.1% and 90.9-91.0% respectively. This closes dependency provenance; it
does not yet make a git-cas release or downstream-adoption claim.

## Problem

Persistent processes removed most process startup from reads, but the write
path still presents one semantic operation at a time to those processes and
publishes one workspace generation per artifact. A git-warp trie flush writes
many independent leaves, then many independent branches at each depth. The
current API prevents the consumer from expressing those natural dependency
waves, and git-cas therefore pays per-object descriptor writes, per-artifact
RootSet commits, per-ref preflight/update children, and redundant exact-head
readback. Replacing Git would discard capabilities and interoperability that
remain valuable; the unexhausted optimization is at the existing protocol and
domain boundaries.

## Scope

This cycle includes:

- Plumbing batch-method adoption for object metadata, blob writes, and tree
  writes, with feature-detected per-item fallbacks;
- one adapter-owned reusable update-ref session for successful checked updates;
- bounded, ordered `assets.putBatch()` and workspace asset batching;
- bounded, ordered `bundles.putOrderedBatch()` and workspace bundle batching;
- complete bundle graph preplanning under explicit bundle/member/descriptor
  limits, followed by one descriptor phase and bottom-up tree phases;
- shared validation state within a bundle batch so repeated immutable handles
  are not recursively revalidated;
- exact expected-generation RootSet replacement without pre-read or optimistic
  retry;
- one workspace RootSet generation for every successful artifact batch;
- direct target-type inspection through bounded metadata batches before a
  RootSet ref becomes reachable;
- typed unit, mutation-calibrated identity, SHA-1/SHA-256 real-Git process
  topology, failure, cancellation, and close tests;
- a durable JSON witness and downstream git-warp adoption obligation;
- publication order: Plumbing, git-cas, git-warp, then Think.

## Non-Goals

This cycle does not include:

- libgit2, gix, isomorphic-git, WASM Git, or another canonical object model;
- manually encoding commit objects or replacing `git commit-tree`;
- changing bundle descriptors, manifests, handles, ref names, or storage
  formats;
- a repository-lifetime fast-import process;
- weakening symbolic-ref containment, expected-old-OID checks, target type
  checks, or post-failure conflict classification;
- buffering an unbounded source, migration, bundle, or materialization;
- treating partial immutable object creation as a successfully completed batch;
- promising zero Git processes or a fixed wall-clock speedup;
- releasing git-warp or Think from this repository.

## Runtime / API Contract

The public batch surfaces are:

```ts
assets.putBatch({
  assets,
  maxBatchAssets?,
  maxBatchObjects?,
  maxBatchBytes?,
}): Promise<ReadonlyArray<StagedAsset>>;

bundles.putOrderedBatch({
  bundles,
  maxBatchBundles?,
  maxBatchMembers?,
  maxBatchObjects?,
  maxBatchBytes?,
}): Promise<ReadonlyArray<StagedBundle>>;

workspace.assets.putBatch(...): Promise<ReadonlyArray<WorkspaceRetainedAsset>>;
workspace.bundles.putOrderedBatch(...): Promise<ReadonlyArray<WorkspaceRetainedBundle>>;
```

`assets` is an array of existing `AssetPutOptions`. Each source remains an
async iterable. At most `maxBatchAssets` pipelines are active. Blob writes are
admitted into windows bounded by both `maxBatchObjects` and `maxBatchBytes`.
An individual chunk larger than the window byte limit uses the existing
one-shot write rather than being copied into an oversized batch. Results remain
in input order even when pipelines complete out of order.

`bundles` is an array of existing ordered-bundle options. The batch rejects
before persistence when bundle count or aggregate member count exceeds the
declared bound. It collects only that bounded group, uses the existing path,
member, fanout, nesting, and descriptor limits, and returns results in input
order. Existing single `put()` and streaming `putOrdered()` behavior remains
available for inputs that should not be preplanned.

Both top-level methods reject the whole call if any input fails. Successfully
written immutable objects may be reported as orphan staging evidence but no
partial result array is returned as a complete batch. Workspace mirrors retain
all results in one generation or reject with the complete staged-handle count
and original failure.

The RootSet exact surface is:

```ts
rootSet.replaceExact({ entries, expectedHeadOid }): Promise<RootSetMutation>;
```

`expectedHeadOid` is mandatory; `null` means the ref must be absent. This path
normalizes entries, writes and validates the new generation, and relies on the
checked no-dereference ref update as the concurrency decision. It does not read
the old generation, perform a no-op comparison, or retry after conflict.

## User Experience / Product Shape

There is no new visual surface. Library users receive explicit batch methods
with typed limits and the same staged/retained result nouns as single writes.
Existing callers remain source-compatible. The performance result is visible
through lower process counts and machine-readable witness data, not new CLI
timing prose.

## Data / State Model

| State                | Source of truth                       | Derived state                             | Invalid states                             | Reset behavior                                    | Serialization           | Determinism assumptions                                |
| -------------------- | ------------------------------------- | ----------------------------------------- | ------------------------------------------ | ------------------------------------------------- | ----------------------- | ------------------------------------------------------ |
| Asset batch input    | Ordered caller array and streams      | Bounded active pipelines                  | Excess count, invalid item, source failure | Reject batch; close/cancel active work            | Existing manifests      | Per-item persisted identity equals single `put()`      |
| Bundle batch plan    | Ordered members and current codecs    | Descriptor DAG and tree layers            | Excess count/bytes/depth, bad order/target | Reject with staging evidence                      | Existing bundle format  | Plan emits byte-identical descriptors and trees        |
| Write window         | Pending independent writes            | Ordered OID results                       | Wrong cardinality, protocol failure        | Poison window and reject all waiters              | Git protocols           | OID depends on type and bytes, not request grouping    |
| Workspace generation | Exact local generation and target map | One descriptor, RootSet tree, commit, ref | Concurrent head, symref, missing target    | Checked failure; caller retries whole wave        | Existing RootSet format | One successful wave has one generation                 |
| Ref session          | Adapter-owned child process           | Serialized successful transactions        | Unexpected status or process failure       | Terminate; later operation may open a new session | `update-ref --stdin`    | Each transaction retains explicit start/prepare/commit |

## Architecture / Anti-SLUDGE Posture

| Concern                         | Decision                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Domain changes                  | Asset and bundle services own semantic batches; RootSet owns exact replacement.                                  |
| Port changes                    | Persistence gains fallback `writeTrees()` and `readObjectInfos()` methods.                                       |
| Adapter changes                 | Git adapters consume typed Plumbing batch/session capabilities.                                                  |
| Boundary validation             | Public counts/bytes, member order, target types, OID cardinality, and exact heads validate before claims escape. |
| Runtime-backed nouns introduced | One internal bounded write-wave coordinator and one ref-session owner.                                           |
| Expected failure representation | Existing `CasError` families plus staged/orphan counts; no boolean success ambiguity.                            |
| Banned shortcuts avoided        | No raw session exposure, unbounded `Promise.all`, format fork, unchecked ref, or diagnostic-text-only conflict.  |

The write-wave coordinator is an internal scheduling boundary, not a second
persistence implementation. It delegates actual writes to `GitPersistencePort`
and exists only while one public batch is active.

## Cost / Residency Posture

| Surface                | Current cost                              | Target cost                                                   | Limit/budget                                                                 | Failure mode                                   |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| Blob group             | N session requests or N one-shot children | One request per bounded window                                | <= 256 objects, <= 64 MiB hard Plumbing ceiling; public lower bounds allowed | Reject/one-shot oversized item                 |
| Tree group             | N session requests                        | One request per independent tree layer/window                 | <= 256 trees, 65,536 entries, 64 MiB hard ceiling                            | Reject before protocol or poison session       |
| Metadata group         | N session requests                        | One request per bounded target group                          | <= 1,000 objects and 64 KiB command ceiling                                  | Drain then preserve per-target diagnosis       |
| Bundle batch           | N streaming builders                      | One bounded plan, one descriptor phase, bottom-up tree phases | Explicit bundles, members, descriptors, objects, and bytes                   | Reject entire result with staging evidence     |
| Asset batch            | N repeated stores                         | Bounded concurrent stores sharing write windows               | Explicit active assets, objects, and bytes; existing per-chunk bounds        | Reject entire result; cancel/drain active work |
| Workspace retention    | One generation per artifact               | One generation per dependency wave                            | Existing workspace target maximum                                            | Exact CAS conflict or retention failure        |
| Successful ref updates | One child per mutation                    | One reusable child per adapter lifetime/idle interval         | One serialized transaction at a time                                         | Session terminates and posture is inspected    |

No batch copies or retains an entire unbounded source. Aggregate live memory is
bounded by the configured active asset count, existing per-asset store
concurrency/chunk bounds, the admitted write window, and bounded result/plan
metadata. The witness records high-water counts and bytes rather than inferring
residency from process RSS alone.

## Determinism / Replay / Causality

Grouping changes scheduling and process topology only. Blob bytes, descriptor
bytes, tree entry order, manifest hashes, fanout summaries, object OIDs, handle
strings, input-to-result order, and checked ref preconditions remain identical.
Golden tests compare repeated singles with batch output in both object formats.
A named mutation that reverses one result mapping or alters one descriptor byte
must make the identity test fail.

## Git Substrate Impact

| Substrate area | Impact                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| blobs          | Existing blob encodings are submitted in bounded fast-import groups.                                      |
| trees          | Existing sorted mktree inputs are submitted in independent bottom-up groups.                              |
| commits        | Same parentless RootSet commits; fewer are created. `commit-tree` remains authoritative.                  |
| refs           | Same managed names and expected OIDs; successful updates may share one `update-ref --stdin` child.        |
| symrefs        | Existing preflight remains mandatory because supported Git cannot atomically assert ref type.             |
| object ids     | Must be identical between single and batch paths in SHA-1 and SHA-256 repositories.                       |
| pruning        | Every returned workspace batch is anchored before handles escape; dependency waves retain earlier layers. |
| release        | Plumbing v3.3.0 is published and pinned; v6.5.8 must publish before downstream adoption.                  |

## Compatibility / Migration Posture

| Concern                     | Decision                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Public API compatibility    | Additive batch methods; all single methods remain.                                        |
| Custom persistence adapters | Default port loops preserve behavior without batch capabilities.                          |
| Older Plumbing              | Feature detection retains typed per-item or one-shot behavior.                            |
| Storage compatibility       | No byte, format, handle, ref, or reachability-policy migration.                           |
| Downstream adoption         | git-warp feature-detects bundle-wave staging until v6.5.8 is its minimum dependency.      |
| Release note impact         | Record public methods, bounds, exact identity, process reduction, and intentional floors. |

## Error Contract

| Failure                               | Error/result                                                                                       | Caller recovery                           | Required proof              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------- |
| Batch count/member bound exceeded     | `INVALID_OPTIONS` or domain batch-limit error before Git                                           | Submit smaller windows                    | Unit boundary tests         |
| One object exceeds write-window bytes | Existing one-shot write                                                                            | Continue batch                            | Mixed-size real-Git test    |
| Batch protocol/cardinality failure    | Git/CAS error; no complete result array                                                            | Retry whole semantic batch                | Injected protocol tests     |
| Asset source/cancellation failure     | Existing store error plus batch index/staging evidence                                             | Retry or inspect orphans                  | Iterator cleanup tests      |
| Bundle member/descriptor failure      | Existing bundle error plus batch index/staging evidence                                            | Correct input; retry                      | Golden/failure tests        |
| RootSet target missing/wrong type     | Existing typed target error before ref update                                                      | Restore target; retry                     | Batched target test         |
| Exact RootSet head differs            | `ROOT_SET_CONFLICT`; no retry                                                                      | Reopen/rebuild workspace                  | Concurrency test            |
| Managed ref is symbolic               | `GIT_REF_CONFLICT`; referent unchanged                                                             | Repair ref posture                        | SHA-1/SHA-256 symref test   |
| Update-ref session fails ambiguously  | Inspect direct/symbolic/absent posture; preserve operational error unless expectation is disproved | Reopen adapter or retry at semantic owner | Injected and real-Git tests |
| Close fails                           | Aggregate local-resource error                                                                     | Treat adapter close as failed             | Lifecycle test              |

## Security / Trust / Redaction Posture

- Repository object metadata, ref posture, and all caller streams remain
  untrusted inputs.
- Batch limits validate before allocating protocol payloads or publishing
  success.
- Raw Git session objects never cross the adapter or public capability boundary.
- Checked writes retain `--no-deref`, symbolic-ref preflight, and independent
  post-failure posture inspection.
- Witnesses contain versions, counts, byte totals, OID digests, and semantic
  fingerprints, not payload bytes, secrets, or machine-local repository paths.
- Concurrent pruning is not disabled or hidden; each dependency wave must be
  retained before its handles are exposed to the next wave.

## Lower Modes

No visual UI changes. Human-readable Markdown and machine-readable JSON carry
the same bounds, topology, identity, fallback, failure, and lifecycle facts.
Neither depends on color or animation.

## Accessibility Posture

The API, design, changelog, and witnesses use a linear reading order and plain
text labels. Tables repeat their meaning in headers, and JSON exposes the same
evidence to assistive tools and agents.

## User-Facing Text / Directionality

Only English left-to-right API documentation, error text, and release notes
change. No positional words or visual-only status distinctions are introduced.

## Agent Inspectability / Explainability Posture

An agent can inspect requested/admitted/fallback object counts, admitted bytes,
protocol process count, protocol operation count, RootSet generation count,
active sessions before and after close, semantic digests, and per-scenario
identity. It does not need to scrape `ps`, infer batching from elapsed time, or
receive mutable persistence/session authority.

## Linked Invariants

- bounded inputs remain streaming outside explicit bounded planning windows;
- input order equals result order;
- persisted identity is independent of grouping and completion order;
- one failed item cannot make a partial result appear complete;
- every returned workspace handle is anchored by the reported exact generation;
- expected-head and no-dereference semantics decide every managed ref mutation;
- a failed ref transaction never retries blindly;
- sessionless and older-Plumbing fallbacks remain executable and tested;
- all adapter-owned children close deterministically;
- publication proceeds Plumbing, git-cas, git-warp, then Think.

## Design Alternatives Considered

### Rewrite persistence with libgit2, gix, or a native Node binding

This could remove process startup, but would duplicate Git semantics and lose
or reimplement capabilities already relied on here: exact refs and symrefs,
commit construction, object-format negotiation, alternates, repository config,
credential behavior, and ordinary Git recovery/inspection. The measured hot
paths still have unconsumed native Git batch protocols, so a rewrite is not the
next justified experiment.

### Keep only persistent per-item session calls

This removes child startup but retains one JavaScript-to-process write and one
response wait per object. Plumbing benchmarks show that request pipelining is a
separate material win, especially for metadata and trees.

### Run existing bundle builders concurrently behind a generic coordinator

This would batch some descriptor/tree requests with less code, but every root
descriptor is currently produced only after its index tree exists. That forces
an extra fast-import/mktree transition even though descriptor content does not
depend on the tree OID. Preplanning the bounded graph permits one descriptor
phase and is the lower-process design.

### Defer all workspace retention until the final materialization root

This minimizes commits but leaves intermediate objects unanchored across
dependency construction and permits concurrent pruning to invalidate the
build. Retaining page, leaf-bundle, and branch-depth waves is the safe floor.

### Remove symbolic-ref preflight once update-ref is persistent

`--no-deref` prevents following a symref but can replace the symref name itself.
Supported Git does not provide the newer transactional symref verification
needed to combine the type assertion with the update. Keep the preflight.

### Manually encode parentless commits and batch them as raw objects

This could remove `commit-tree` processes but creates a second commit encoding,
identity, timestamp, timezone, and future-signing implementation. Keep Git as
the commit authority until process census proves this residual dominates and a
separate compatibility design justifies the risk.

## Decision

Exhaust stock Git first. Add semantic asset and bundle batches, preplan bounded
bundle graphs, pipeline Plumbing requests, retain dependency waves once, skip
redundant RootSet readback under an exact expected head, and reuse successful
checked ref transactions. Preserve Git-authored commits, symbolic-ref safety,
one-shot/older-Plumbing fallbacks, and every existing serialized format.

## Proof Surface

The implementation must prove:

- public `assets.putBatch()` and `bundles.putOrderedBatch()` behavior;
- workspace mirrors return one shared generation per non-empty batch;
- repeated singles and batches produce the same ordered OIDs, manifests,
  handles, bundle descriptors, and tree bytes in SHA-1 and SHA-256 repositories;
- Plumbing batch methods are called once per bounded independent phase while
  older method-only sessions still work;
- exact RootSet replacement performs no old-generation read and still rejects
  a stale or symbolic head without mutating its referent;
- repeated successful updates use one update-ref child and close it;
- write/process/generation counts scale with windows and dependency waves;
- oversized items, input failures, protocol failures, cancellation, and close
  preserve deterministic cleanup and non-success semantics;
- downstream git-warp materialization retains its semantic fingerprint and
  crosses calibrated CPU/process gates.

Named mutation calibration:

1. Reverse two returned OIDs: the ordered-identity test must fail.
2. Alter one planned descriptor entry: the single-versus-batch tree identity
   test must fail.
3. Restore RootSet pre-read in the exact path: the command-count test must fail.
4. Replace one bundle-wave call with per-bundle calls: the generation-count
   test must fail.
5. Follow or overwrite a symbolic referent: the containment test must fail.

## Implementation Slices

1. Add RED port/adapter tests for metadata, blob, tree, and update-ref batch
   consumption plus older-Plumbing fallbacks.
2. Implement the session adoption and exact RootSet replacement path.
3. Add RED identity, bounds, and failure tests for public asset batches; then
   implement bounded write-wave scheduling.
4. Add RED bundle-plan identity and workspace-generation tests; then implement
   preplanned bundle batches and workspace mirrors.
5. Add SHA-1/SHA-256 process-topology integration tests and committed witness
   generation.
6. Validate all runtimes and package surfaces, update public docs/changelog,
   publish the implementation PR, and verify the released Plumbing dependency
   before the release candidate.
7. After v6.5.8 publication, adopt bundle waves in git-warp by page/leaf/depth
   and rerun its reference plus current-Think witnesses.

## Tests To Write First

- `GitObjectSessionPool` delegates to `infoMany`, `writeBlobs`, and `writeMany`
  exactly once and falls back to ordered per-item calls when methods are absent.
- `GitPersistenceAdapter.writeTrees()` and `readObjectInfos()` preserve order,
  cardinality, normalization, cache behavior, and typed missing-object errors.
- `GitRefAdapter` reuses one update-ref session, keeps one symbolic preflight per
  mutation, classifies conflicts from posture, and closes/poisons correctly.
- `RootSet.replaceExact()` writes under the supplied head without calling
  `read()` and rejects missing expected-head authority.
- asset batch golden, order, window, oversized fallback, source failure,
  cancellation, and wrong-cardinality tests.
- bundle batch golden, empty, fanout, aggregate-member, descriptor-byte,
  validation-cache, failure-staging, and result-order tests.
- workspace asset/bundle batch tests proving exactly one updateRef call and one
  generation across all returned witnesses.
- real-Git SHA-1/SHA-256 tests comparing object graphs and counting protocol
  children/operations before and after close.

## Acceptance Criteria

- [x] Plumbing PR #16 is reviewed, merged normally, released, and pinned by
      git-cas before v6.5.8 publication.
- [x] Public asset and ordered-bundle batches are explicitly bounded and
      preserve input-order output.
- [x] Golden SHA-1/SHA-256 tests prove persisted identity against repeated
      single operations.
- [x] Workspace batch results share exactly one reported generation and remain
      readable after pruning at each dependency-wave boundary.
- [x] Exact RootSet replacement performs zero old-generation reads and retains
      checked no-dereference conflict behavior.
- [x] Repeated successful checked updates use one update-ref process; every
      session is closed at adapter close.
- [x] Older/sessionless Plumbing tests exercise real fallbacks.
- [x] Failure and cancellation never return a partial batch as complete and
      expose bounded staging evidence.
- [x] The durable git-cas witness records lower process/protocol counts with
      identical semantics in both object formats.
- [ ] The downstream git-warp reference run materially lowers cold and
      incremental process count from 641 and 349 without regressing CPU,
      memory, oversized streaming, or semantic fingerprints.
- [x] `npm test`, `npx eslint .`, integration matrices, declarations, package
      checks, and the current-dependency release verifier pass.
- [x] The complete release verifier passes again after git-cas pins the released
      Plumbing dependency.

## Validation Plan

Run focused unit tests after each slice, then:

```sh
npm test
npx eslint .
npm run test:integration:node
npm run test:integration:bun
npm run test:integration:deno
npm run release:verify
```

The process witness runs isolated workers against temporary bare repositories
and records Git, runtime, Plumbing, OS, architecture, object format, input
sizes, samples, command/session topology, high-water bounds, semantic digests,
and close state. Docker integration separately proves pruning and runtime
behavior. Wall time and CPU are reported but process topology and identity are
the deterministic gates.

After publication, git-warp runs its counterbalanced base/head reference suite
and a deeper multi-patch fixture. Think then runs against released git-cas and
git-warp packages, never workspace links, before any downstream release claim.

## Playback / Witness

Human playback questions:

1. Are the same Git objects and handles produced?
2. How many Git children and RootSet generations remain per scenario?
3. Are all streams, batches, sessions, refs, and pruning boundaries still safe?
4. What residual commands form the measured optimization floor?

Agent playback questions:

1. Which capability and fallback handled every window?
2. Were bounds actually observed, not merely configured?
3. Did input order, semantic digests, and object graphs match?
4. Did all active session and stream counts reach zero on close?

Required artifacts:

- committed git-cas JSON witness plus readable summary;
- [v6.5.8 release-candidate witness](./witness/release-candidate.md);
- [v6.5.8 publication witness](./witness/release-publication.md);
- hosted CI URLs for exact implementation and release heads;
- git-warp counterbalanced reference JSON and deep-chain result;
- final Think current-mind semantic digest and process census.

## Risks

- Concurrent asset pipelines can multiply existing per-store chunk residency;
  mitigate with a conservative active-asset default and measured high-water
  evidence.
- Preplanned bundles trade streaming for lower protocol transitions; restrict
  the API with aggregate bundle/member/descriptor bounds and keep existing
  streaming single-bundle methods.
- A generic scheduler can deadlock if operations await writes that are never
  flushed; prove pending/settled wakeups and injected failure completion.
- Update-ref protocol failures can be ambiguous; never retry a failed
  transaction blindly and preserve structured posture inspection.
- Reducing RootSet generations can widen the unanchored interval inside one
  wave; do not cross a dependency boundary until that wave is retained.
- Benchmarks can accidentally wrap away optional capabilities, as git-warp's
  previous recorder did; assert capability fidelity and process topology in the
  harness itself.

## Follow-On Debt

- Deeper bundle planning may reveal a useful standalone planner abstraction;
  extract only after the batch path proves its boundaries.
- If `commit-tree` dominates the post-batch floor, open a separate capability
  study rather than manually encoding commits in this cycle.
- If symbolic-ref preflight dominates, reevaluate transactional symref commands
  only after the minimum supported Git version provides them.
- Native Git-library exploration remains a bounded experiment only if the
  exhausted stock-Git witness leaves a material, irreducible process floor.

## Tracker Disposition

- #119 owns the v6.5.8 release-scale outcome and closes through the verified
  publication-evidence PR.
- #110 owned the public small-asset batch slice and closed through implementation
  PR #120.
- New debt or ideas discovered during implementation become GitHub Issues; no
  repo-local backlog cards will be created.

## Done Does Not Mean

- git-warp or Think is released;
- every Git subprocess is gone;
- arbitrary large inputs may be buffered;
- external pruning is disabled;
- conflicts are retried invisibly;
- native Git alternatives are permanently rejected;
- local green tests substitute for reviewed dependency and package publication.

## Retrospective

The implementation exhausts the material stock-Git process startup and
round-trip waste exposed by the current git-cas API. The canonical witness
reduces assets from 49 children to the two-process blob/tree dependency floor
and workspace bundles from 147 children to an eight-process checked-retention
floor without changing handles in either object format. An explicit
concurrency sweep preserved the conservative four-source default while proving
the higher-throughput caller option.

The remaining child processes each preserve a capability boundary: Git object
identity, tree validation, direct target inspection, Git-authored commits,
symbolic-ref containment, or compare-and-swap publication. Removing one now
would require manual object encoding, weaker existence checks, or a broader
cross-layer lifetime for a marginal gain. git-cas publication is now closed:
the signed `v6.5.8` tag, trusted npm artifact, provenance, and final GitHub
Release all bind to reviewed merge `57b40553`. Downstream playback remains
intentionally open; git-warp must adopt semantic bundle waves before the
campaign can claim end-to-end improvement.

Implementation PR [#120](https://github.com/git-stunts/git-cas/pull/120)
merged normally as `a762a02ca9270b2ace05b98a3d3025c61927de2c`; its second
parent is the exact reviewed head
`8badb3194d1bed66e79dff1355cfcc765078ca11`. All 11 inline review findings
and the declaration finding were fixed with focused tests before merge. The
exact reviewed head passed GitHub CI and the complete local 14-stage release
verifier with 7,054 observed tests.

Release PR [#121](https://github.com/git-stunts/git-cas/pull/121) merged normally
as `57b40553703b71744c11d6c8e8c62e171683e502`. The exact reviewed release
merge passed all 14 verifier stages with 7,057 observed tests before signed tag
`v6.5.8` triggered successful release workflow
[`32690361682`](https://github.com/git-stunts/git-cas/actions/runs/32690361682).
The immutable registry, provenance, signature, and clean-room install evidence
is recorded in the
[publication witness](./witness/release-publication.md).
