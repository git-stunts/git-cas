---
title: 'PERF-0052 - Persistent Git Object Sessions'
cycle: '0052'
task_id: 'persistent-git-object-sessions'
legend: 'PERF'
release_home: 'v6.5.2'
issue: 'https://github.com/git-stunts/git-cas/issues/90'
goalpost_issue: 'https://github.com/git-stunts/git-cas/issues/90'
tracker_source: 'github'
status: 'landed'
base_commit: '12fd67200641f385d2d756c302bb2e5701beefbc'
owners:
  - '@git-stunts'
sponsors:
  human: 'James'
  agent: 'Codex'
blocking_issues: []
supersedes: []
superseded_by: null
created: '2026-07-19'
updated: '2026-07-19'
---

# PERF-0052 - Persistent Git Object Sessions

## Linked Issue

- [#90 - Reuse bounded Git object sessions](https://github.com/git-stunts/git-cas/issues/90)

## Linked Tracker

- Milestone: [`v6.5.2`](https://github.com/git-stunts/git-cas/milestone/12)
- Goalpost issue: [#90](https://github.com/git-stunts/git-cas/issues/90)
- Follow-on derivation design: [#86](https://github.com/git-stunts/git-cas/issues/86)

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

`GitPersistenceAdapter` will lazily own typed `cat-file` and `mktree` sessions
supplied by `@git-stunts/plumbing` 3.2.0. Bounded immutable object and tree
reads plus tree writes will reuse those processes. Explicitly bounded page
batches will use one scoped `fast-import` session that closes before returning.
Individual blob writes remain one-shot because a long-lived `fast-import`
process can remember an object that external pruning has removed and decline to
recreate it. Payload streams continue to use `readBlobStream()` and are not
converted into whole-object reads. `ContentAddressableStore.close()`
deterministically drains started operations, cancels abandoned output streams,
and releases adapter-owned sessions.

## Sponsored Human

An application operator wants selected causal materialization to stay
responsive when the retained graph is much larger than memory, without paying
one process launch per immutable support object or managing Git children.

## Sponsored Agent

An agent needs process reuse, bounded residency, and lifecycle state to be
observable through stable tests and receipts, without receiving raw Git OIDs,
session handles, mutable refs, or hidden cleanup obligations.

## Hill

By the end of this cycle, a caller can perform a cold selected bundle read with
constant session-process startup for supported object protocols, then close the
CAS deterministically. Real-Git tests compare the same fixture through legacy
fallback and session-capable adapters and prove the optimized path does less
process work without changing the result.

## Current Truth

- Every `writeBlob()`, `writeTree()`, `readBlobStream()`, `readTree()`, exact
  `readTreeEntry()`, and uncached object-info read invokes
  `plumbing.execute()` or `plumbing.executeStream()` independently.
  [cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#55-251@12fd67200641f385d2d756c302bb2e5701beefbc`]
- Exact tree-entry and object-info results are immutable and count-bounded, but
  full tree objects are not reused.
  [cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#35-49@12fd67200641f385d2d756c302bb2e5701beefbc`]
- Bundle validation asks for direct tree edges repeatedly along a selected
  fanout path.
  [cite: `src/domain/services/BundleService.js#535-610@12fd67200641f385d2d756c302bb2e5701beefbc`]
- Chunk restore deliberately uses `readBlobStream()` when available to enforce
  hard memory limits.
  [cite: `src/domain/services/ChunkRepository.js#122-165@12fd67200641f385d2d756c302bb2e5701beefbc`]
- The facade constructs one persistence adapter lazily but has no close or
  async-disposal contract.
  [cite: `index.js#120-340@12fd67200641f385d2d756c302bb2e5701beefbc`]
- PERF-0050 explicitly excluded long-lived Git processes because plumbing did
  not yet provide the protocol boundary. Plumbing 3.2.0 now provides that
  boundary.
  [cite: `docs/design/0050-lazy-bundle-reference-reads/lazy-bundle-reference-reads.md#89-101@12fd67200641f385d2d756c302bb2e5701beefbc`]

## Problem

The current cache removes repeated immutable work only after a key repeats.
Every distinct support object on a cold bounded path still starts a Git
process. This makes latency proportional to support-object count even when the
causal aperture is correct and memory remains bounded. It also encourages
downstream applications to invent caches or bypass git-cas, violating the
storage ownership boundary.

## Scope

This cycle includes:

- upgrade `@git-stunts/plumbing` to 3.2.0
- lazy adapter ownership of typed object sessions
- bounded raw tree decoding and exact path traversal
- count-and-byte-bounded immutable tree reuse
- session-backed bounded blob and object-info reads
- scoped bulk blob writes and session-backed tree writes with visibility guarantees
- one-shot individual blob writes that remain correct across external pruning
- deterministic adapter and facade close semantics
- capability fallback for injected plumbing implementations without sessions
- real-Git process-count, wall-clock, and memory evidence
- Node, Bun, and Deno validation

## Non-Goals

This cycle does not include:

- implementing a Git object database, packfile reader, or ref store
- caching refs, mutable collection state, or arbitrary application payloads
- converting `readBlobStream()` into buffered whole-object reads
- exposing sessions, process handles, Git OIDs, or ref mutation authority
- path-local persistent bundle derivation from #86
- replacing stock Git or `@git-stunts/plumbing`
- claiming graph-wide memory bounds from a small-fixture latency test

## Runtime / API Contract

```ts
class ContentAddressableStore {
  pages: {
    putBatch(options: {
      pages: Array<{
        source: Uint8Array | Iterable<Uint8Array>;
        maxBytes?: number;
      }>;
      maxBatchBytes?: number;
      maxBatchPages?: number;
    }): Promise<ReadonlyArray<StagedPage>>;
  };
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

class GitPersistenceAdapter {
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

`close()` releases local resources only. It does not delete objects, update
refs, expire retained content, run garbage collection, or mutate witnesses.
It is idempotent. A close begun while operations are active blocks new work,
waits for started commands, destroys returned output streams that callers did
not consume, waits for their Git processes, and then closes typed protocol
sessions. New adapter operations after close fail with a stable
closed-resource error.

The adapter feature-detects each typed plumbing capability independently.
Missing capabilities use the existing command-per-operation implementation.
No fallback behavior changes persisted object identity.

## User Experience / Product Shape

There is no new CLI surface. Normal callers use:

```js
await using cas = await ContentAddressableStore.open({ cwd: '.' });
const page = await cas.pages.get({ handle });
```

Callers that cannot use explicit resource management call `await cas.close()`.

## Data / State Model

| State            | Source of truth       | Derived state             | Invalid states                    | Reset behavior                       | Serialization | Determinism assumptions             |
| ---------------- | --------------------- | ------------------------- | --------------------------------- | ------------------------------------ | ------------- | ----------------------------------- |
| Git objects      | Git object database   | None                      | Malformed or missing object       | External repair                      | Git native    | OID identifies immutable bytes      |
| Session handles  | Adapter process state | Lazy promise per protocol | Closed or poisoned session reused | Invalidate; next lawful call reopens | None          | Operations serialize per protocol   |
| Page write batch | Caller input          | Bounded byte arrays       | Page or byte limit exceeded       | Reject before persistence begins     | None          | Input order determines OID order    |
| Parsed trees     | Immutable tree object | Frozen entry array        | Malformed raw tree                | Reject; do not cache                 | None          | Same tree OID yields same entries   |
| Tree cache       | Adapter memory        | LRU entries               | Count or byte bound exceeded      | Evict oldest                         | None          | Cache never changes semantic result |

## Architecture / Anti-SLUDGE Posture

| Concern             | Decision                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Domain changes      | Add only lifecycle capability to the persistence port; domain services do not learn Git sessions. |
| Port changes        | `GitPersistencePort.close()` is a default no-op for compatibility.                                |
| Adapter changes     | `GitPersistenceAdapter` owns protocol sessions and Git tree decoding.                             |
| Facade changes      | `ContentAddressableStore.close()` delegates to its initialized persistence adapter.               |
| Plumbing boundary   | Plumbing owns process spawning and typed wire protocols; git-cas owns lawful reuse policy.        |
| Downstream boundary | git-warp continues to see only git-cas asset, page, bundle, retention, and lifecycle APIs.        |

## Cost / Residency Posture

- At most one live session exists per supported protocol per adapter. A failed
  forced termination poisons that protocol and blocks replacement processes.
- Session queues serialize operations and do not duplicate response buffers.
- Parsed trees are bounded by entry count and estimated retained bytes.
- A tree larger than the bounded cat-file read budget falls back to streaming
  `ls-tree` behavior and is not cached.
- `readBlobStream()` remains one bounded stream per payload and does not share a
  buffered cat-file session.
- Returned Git output streams remain adapter-owned until consumption completes
  or `close()` destroys them and waits for the underlying process.
- `pages.putBatch()` admits at most 256 pages and 32 MiB by default, collecting
  and validating the complete bounded batch before persistence begins.
- A bulk fast-import session checkpoints and closes before `putBatch()`
  resolves so a different Git process can consume every returned OID.
- Individual `pages.put()` and `writeBlob()` calls remain one-shot. This is a
  correctness boundary, not an unimplemented optimization.

## Determinism / Replay / Causality

Session reuse changes process topology, not object bytes, tree ordering, OIDs,
retention, or witness meaning. Same-input object identity tests remain the
determinism proof.

## Git Substrate Impact

The adapter uses three stock Git protocols through plumbing: persistent
`cat-file --batch-command`, persistent `mktree --batch -z`, and scoped
`fast-import` for an explicitly bounded blob batch. Individual blob writes use
`hash-object` as before. Ref access remains on the existing ref adapter and is
never cached. No new refs or object formats are introduced.

## Compatibility / Migration Posture

This is additive. Injected plumbing doubles without typed-session methods keep
the legacy path. Existing callers remain source-compatible, but explicit
`close()` is the normal lifecycle contract and is required whenever operations
may remain active or streams may remain unconsumed. That includes fallback
`readBlobStream()` operations and their child processes, not only typed
sessions. Persisted repositories need no migration.

## Error Contract

- Missing Git objects map to the existing `GIT_OBJECT_NOT_FOUND` CAS error.
- Object read-budget failures map to the existing size-limit contract.
- Malformed tree bytes map to `TREE_PARSE_ERROR`.
- Protocol failure invalidates the affected session before surfacing.
- Invalidation is generation-safe: a late failure from an old process may
  terminate that process, but cannot evict a replacement session opened by a
  concurrent retry.
- A typed protocol-process failure receives one retry through a fresh session
  only after invalidation and forced termination succeed. These operations are
  content-addressed and idempotent; bulk inputs are materialized once before
  the first attempt so a retry sees the same sequence.
- Failed forced termination poisons the protocol for the adapter lifetime.
  Later operations remain blocked and explicit close reports the unresolved
  teardown instead of opening beside a potentially live process.
- Close attempts every opened session and reports aggregate cleanup failure.
  A graceful close or retirement failure force-terminates the affected process
  before the failure is surfaced. Independent cleanup failures are preserved.

## Security / Trust / Redaction Posture

Session reuse grants no new repository authority. Commands remain sanitized by
plumbing. Diagnostics count protocol/process activity but do not emit content,
keys, paths outside the repository, or object payloads.

## Accessibility Posture

No visual interaction changes. Human-readable lifecycle errors remain concise,
and all benchmark evidence is also committed as structured JSON.

## Agent Inspectability / Explainability Posture

Tests expose process openings by protocol, fallback command counts, close
events, and semantic result equality. Agents can distinguish cache hits from
process amortization without timing inference.

## User-Facing Text / Directionality

Public documentation adds the sentence: "`close()` releases local resources
only." Text is English and left-to-right. Machine-readable tests and witness
JSON carry the equivalent lifecycle facts.

## Linked Invariants

- immutable objects are addressed by content identity
- mutable refs are never cached as immutable metadata
- payload streaming remains bounded by existing limits
- only git-cas owns CAS cache and retention policy for git-warp
- resource ownership is paired with deterministic release

## Design Alternatives Considered

### Native Git library

Rejected for this cycle. The spike found no complete supported replacement for
the required stock Git behavior, and it would move protocol risk into the
application stack.

### Session ownership in git-warp

Rejected. It would duplicate CAS policy and expose Git beneath git-cas.

### Buffer every payload through cat-file

Rejected. It would regress the hard streaming invariant for graphs and assets
larger than memory.

### Cache only exact tree entries

Rejected as insufficient. Distinct entries in one bounded fanout tree would
still reread the same immutable tree object repeatedly.

### Never close sessions

Rejected. Hidden live child processes are a correctness and test-isolation bug.

### Reuse one fast-import process across individual blob writes

Rejected after a real-Git counterexample. When an unreachable blob was pruned
between two identical writes, the still-running `fast-import` process retained
its duplicate-object knowledge and returned the old OID without recreating the
missing object. A scoped batch is safe because it checkpoints and closes before
the OIDs cross the method boundary; the next batch starts with fresh Git object
state.

## Decision

Adopt typed persistent read/tree sessions inside `GitPersistenceAdapter`,
bounded tree reuse, explicit close, capability fallback, and an explicit
bounded page-batch API backed by one scoped fast-import process. Keep individual
blob writes one-shot and streaming payloads on the existing stream path.

## Proof Surface

- unit tests for tree decoding, session coalescing, generation-safe error
  invalidation, close and retirement failure, active-command draining,
  abandoned-stream cleanup, fallback, and residency eviction
- facade tests for lazy close and async disposal
- real-Git same-fixture fallback/session command-process comparison
- real-Git prune/rewrite regression for individually written blobs
- real-Git individual-versus-batch write process comparison
- existing large-stream restore and page-cache tests
- Node, Bun, and Deno suites
- committed JSON witness with counts, wall timing, and explicitly scoped Node
  worker CPU and peak-memory observations

## Implementation Slices

1. Dependency, lifecycle, and failing tests.
2. Session owner and bounded tree codec/cache.
3. Adapter routing and error normalization.
4. Facade lifecycle and declarations.
5. Real-Git performance witness, docs, and release evidence.

## Tests To Write First

1. One adapter opens at most one session per protocol under concurrent calls.
2. Close is idempotent and closes every opened protocol.
3. A failed protocol is invalidated and a later call opens a new process.
4. Same-tree exact lookups require one bounded object read.
5. Tree cache evicts by count and estimated bytes.
6. `readBlobStream()` still delegates to `executeStream()`.
7. A session-capable real-Git read returns the same reference with fewer child
   process openings than the fallback adapter.
8. An individually written unreachable blob can be pruned and recreated with
   the same OID.
9. A bounded page batch returns the same handles as individual writes while
   opening one scoped fast-import process.
10. Close waits for an active one-shot command and destroys an abandoned Git
    output stream before resolving.
11. A late failure from an old session cannot invalidate a concurrently opened
    replacement, and failed graceful retirement aborts before rejecting.
12. Explicit retirement and invalidation block replacement process creation
    until teardown completes.
13. Failed forced termination blocks all later sessions for that protocol and
    remains visible to explicit close.

## Acceptance Criteria

- [ ] All acceptance criteria in #90 are proven.
- [x] Public declarations include close and async disposal.
- [x] No public session, process, or mutable ref handle is exported.
- [x] Existing storage identity fixtures remain unchanged.
- [x] `npm test`, integration suites, platform suites, and lint pass.
- [ ] Witness evidence is committed and linked from the PR.

## Validation Plan

1. Run targeted unit tests while implementing.
2. Run real-Git fallback and session paths against one generated fixture.
3. Run full unit and integration suites.
4. Run Node, Bun, and Deno platform validation.
5. Run ESLint, formatting check, declaration accuracy, and release verification.
6. Self-review the complete diff against `origin/main`.

## Playback / Witness

The witness packet must answer:

- Did the same selected reference result survive both paths?
- How many child processes and fallback commands did each path use?
- Did repeated immutable tree access hit bounded reuse?
- Did close release every session?
- Did large streaming behavior remain bounded?

## Risks

- Fast-import checkpoint and close cost may erase gains for tiny batches;
  benchmark before claiming a wall-clock improvement.
- Low-level `writeBlobs()` callers must still provide a bounded iterable; the
  adapter retains its yielded byte arrays until the scoped operation settles.
- Policy timeouts can race an in-flight protocol operation; timeout handling
  must invalidate the session.
- Raw tree parsing must support SHA-1 and SHA-256 repositories and malformed
  input without out-of-bounds reads.
- Idle retirement bounds reusable-session leaks when callers omit close, but an
  abandoned output stream still requires close or eventual process completion;
  docs and async disposal reduce but cannot eliminate misuse.
- The diagnostic's CPU and RSS fields cover the Node worker, not Git children;
  git-warp must add process-tree CPU and large-graph memory gates before v19.

## Follow-On Debt

- Path-local persistent bundle derivation remains #86.
- Batched streaming chunk reads and writes may require a separate design if
  same-fixture evidence shows per-chunk stream processes dominate.
- Doctor may later expose live session counters if operational demand exists.

## Tracker Disposition

Issue #90 closes only after implementation, witness, PR review, merge, and npm
publication evidence are complete. New debt becomes a linked GitHub issue.

## Done Does Not Mean

- git-warp materialization is automatically fast; it must adopt v6.5.2 and
  prove its own benchmark.
- arbitrary graph reads fit in memory.
- Git subprocess cost is zero.
- #86 is complete.

## Retrospective

To be written after merge under
`docs/method/retro/0052-persistent-git-object-sessions/`.
