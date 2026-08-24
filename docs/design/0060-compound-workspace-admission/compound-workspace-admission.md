---
title: 'PERF-0060 - Compound Workspace Admission'
cycle: '0060'
task_id: 'compound-workspace-admission'
legend: 'PERF'
release_home: 'v6.5.9'
issue: 'https://github.com/git-stunts/git-cas/issues/123'
goalpost_issue: 'https://github.com/git-stunts/git-cas/issues/123'
tracker_source: 'github'
status: 'active'
base_commit: '33738af7ce31f9117e9ced24ea20745a8541eea8'
owners:
  - '@git-stunts'
sponsors:
  human: 'James'
  agent: 'Codex'
blocking_issues: []
supersedes: []
superseded_by: null
created: '2026-08-24'
updated: '2026-08-24'
---

# PERF-0060 - Compound Workspace Admission

## Linked Issue

- [#123 - Compound staging-workspace admission into one retained generation](https://github.com/git-stunts/git-cas/issues/123)

## Linked Tracker

- Milestone: [`v6.5.9`](https://github.com/git-stunts/git-cas/milestone/19)
- Goalpost issue: [#123](https://github.com/git-stunts/git-cas/issues/123)
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

`StagingWorkspace` will add one bounded compound-admission operation for
dependency-ordered page and bundle batches. Provisional content-addressed
handles are returned through the scope for private callback composition. The
outer promise will return the callback value plus exact retention evidence only
after one checked workspace generation anchors every staged target. The
callback is trusted code: JavaScript cannot prevent it from leaking a handle by
side effect, and such leakage carries no retention witness. The operation will
reuse one git-cas-owned persistence scope, serialize sub-operations in
invocation order, enforce an explicit operation ceiling, close
deterministically, and expose no Plumbing or Git session authority. Existing
staging APIs and persisted formats remain unchanged.

## Sponsored Human

An application operator wants dependency-ordered materialization to pay for one
temporary-retention publication rather than one publication per construction
wave, so that Think capture and reading spend time on causal work instead of
launching dozens of redundant Git processes, without weakening pruning safety
or changing retained data.

## Sponsored Agent

An agent needs a bounded, typed compound surface and exact generation evidence
so it can build a content-addressed dependency graph efficiently without
receiving an unretained handle through the outer result, inferring session
lifetime, or receiving raw Git process authority.

## Hill

By the end of this cycle, a caller can build several dependent page and bundle
waves inside one `StagingWorkspace` compound operation and receive its result
only after one exact RootSet generation retains every staged target. Real Git
tests and a SHA-1/SHA-256 witness prove identical handles, one generation,
failure containment, immediate-prune safety, bounded operation count, closed
sessions, and a materially smaller Git child census.

## Current Truth

- Each workspace page or bundle batch calls its underlying service and then
  immediately installs the workspace's complete growing target set. This
  correctly anchors returned handles but creates one RootSet generation per
  dependency wave.
  [cite: `src/domain/services/StagingWorkspace.js#59-78@33738af7ce31f9117e9ced24ea20745a8541eea8`]
  [cite: `src/domain/services/StagingWorkspace.js#216-283@33738af7ce31f9117e9ced24ea20745a8541eea8`]
- Installation writes a new lease page, RootSet metadata, tree, parentless
  commit, and checked ref update before updating the in-memory generation and
  target set.
  [cite: `src/domain/services/StagingWorkspace.js#285-330@33738af7ce31f9117e9ced24ea20745a8541eea8`]
- Page batches already accept an operation-owned persistence view. Bundle
  batches use a private write scope and already route inline page batches
  through the same scoped persistence.
  [cite: `src/domain/services/PageService.js#70-140@33738af7ce31f9117e9ced24ea20745a8541eea8`]
  [cite: `src/domain/services/BundleService.js#101-125@33738af7ce31f9117e9ced24ea20745a8541eea8`]
  [cite: `src/domain/services/BundleService.js#430-449@33738af7ce31f9117e9ced24ea20745a8541eea8`]
- `GitPersistenceAdapter.withWriteScope()` owns deterministic session closure.
  Its scope can preserve one fast-import process across dependent blob phases
  while retiring stale mktree sessions whenever a new pack becomes visible.
  [cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#160-177@33738af7ce31f9117e9ced24ea20745a8541eea8`]
  [cite: `src/infrastructure/adapters/GitPersistenceWriteScope.js#8-95@33738af7ce31f9117e9ced24ea20745a8541eea8`]
- The public workspace declaration exposes only independently retained
  singleton and batch calls plus checkpoint, renew, promotion, and release. It
  has no compound scope.
  [cite: `index.d.ts#1667-1708@33738af7ce31f9117e9ced24ea20745a8541eea8`]
- git-warp's current exact-head hosted benchmark reduces cold materialization
  from 781 to 139 Git children and incremental materialization from 372 to 149,
  with identical semantic fingerprints. The survivor census includes 60
  `hash-object`, 21 `commit-tree`, 22 `symbolic-ref`, and 21 checked
  `update-ref` operations. These are downstream observations, not universal
  git-cas costs.

## Problem

The safe public API makes each dependency wave independently authoritative.
That is necessary when a handle escapes to arbitrary caller code, but redundant
when all intermediate handles remain private to one bounded construction. A
dependency graph cannot be supplied as one static input because parent bundle
members require child OIDs that Git has not produced yet. Without a compound
scope, the caller must choose between repeated retention publication or unsafe
unanchored handles outside a declared operation.

## Scope

This cycle includes:

- one generic workspace compound operation for page and ordered-bundle batch
  construction;
- handle-only provisional results inside the callback;
- an explicit default and maximum sub-operation count;
- deterministic invocation-order serialization and failure poisoning;
- one operation-owned Git persistence scope;
- one final exact workspace generation for all newly staged and previously
  retained targets;
- exact retention evidence paired with the callback value;
- unit, declaration, real-Git pruning, failure, lifecycle, and benchmark proof;
- public docs, architecture, changelog, design witness, and v6.5.9 release
  evidence.

## Non-Goals

This cycle does not include:

- cross-workspace or cross-ref transactions;
- arbitrary singleton asset composition inside the first compound profile;
- returning provisional staged objects as if they were already retained;
- a declarative git-warp trie or graph planner in git-cas;
- manual blob, tree, or commit OID derivation;
- a new storage format, ref namespace, descriptor version, or migration;
- weakening existing independently retained workspace methods;
- holding a process beyond the bounded callback and final installation.

## Runtime / API Contract

The public shape is conceptually:

```ts
const admitted = await workspace.batch({
  maxOperations: 16,
  operation: async (scope) => {
    const pages = await scope.pages.putBatch(pageOptions);
    const leaves = await scope.bundles.putOrderedBatch({
      bundles: pages.map((handle) => ({ members: [['leaf/data', handle]] })),
    });
    const roots = await scope.bundles.putOrderedBatch({
      bundles: [{ members: leaves.map((handle, index) => [`child/${index}`, handle]) }],
    });
    return roots[0];
  },
});

admitted.value; // callback result, visible only after retention
admitted.retention; // exact WorkspaceCheckpointResult
```

Contract laws:

1. `operation` is required and called exactly once.
2. `maxOperations` is a positive safe integer no larger than the exported hard
   ceiling; each scope method invocation consumes one operation. The first
   invocation past that ceiling poisons the admission immediately, and later
   calls reuse that refusal without extending the bounded execution queue.
3. Scope methods are serialized by invocation order even if the callback starts
   them concurrently.
4. Scope page and bundle methods preserve the existing per-call batch bounds,
   input order, validation, handles, and object identity, but return only frozen
   handle arrays.
5. The scope becomes closed before the outer promise settles. Any escaped scope
   invocation rejects without writing.
6. An empty compound operation rejects without moving the workspace ref.
7. Success installs the union of prior workspace targets and all compound
   targets exactly once. `retention` names that generation and its witnesses.
8. The callback value is not exposed unless object-session closure and exact
   retention both succeed.
9. Callback or sub-operation failure poisons queued later work, closes the
   object scope, preserves the previous workspace generation, and returns no
   callback value or retained subset.
10. Immutable objects written before failure may remain unreachable for Git's
    normal reclamation. That is not a partial admission.

## User Experience / Product Shape

There is no rendered interface. The user-visible surface is the package API,
typed declarations, stable error codes, release notes, and machine-readable
benchmark witness.

## Data / State Model

| State                      | Source of truth                                   | Derived state                     | Invalid states                                               | Reset behavior                                         | Serialization                          | Determinism assumptions                      |
| -------------------------- | ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------- | -------------------------------------------- |
| Prior workspace generation | checked workspace ref                             | in-memory target map              | ref differs from expected generation                         | caller releases or retries with a new workspace        | existing RootSet tree and lease page   | exact expected-head authority                |
| Open compound scope        | in-process bounded operation                      | ordered provisional handle ledger | escaped use, excessive operations, queued work after failure | scope closes on success or failure                     | none                                   | invocation order defines execution order     |
| Provisional object graph   | Git immutable objects plus staged-target evidence | handle-only callback values       | handle cardinality/type mismatch                             | unreachable objects are reclaimable                    | existing blobs and bundle trees        | existing page/bundle codecs define OIDs      |
| Admitted compound result   | one checked workspace generation                  | retention witnesses               | callback result exposed without exact retention              | release, checkpoint, or promotion follows existing law | unchanged workspace descriptor version | canonical target order and Git object format |

## Architecture / Anti-SLUDGE Posture

| Concern                         | Decision                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain changes                  | Add a named compound-operation coordinator; keep service composition out of `StagingWorkspace` helper corridors.                                |
| Port changes                    | None below git-cas; the public workspace capability gains one semantic method.                                                                  |
| Adapter changes                 | Reuse `GitPersistenceAdapter.withWriteScope()`; expose no adapter or session object publicly.                                                   |
| Boundary validation             | Validate callback, operation limits, method lifecycle, result cardinality, and staged target evidence at the owning boundary.                   |
| Runtime-backed nouns introduced | A compound workspace scope and admitted result with explicit open/closed and retained semantics.                                                |
| Expected failure representation | Existing `CasError` codes for invalid options, workspace state, and retention; preserve original storage failures and aggregate close failures. |
| Banned shortcuts avoided        | No raw Git commands in domain code, no content-hash OID guessing, no boolean mode flags, no unbounded task queue, and no git-warp vocabulary.   |

## Cost / Residency Posture

| Surface                        | Current cost                            | Target cost                               | Limit/budget                                        | Failure mode                                     |
| ------------------------------ | --------------------------------------- | ----------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Workspace generations          | one per dependent batch                 | one per successful compound operation     | one exact checked update                            | no generation movement on failure                |
| Fast-import sessions           | one per bounded service batch           | one per compound operation when supported | scope lifetime plus existing 64 MiB per-blob cutoff | deterministic close; fallback remains executable |
| Mktree sessions                | reopened after newly checkpointed packs | unchanged dependency-wave floor           | one active session at a time                        | deterministic retire/reopen                      |
| Provisional target ledger      | not applicable across public calls      | linear in staged targets                  | existing 100,000 workspace-target cap               | reject before ref movement                       |
| Compound sub-operations        | not available                           | linear, serialized                        | conservative default; hard exported maximum         | typed invalid-options failure                    |
| Per-call page/bundle residency | explicitly bounded                      | unchanged                                 | existing page/bundle item and byte limits           | existing typed batch-limit failures              |

No design claim treats wall time as deterministic. Object identity, generation
count, command/session topology, and closure state are the hard gates.

## Determinism / Replay / Causality

- Invocation order is recorded when a scope method is called, not when its
  promise happens to settle.
- The same ordered inputs must yield the same page and bundle handles under
  sequential retained calls and compound admission in SHA-1 and SHA-256 repos.
- The final target set uses the existing canonical handle ordering.
- The final generation is new causal retention evidence; it does not alter the
  identity or history of any immutable payload object.
- Failed compound work emits no admitted result and does not advance the
  workspace generation.

## Git Substrate Impact

| Substrate area          | Impact                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| refs                    | One existing workspace ref moves once per successful compound operation instead of once per sub-operation. |
| commits                 | One existing parentless RootSet generation is authored; no commit format change.                           |
| trees/blobs             | Existing page, bundle, lease, metadata, and RootSet encodings remain byte-identical.                       |
| object ids              | Determined by existing Git and codec behavior; grouping must not change handles.                           |
| tag/release behavior    | Publish as git-cas v6.5.9 before downstream adoption.                                                      |
| migration compatibility | No migration; existing repositories and workspaces remain readable.                                        |

## Compatibility / Migration Posture

| Concern                    | Decision                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Public API compatibility   | Additive method; all existing methods retain their contracts.                                                                           |
| Package export changes     | Add declarations for compound scope/result and limits.                                                                                  |
| Storage/read compatibility | No serialized bytes, ref layout or namespaces, or readers change; successful compound admission reduces workspace-ref update frequency. |
| Legacy behavior retained   | Singleton and independently retained batch calls remain available and tested.                                                           |
| Deprecation behavior       | None.                                                                                                                                   |
| Migration path             | None required.                                                                                                                          |
| Release note impact        | State explicitly that v6.5.9 is migration-free and changes physical admission cost only.                                                |

## Error Contract

| Failure                                     | Error/result                                                      | Caller recovery                                 | Test                    |
| ------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- | ----------------------- |
| Missing callback or invalid operation bound | `INVALID_OPTIONS`                                                 | correct options                                 | boundary table test     |
| Empty compound work                         | `INVALID_OPTIONS`                                                 | stage at least one bounded batch                | no-ref-movement test    |
| Operation ceiling exceeded                  | `INVALID_OPTIONS` with observed and maximum counts                | split into multiple compound operations         | hostile call-count test |
| Escaped scope used after closure            | `WORKSPACE_STATE_INVALID`                                         | do not retain or reuse scope                    | lifecycle test          |
| Page/bundle validation failure              | existing typed service error                                      | correct that sub-operation                      | earliest-failure test   |
| Callback and close both fail                | `AggregateError` preserving both failures                         | inspect both causes; retry with a new operation | injected close test     |
| Final exact retention fails                 | `WORKSPACE_RETENTION_FAILED` with staged count and original error | inspect ref posture; retry safely               | no-partial-result test  |

## Security / Trust / Redaction Posture

- trust boundary: caller code may use only the bounded semantic scope;
- authority or capability checked: exact workspace expected-head mutation;
- secret-bearing values: unchanged; payload bytes are never added to evidence;
- redaction behavior: benchmark artifacts contain counts, versions, OIDs, and
  digests but no payloads or machine-local paths;
- log/report behavior: failures report counts and operation names, not content;
- abuse or replay concern: scope calls are structurally bounded, and an escaped
  scope is closed before caller-visible settlement; callback time, CPU, memory,
  and side effects remain caller-controlled.

## Lower Modes

No visual mode exists. Public declarations, plain-text docs, structured errors,
and JSON witness data expose the same operation, generation, identity, bound,
failure, and lifecycle facts.

## Accessibility Posture

Docs and witnesses follow linear reading order, use descriptive table headers,
and repeat status in text instead of relying on color or layout. The API does
not require a visual interface.

## User-Facing Text / Directionality

English API docs, error messages, changelog entries, and witness labels change.
They use logical sequence words such as prior, next, and final; no directional
screen placement or visual-only distinction is introduced.

## Agent Inspectability / Explainability Posture

An agent can inspect configured and observed sub-operation counts, staged and
retained handle counts, exact generation count, command/session census,
semantic digests, object formats, prior and resulting ref OIDs, and active
session count after closure. It need not scrape `ps`, parse timing prose, or
infer whether intermediate results escaped.

## Linked Invariants

- every handle visible after a successful workspace method is already anchored;
- provisional handles exist only inside a bounded callback;
- one failed operation cannot produce a partial caller-visible success;
- input order equals handle order;
- persisted identity does not depend on sequential versus compound grouping;
- the prior workspace generation remains authoritative until one exact final
  checked update succeeds;
- no-dereference and symbolic-ref containment remain unchanged;
- Git-authored object and commit semantics remain authoritative;
- all child processes and queued operations settle before the outer promise;
- release order remains Plumbing, git-cas, git-warp, then Think.

## Design Alternatives Considered

### Continue publishing every dependency wave

Pros:

- already shipped and safe;
- every intermediate handle can escape immediately.

Cons:

- repeated lease, metadata, tree, commit, and ref work dominates the remaining
  downstream process census;
- physical publication cost scales with dependency depth even when nothing
  escapes.

### Let git-warp use unretained global page and bundle APIs

Pros:

- removes intermediate workspace generations with no git-cas API change.

Cons:

- violates the materialization workspace's retention contract;
- concurrent pruning can delete objects between dependency waves;
- moves a substrate safety decision into one consumer adapter.

### Accept a static declarative dependency DAG

Pros:

- one bounded input and no callback lifecycle.

Cons:

- parent members require child OIDs not known before Git writes them;
- token references would create a second graph language and leak git-warp-like
  topology into git-cas.

### Open a public Git/Plumbing session

Pros:

- maximum caller control.

Cons:

- breaks the semantic storage boundary, leaks process lifecycle, and makes
  correctness depend on caller-specific session choreography.

### Add a bounded compound callback

Pros:

- models the actual point at which provisional handles may safely exist;
- keeps Git sessions private;
- permits dependent writes and one final authority transition;
- is generic across content-addressed applications.

Cons:

- callback lifecycle and queued failure behavior require explicit tests;
- the operation must be structurally bounded to avoid turning a session into an
  arbitrary long-lived resource.

## Decision

Add the bounded compound callback. It is the smallest generic semantic boundary
that preserves the existing external retention law while removing redundant
physical publication. Begin with page and ordered-bundle batches because they
cover the proven downstream dependency graph and already have explicit item and
byte limits. Do not generalize further until another measured workload requires
it.

## Proof Surface

The implementation must be proven through:

- actual surface under test: public `StagingWorkspace.batch()` against memory
  adapters and real SHA-1/SHA-256 Git repositories;
- first RED test: two dependent page/bundle waves yield one checked workspace
  update rather than one update per wave;
- required witness command: a counterbalanced sequential-versus-compound
  diagnostic that records semantic digests, Git child/interactions, generation
  count, operation limits, memory high water, and closure state;
- non-acceptable proof: documentation-only tests, elapsed time without object
  identity, mocks without real-Git pruning, or lower process counts obtained by
  bypassing retention.

Named mutation calibration:

1. Install after every sub-operation: generation-count test fails.
2. Expose the callback value before installation: injected retention failure
   observes an illegal success.
3. Execute concurrent calls by settlement order: deterministic order test
   fails.
4. Permit one operation beyond the configured ceiling: hostile bound test
   fails.
5. Reuse an escaped scope: lifecycle test fails.
6. Drop one staged target from final installation: prune/readback test fails.
7. Open a new fast-import session per sub-operation: process-topology witness
   fails.

## Implementation Slices

1. Add RED domain and declaration tests for the bounded callback, handle-only
   scope, one generation, lifecycle, and failure laws.
2. Factor a named compound coordinator and scoped page/bundle service methods;
   implement one exact final installation.
3. Add real-Git SHA-1/SHA-256 immediate-prune and no-generation-on-failure tests.
4. Add the counterbalanced process/identity witness and calibrate its mutation
   checks.
5. Update README, API docs, architecture, changelog, design witness, and release
   evidence; run all runtime and package gates.
6. Publish v6.5.9, consume the registry artifact in git-warp, and rerun its
   exact reference plus migration-compatibility proof.

## Tests To Write First

- [x] Two dependent page/bundle calls share one resulting generation and one
      checked update.
- [x] The callback receives frozen handle arrays, while the outer result pairs
      its value with exact retention evidence.
- [x] Concurrent scope invocations execute in invocation order.
- [x] Invalid, empty, excessive, failed, and escaped operations never move the
      prior workspace generation or expose a partial result.
- [x] A callback failure plus a session-close failure preserves both causes.
- [x] Existing independently retained APIs remain unchanged.
- [x] SHA-1 and SHA-256 compound handles equal sequential handles byte for byte.
- [x] Immediate prune after compound success preserves every retained support
      object; release followed by prune reclaims them.
- [x] The process witness detects per-wave retention publication and per-wave
      fast-import reopening mutations.

## Acceptance Criteria

The work is done when:

- [x] Public behavior tests prove provisional scope, exact final retention, and
      one-generation semantics.
- [x] Operation count, per-call bytes/items, targets, queues, and session
      lifetime are explicitly bounded.
- [x] Existing page/bundle bytes and handles are identical under sequential and
      compound modes in SHA-1 and SHA-256 repositories.
- [x] Failure tests prove no ref movement and no caller-visible partial result.
- [x] Real-Git pruning proves retained success and releasable cleanup.
- [x] Machine evidence reports a material process reduction and zero active
      sessions after close.
- [x] Existing public APIs, storage readers, v6 workspaces, and release surfaces
      remain compatible with no migration.
- [x] Public docs, architecture, changelog, and release notes are accurate.
- [ ] Issue and PR are linked; CI and complete local validation are green.
- [ ] Released v6.5.9 is consumed from the registry by git-warp before any
      downstream performance claim.

## Validation Plan

```sh
npx vitest run test/unit/domain/services/StagingWorkspace.compound.test.js
npm test
npx eslint .
npm run test:integration:node
npm run test:integration:bun
npm run test:integration:deno
npm run release:verify
```

The witness will run isolated workers against temporary SHA-1 and SHA-256 bare
repositories. It will compare equivalent sequential-retained and compound
operations over repeated samples and reject semantic-digest, cardinality,
generation, process-topology, bound, or closure disagreement.

## Playback / Witness

Human playback questions:

1. Did grouping change any handle, byte, or retained support graph?
2. Did all dependency waves become reachable through one exact generation?
3. How many Git children and ref publications disappeared?
4. What commands remain, and why are they required?

Agent playback questions:

1. Were configured operation and batch bounds observed?
2. Did invocation order equal execution and result order?
3. Did failure preserve the prior ref and withhold the callback value?
4. Were all sessions, queued calls, and workspace resources closed?

Required artifacts:

- machine-readable sequential/compound SHA-1/SHA-256 witness;
- readable verification summary with residual process floor;
- real-Git prune test output;
- exact-head hosted CI URLs;
- v6.5.9 candidate and publication identity evidence;
- downstream git-warp exact-head benchmark and migrated-v18 read gate.

## Risks

Known risks:

- caller code may stall while owning the callback;
- an escaped scope may be invoked after close;
- concurrent callback calls may reorder writes or failures;
- target accumulation may approach the existing workspace cap;
- a pack checkpoint invalidates an already-open mktree object snapshot;
- reducing generations widens the private unanchored interval.
- trusted callback code can leak provisional handles through side effects.

Mitigations:

- bound method invocations and every individual page/bundle input;
- close and poison the scope before outer settlement;
- serialize by invocation order and stop queued work after first failure;
- enforce the existing workspace target ceiling before ref movement;
- keep the existing mktree retire/reopen rule after new packed objects;
- document callback-side-effect leakage as outside the contract and perform one
  exact final retention before the outer operation returns any value.

## Follow-On Debt

The clean witness leaves 18 `mktree` children in the 33-operation compound
profile because descriptor packs must become visible before dependent tree
waves. Measure the released API in git-warp before deciding whether a typed
tree-writing protocol is justified. If it is, open a separate Plumbing/git-cas
issue with SHA-1/SHA-256 identity and validation evidence rather than widening
this compound API. Singleton assets or a wider operation profile require the
same evidence and separate scope.

## Tracker Disposition

| Issue                                                             | Role                | Expected disposition             |
| ----------------------------------------------------------------- | ------------------- | -------------------------------- |
| [git-cas#123](https://github.com/git-stunts/git-cas/issues/123)   | primary goalpost    | close after publication evidence |
| [git-warp#851](https://github.com/git-stunts/git-warp/issues/851) | downstream consumer | update after released adoption   |

## Done Does Not Mean

When this lands, it does not prove:

- one Git child for an arbitrary dependency graph;
- a cross-ref, cross-workspace, or application transaction;
- that wall time is identical on every host;
- that mktree can safely observe packs created after its ODB snapshot;
- that manual object encoding or a native Git implementation is justified;
- any storage migration or change to domain atomicity.
- a capability sandbox that can prevent trusted callback side effects.

## Retrospective

The implementation and clean witness are complete. A 33-operation,
81-handle graph fell from 200 to 23 Git children and from 33 retained
generations to one in both SHA-1 and SHA-256 repositories. Median wall time
fell by 80.5% with identical handle digests. The remaining work is hosted
multi-runtime review, v6.5.9 publication, and released downstream adoption.

PR:

- [#124](https://github.com/git-stunts/git-cas/pull/124)
