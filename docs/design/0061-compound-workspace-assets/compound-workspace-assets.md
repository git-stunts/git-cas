---
title: 'PERF-0061 - Compound Workspace Assets and Exact Roots'
cycle: '0061'
task_id: 'compound-workspace-assets'
legend: 'PERF'
release_home: 'v6.5.10'
issue: 'https://github.com/git-stunts/git-cas/issues/127'
goalpost_issue: 'https://github.com/git-stunts/git-cas/issues/127'
tracker_source: 'github'
status: 'landed'
base_commit: '6d5a43e2853f61b3c12d5000e81ef7832c00b8d2'
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

# PERF-0061 - Compound Workspace Assets and Exact Roots

## Linked Issue

- [#127 - Complete compound workspace admission for assets and exact roots](https://github.com/git-stunts/git-cas/issues/127)

## Linked Tracker

- Milestone: [`v6.5.10`](https://github.com/git-stunts/git-cas/milestone/20)
- Goalpost issue: [#127](https://github.com/git-stunts/git-cas/issues/127)
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

Complete the bounded `StagingWorkspace.batch()` surface introduced in v6.5.9
by admitting asset batches through the same private persistence scope as page
and ordered-bundle waves. Add an optional synchronous retention selector over
the callback result so callers can anchor only explicitly selected newly staged
terminal roots while preserving all roots retained before the compound call.
Every selected input is parsed as a canonical application handle and must name
a handle staged by that exact compound admission. Existing methods, object
bytes, handles, ref layout, and workspace formats remain unchanged.

## Sponsored Human

An application operator wants one materialization graph admission to include
its replay and provenance payloads, support bundles, descriptor, and terminal
bundle so Git process and ref-publication costs do not scale with construction
depth, without weakening pruning safety or retaining every intermediate as a
top-level workspace root.

## Sponsored Agent

An agent needs a typed, bounded asset operation and exact selected-root evidence
so it can explain which terminal result became authoritative without inferring
transitive reachability, accepting string-like impostors, or receiving raw Git
session authority.

## Hill

By the end of this cycle, a caller can stage bounded assets, pages, and bundles
in dependency order inside one compound callback, select terminal handles from
that exact callback, and receive one exact workspace generation. Unit and real
SHA-1/SHA-256 Git tests prove identity, ordering, selection validation, failure
containment, pruning safety, and deterministic resource closure.

## Current Truth

- v6.5.9 compound admission owns one persistence scope and one final
  installation, but its scope exposes only page and ordered-bundle batches.
  Asset batches necessarily open a separate write scope and workspace
  installation. [cite: `src/domain/services/WorkspaceCompoundScope.js@6d5a43e2853f61b3c12d5000e81ef7832c00b8d2`]
- `AssetService.putBatch()` already has bounded input count, object count, byte
  count, concurrency, ordered output, failure aggregation, and write-scope
  ownership. Its internal batch path can be reused without changing asset
  identity. [cite: `src/domain/services/AssetService.js@6d5a43e2853f61b3c12d5000e81ef7832c00b8d2`]
- Successful compound admission currently retains every newly staged page and
  bundle as a direct workspace target, even when one terminal bundle already
  reaches all support transitively. [cite: `src/domain/services/WorkspaceCompoundAdmission.js@6d5a43e2853f61b3c12d5000e81ef7832c00b8d2`]
- A controlled downstream git-warp corpus with 65 nodes, 65 base patches, and
  five incremental patches measured 139 cold and 149 incremental Git commands
  before compound adoption. The asset-inclusive prototype measured 50 and 60
  respectively with equal semantic fingerprints, correct replay counts, and
  unchanged warm-path command count. These are downstream workload results,
  not universal git-cas latency guarantees.

## Problem

The remaining asset boundary forces a content-addressed graph to leave the
compound scope before it can build bundles referring to asset OIDs. That costs
extra persistence scopes and workspace generations. Retaining every
intermediate staged handle also bloats the direct root set even when a terminal
root already owns the complete transitive graph. A selector that accepts
arbitrary string-like values would be unsafe, while a selector that can name
old or globally staged handles would silently broaden the compound operation's
authority.

## Scope

This cycle includes:

- `scope.assets.putBatch()` with the existing public asset batch options and
  bounds;
- an internal asset batch path that joins an existing persistence write scope;
- optional synchronous `retain(value)` selection of newly staged application
  handles;
- canonical parsing, exact staged-membership validation, stable deduplication,
  and frozen selected roots;
- preservation of every workspace target retained before the compound call;
- default retain-all behavior for v6.5.9 callers;
- unit, public declaration, SHA-1/SHA-256 Git, prune, failure, and lifecycle
  proof;
- public documentation, architecture, changelog, and release evidence.

## Non-Goals

This cycle does not include:

- a transaction across workspaces, refs, repositories, or publications;
- arbitrary singleton operations in a compound scope;
- selecting a handle not staged by the current compound call;
- dropping roots retained before the current compound call;
- changing asset encryption, chunking, manifests, handles, refs, or workspace
  descriptors;
- a git-warp graph or trie abstraction in git-cas;
- elapsed-time guarantees or a migration.

## Runtime / API Contract

```ts
const admitted = await workspace.batch({
  maxOperations: 3,
  operation: async (scope) => {
    const [asset] = await scope.assets.putBatch({ assets: [assetOptions] });
    const [support] = await scope.bundles.putOrderedBatch({
      bundles: [{ members: [['payload', asset]] }],
    });
    const [terminal] = await scope.bundles.putOrderedBatch({
      bundles: [{ members: [['support', support]] }],
    });
    return terminal;
  },
  retain: (terminal) => [terminal],
});
```

Contract laws:

1. `scope.assets.putBatch()` consumes one compound operation and preserves the
   existing asset batch's item, byte, object, concurrency, order, and error
   laws.
2. Asset, page, and bundle scope calls share one operation-owned persistence
   scope and retain invocation-order serialization.
3. Omitting `retain` preserves v6.5.9 retain-all behavior.
4. `retain` is called exactly once, after the callback and staged operations
   succeed but before installation. It must synchronously return an array.
5. Every selector item is parsed as `ApplicationHandleInput`, must equal a
   handle staged by that exact compound call, and is deduplicated by canonical
   handle string while preserving first-selected order. Selector input count
   cannot exceed the number of staged artifacts.
6. Selected newly staged targets are unioned with targets retained before the
   compound call. The selector cannot remove those prior targets.
7. A malformed selector, non-array result, unstaged handle, callback failure,
   staged failure, operation overflow, or final installation failure produces
   no admitted value and does not move the workspace generation.
8. A supplied selector must choose at least one newly staged handle. An empty
   selection rejects before installation rather than claiming retention for a
   graph with no newly admitted terminal.
9. Intermediate immutable Git objects may remain unreachable after failure and
   are reclaimable by normal Git maintenance; they are not admitted state.

## User Experience / Product Shape

There is no rendered interface. The user-visible surface is the package API,
TypeScript declarations, typed errors, docs, changelog, and machine-readable
witness evidence.

## Data / State Model

| State              | Source of truth                                       | Derived state                 | Invalid states                                       | Reset behavior                              | Serialization                       | Determinism assumptions                     |
| ------------------ | ----------------------------------------------------- | ----------------------------- | ---------------------------------------------------- | ------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| Newly staged graph | immutable Git objects plus staged-target evidence     | ordered compound ledger       | missing handle evidence or failed wave               | unreachable objects are reclaimable         | unchanged asset/page/bundle objects | existing services define identity and order |
| Selected roots     | callback result plus canonical selector inputs        | deduplicated staged artifacts | malformed, asynchronous, or unstaged selector output | whole admission refuses                     | none before installation            | first selected canonical order wins         |
| Prior targets      | current workspace generation and in-memory target map | installation union            | selector attempts implicit removal                   | preserved until explicit checkpoint/release | existing RootSet entries            | prior generation is authoritative           |
| Admitted result    | checked workspace ref generation                      | witnesses and callback value  | value visible without selected-root retention        | caller promotes, checkpoints, or releases   | unchanged workspace descriptor      | one checked update defines admission        |

## Architecture / Anti-SLUDGE Posture

| Concern                         | Decision                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Domain changes                  | Extend the existing compound coordinator and scope; do not add consumer vocabulary.                                     |
| Port changes                    | Add only the package-level asset batch and selector shapes.                                                             |
| Adapter changes                 | None beyond reuse of the existing persistence write scope.                                                              |
| Boundary validation             | Canonically parse every selected input and require exact membership in the operation ledger.                            |
| Runtime-backed nouns introduced | None; this completes the existing compound-admission noun.                                                              |
| Expected failure representation | Preserve existing `CasError` codes and original storage failures.                                                       |
| Banned shortcuts avoided        | No raw Git access, string-like handle trust, nested scope, unbounded queue, schema fork, or consumer-specific topology. |

## Cost / Residency Posture

| Surface                | Current cost                                     | Target cost                                       | Limit/budget                                     | Failure mode                    |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| Asset-to-bundle graph  | separate asset scope/install plus compound graph | one persistence scope and one install             | existing asset and compound ceilings             | whole admission refuses         |
| Direct workspace roots | every staged compound artifact                   | prior targets plus selected new roots             | existing workspace target maximum                | typed retention failure         |
| Asset residency        | bounded by public asset batch                    | unchanged                                         | existing assets/objects/bytes/concurrency limits | existing batch failure evidence |
| Selector residency     | unavailable                                      | linear in requested selections and staged targets | bounded by staged targets                        | invalid-options refusal         |

## Determinism / Replay / Causality

- Grouping does not change asset, page, bundle, or terminal object identity.
- Scope call invocation order, not promise settlement timing, defines the write
  sequence.
- Selection order is caller-authored and deduplicated by the first canonical
  occurrence.
- The checked workspace generation witnesses retention now; it does not claim
  that intermediate objects were separately admitted.
- Equal handle bytes do not authorize selection unless that handle appears in
  the current operation's staged ledger.

## Git Substrate Impact

| Substrate area          | Impact                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| refs                    | Existing workspace ref moves once for the complete selected graph.                                  |
| commits                 | One existing parentless RootSet generation; no encoding change.                                     |
| trees/blobs             | Existing asset manifests/chunks, pages, bundles, descriptors, and RootSet objects remain unchanged. |
| object ids              | Existing service outputs must remain byte-identical.                                                |
| tag/release behavior    | Publish as v6.5.10 after merge and release verification.                                            |
| migration compatibility | Existing repositories and workspaces open in place; no migration.                                   |

## Compatibility / Migration Posture

| Concern                    | Decision                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Public API compatibility   | Additive asset scope method and optional selector; existing calls retain all staged targets. |
| Package export changes     | Type declarations expand existing compound interfaces only.                                  |
| Storage/read compatibility | No serialized shape, object identity, reader, namespace, or ref layout changes.              |
| Legacy behavior retained   | All singleton, independently retained batch, and v6.5.9 compound calls remain valid.         |
| Deprecation behavior       | None.                                                                                        |
| Migration path             | None required.                                                                               |
| Release note impact        | Explicitly state migration-free physical admission optimization.                             |

## Error Contract

| Failure                                | Error/result                          | Caller recovery                           | Test                      |
| -------------------------------------- | ------------------------------------- | ----------------------------------------- | ------------------------- |
| Missing asset dependency               | `INVALID_OPTIONS` during construction | supply a complete service set             | dependency test           |
| Invalid asset request                  | existing asset batch error            | correct the request or split bounds       | scope failure test        |
| Non-function selector                  | `INVALID_OPTIONS`                     | omit it or supply a function              | selector table            |
| Non-array/asynchronous selector output | `INVALID_OPTIONS`                     | return a synchronous array                | selector table            |
| Malformed or unstaged handle           | `INVALID_OPTIONS`                     | select a handle returned by this callback | adversarial selector test |
| Final exact retention failure          | `WORKSPACE_RETENTION_FAILED`          | inspect posture and retry                 | no-partial-result test    |

## Security / Trust / Redaction Posture

- trust boundary: the callback receives only bounded semantic operations;
- authority or capability checked: exact workspace expected-head mutation;
- secret-bearing values: payload bytes remain inside existing asset services;
- redaction behavior: errors name operation and canonical handle where safe,
  never payload content or encryption keys;
- log/report behavior: evidence records counts, digests, versions, and object
  formats without payloads or machine-local paths;
- abuse or replay concern: selector authority is restricted to exact staged
  membership and cannot import a globally known handle.

## Lower Modes

Public declarations, plain-text documentation, structured errors, and JSON
witness data expose the same operation, selection, identity, and retention
facts. No visual-only mode exists.

## Accessibility Posture

Docs and witness artifacts use linear reading order and textual labels rather
than color or layout. The package API requires no visual interaction.

## User-Facing Text / Directionality

English API docs, error messages, changelog, and witness labels change. They use
logical ordering words such as prior, staged, selected, and terminal; no screen
direction or visual-only distinction is introduced.

## Agent Inspectability / Explainability Posture

An agent can inspect the operation count, staged handles, selected retained
handles, exact generation, command/session census, semantic digest, replay
count, object format, and post-close session count without parsing timing prose
or inferring transitive roots.

## Linked Invariants

- every handle visible after successful workspace admission is anchored;
- only callback-private provisional handles may precede retention;
- asset/page/bundle batch bounds and order remain intact;
- selected roots belong to the exact current compound operation;
- prior retained targets survive selection;
- failure cannot expose a partial admitted result or move the prior generation;
- SHA-1 and SHA-256 object identity remains Git-authored;
- all child processes and queued operations settle before outer completion;
- release order remains Plumbing, git-cas, git-warp, then Think.

## Design Alternatives Considered

### Keep assets outside compound admission

Pros:

- no API change.

Cons:

- repeated write scopes and workspace installations remain the largest measured
  downstream construction boundary.

### Retain every compound artifact

Pros:

- current v6.5.9 behavior is simple and safe.

Cons:

- direct root-set size reflects construction intermediates rather than the
  terminal graph; later promotion still pays for redundant top-level roots.

### Permit arbitrary handles in the selector

Pros:

- could combine existing and new content in one call.

Cons:

- silently broadens authority, requires global resolution, and obscures which
  objects this exact operation produced.

### Add bounded asset waves and exact staged-root selection

Pros:

- closes the measured boundary while preserving the existing safety model;
- stays generic, additive, bounded, and storage-compatible;
- makes terminal-root authority explicit and inspectable.

Cons:

- adds selector failure laws and one more scoped service dependency.

## Decision

Add bounded asset waves and exact staged-root selection to the existing
compound admission. Keep the selector synchronous, canonical, membership-
checked, and unable to remove prior roots. Preserve retain-all as the default.

## Proof Surface

The implementation must be proven through:

- actual surface under test: `StagingWorkspace.batch()` and the published
  package API against unit fakes and real SHA-1/SHA-256 repositories;
- first RED test: `scope.assets.putBatch()` is unavailable on v6.5.9;
- required witness: asset-to-terminal graph identity, one checked ref update,
  selected direct roots, transitive readback after immediate prune, no active
  object sessions, and downstream command/semantic comparison;
- non-acceptable proof: docs-only tests, elapsed time alone, arbitrary
  string-like selectors, or lower counts obtained by bypassing retention.

Named mutation calibration:

1. Asset batch opens its own nested write scope: scope identity/session test
   fails.
2. Selector accepts a lookalike object: canonical-input adversarial test fails.
3. Selector names a valid but unstaged handle: membership test fails.
4. Selector removes prior roots: prior-target test fails.
5. Selector is ignored: direct-root cardinality test fails.
6. Asset failure still installs bundles: no-generation test fails.
7. One session survives outer settlement: lifecycle witness fails.

## Implementation Slices

1. Add RED scope, selector, declaration, and failure tests.
2. Expose the asset internal scoped batch path and join it to the compound
   coordinator.
3. Add canonical exact-root selection and prior-root preservation.
4. Extend SHA-1/SHA-256 immediate-prune and identity integration proof.
5. Update public docs, architecture, changelog, design witness, and release
   records; run full gates.
6. Publish v6.5.10, install the registry artifact in git-warp, and rerun the
   exact downstream corpus.

## Tests To Write First

- [x] Asset, page, and bundle waves share the supplied persistence scope and
      preserve invocation order.
- [x] The selector retains one terminal staged handle and deduplicates repeated
      canonical inputs.
- [x] Non-function, non-array, promise, empty, oversized, malformed, lookalike,
      and unstaged selector results fail before ref movement.
- [x] Prior retained workspace targets survive exact new-root selection.
- [x] Asset failure poisons queued dependent work and emits no generation.
- [x] Public TypeScript declarations accept the new method and selector.
- [x] SHA-1 and SHA-256 immediate-prune tests prove terminal transitive reachability
      with only selected direct roots.

## Acceptance Criteria

The work is done when:

- [x] One bounded asset/page/bundle graph produces one exact workspace
      generation.
- [x] Existing asset limits, ordered handles, and errors are preserved.
- [x] Selector validation proves canonical exact staged membership and stable
      deduplication.
- [x] Failure and lifecycle tests prove no partial admitted result.
- [x] Real Git proves byte-identical handles and transitive prune safety in
      SHA-1 and SHA-256 repositories.
- [x] Existing v6.5.9 calls and all persisted repositories remain compatible
      without migration.
- [x] Public docs, architecture, changelog, issue, PR, CI, and local validation
      are complete.
- [x] v6.5.10 is publicly installable before downstream results are claimed as
      release behavior.

## Validation Plan

```sh
npx vitest run test/unit/domain/services/WorkspaceCompoundScope.test.js
npx vitest run test/unit/domain/services/StagingWorkspace.compound.test.js
npm test
npx eslint .
npm run test:integration:node
npm run test:integration:bun
npm run test:integration:deno
npm run release:verify
```

## Playback / Witness

A reviewer can inspect the committed JSON witness for object formats, staged
and selected handles, direct roots, operation/generation counts, Git child
census, semantic fingerprint equality, replay evidence, and closed sessions.
The release-candidate witness binds the exact commit, package tarball, lockfile,
and validation commands.

## Risks

Known risks:

- exact selection accidentally weakens prior-root retention;
- asset services accidentally open a nested scope;
- selector coercion accepts non-canonical lookalikes;
- direct-root reduction hides a missing transitive bundle edge;
- timing noise is mistaken for deterministic evidence.

Mitigations:

- adversarial selectors, injected persistence spies, prior-root checks, real-Git
  prune/readback, identity comparisons, command topology, and semantic digests;
- treat wall time as supporting evidence only.

## Follow-On Debt

None currently. Any deferred reusable trie package or broader transaction
surface requires a separate GitHub issue and an independent consumer.

## Tracker Disposition

| Issue                                                    | Role             | Expected disposition             |
| -------------------------------------------------------- | ---------------- | -------------------------------- |
| [#127](https://github.com/git-stunts/git-cas/issues/127) | primary goalpost | close after publication evidence |

## Done Does Not Mean

When this lands, it does not prove:

- cross-workspace or cross-ref atomicity;
- that every workload benefits equally;
- that elapsed time is deterministic;
- that git-cas owns consumer graph, trie, entity, or occurrence semantics;
- that any migration is required.

## Retrospective

Implementation PR:

- [#128 - Complete compound workspace asset admission](https://github.com/git-stunts/git-cas/pull/128)

The implementation checkpoint is
`e663754bf221784f0e5856a41fe071bebfa5befb`. Its complete release method passed
14/14 stages with 7,186 observed tests. Self-audit found and closed one
boundedness hole before review: selector input count is now capped by the exact
staged-artifact count, preventing duplicate input scanning from exceeding the
admission's own evidence ledger.

Release PR #129 merged normally as
`4316f4ec7eeda531c07627d2ad0d15c1fcade2f8`. That exact merge passed all 14
release-verifier stages with 7,192 observed tests before signed tag `v6.5.10`
triggered successful release workflow
[`32782415971`](https://github.com/git-stunts/git-cas/actions/runs/32782415971).
The registry, provenance, signature, GitHub Release, and clean-room compound
asset smoke are recorded in the
[publication witness](./witness/release-publication.md).

The controlled git-warp prototype reduced cold Git commands from 139 to 50 and
incremental commands from 149 to 60 with equal semantic fingerprints and replay
counts. The public dependency now exists; that downstream result remains
provisional until git-warp installs it and repeats the corpus.

Release PR:

- [#129 - Release v6.5.10 compound workspace assets and exact roots](https://github.com/git-stunts/git-cas/pull/129)
