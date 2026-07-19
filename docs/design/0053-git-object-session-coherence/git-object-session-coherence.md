---
title: 'PERF-0053 - Git Object Session Coherence'
cycle: '0053'
task_id: 'git-object-session-coherence'
legend: 'PERF'
release_home: 'v6.5.3'
issue: 'https://github.com/git-stunts/git-cas/issues/94'
goalpost_issue: 'https://github.com/git-stunts/git-cas/issues/94'
tracker_source: 'github'
status: 'landed'
base_commit: 'fb3d3c2b620bae11d52e8ecc7a78a7ea07f27e24'
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

# PERF-0053 - Git Object Session Coherence

## Linked Tracker

- Issue: [#94 - Preserve Git object sessions across coherent writes](https://github.com/git-stunts/git-cas/issues/94)
- Milestone: [`v6.5.3`](https://github.com/git-stunts/git-cas/milestone/13)
- Parent design: [PERF-0052](../0052-persistent-git-object-sessions/persistent-git-object-sessions.md)

## Design Type

This design is primarily:

- [x] Runtime/API
- [x] Storage/substrate
- [x] Migration/release
- [ ] CLI/operator
- [ ] Docs/public guidance
- [ ] TUI/visual surface
- [x] Test/tooling

## Decision Summary

`GitPersistenceAdapter` will preserve a live `cat-file --batch-command`
session across every successful immutable object write. It will preserve a live
`mktree --batch -z` session across one-shot loose blob writes and loose tree
writes, but retire `mktree` after a scoped bulk `fast-import` write because
that operation may create a pack that an already prepared `mktree` process
cannot discover. The scoped `fast-import` process still checkpoints and closes
before any OID escapes. No public API, object identity, retention policy, or
lifecycle contract changes.

## Hill

By the end of this cycle, repeated git-warp materialization writes through one
CAS adapter reuse coherent Git reader and tree-writer processes instead of
restarting them after every loose object. Real-Git tests prove both sides of the
boundary: safe reuse after loose writes and mandatory `mktree` retirement
after a pack-producing bulk write.

## Current Truth

- A one-shot blob write retires both persistent object protocols after
  `hash-object -w` succeeds.
  [cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#93-103@fb3d3c2b620bae11d52e8ecc7a78a7ea07f27e24`]
- A bulk blob write retires both persistent object protocols after checkpoint,
  then separately retires the scoped `fast-import` process.
  [cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#114-151@fb3d3c2b620bae11d52e8ecc7a78a7ea07f27e24`]
- Both typed and fallback tree writes retire the persistent reader.
  [cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#160-178@fb3d3c2b620bae11d52e8ecc7a78a7ea07f27e24`]
- The session pool already supports independent protocol retirement,
  invalidation, generation barriers, idle bounds, and explicit close.
  [cite: `src/infrastructure/adapters/GitObjectSessionPool.js#39-117@fb3d3c2b620bae11d52e8ecc7a78a7ea07f27e24`]
- PERF-0052 correctly keeps individual blobs on one-shot `hash-object` and
  scoped batches on checkpointed `fast-import`.
  [cite: `docs/design/0052-persistent-git-object-sessions/persistent-git-object-sessions.md#220-240@fb3d3c2b620bae11d52e8ecc7a78a7ea07f27e24`]
- The existing real-Git gate proves scoped bulk writes reduce process count and
  that one-shot writes recreate objects after external pruning.
  [cite: `test/integration/bundle-reference-performance.test.js#193-247@fb3d3c2b620bae11d52e8ecc7a78a7ea07f27e24`]

## Problem

The implementation treats every successful object-database mutation as if it
invalidated every typed Git process. That is stricter than the protocols'
actual lookup behavior and collapses persistent sessions back into
process-per-object execution on alternating blob, tree, and read workloads.

A 128-node retained git-warp materialization on `@git-stunts/git-cas@6.5.2`
opened 558 Git children: 140 `hash-object`, 82 `mktree`, and 80
`cat-file`. A temporary audited candidate opened 401 children: the same 140
one-shot blob writers, one `mktree`, and four `cat-file` processes. The
candidate therefore removes 157 unnecessary process launches without changing
the one-shot blob correctness boundary.

## Audited Git Coherence Matrix

The raw protocol matrix was exercised with Git 2.50.1 and Git 2.39.5 in both
SHA-1 and SHA-256 repositories.

| Existing session           | Subsequent write                | Preserve? | Reason                                            |
| -------------------------- | ------------------------------- | --------- | ------------------------------------------------- |
| `cat-file --batch-command` | loose `hash-object -w`          | Yes       | Direct lookup observes the new loose object.      |
| `cat-file --batch-command` | checkpointed `fast-import` pack | Yes       | Missing lookup refreshes packed object state.     |
| `cat-file --batch-command` | loose `mktree` output           | Yes       | Direct lookup observes the new loose tree.        |
| `mktree --batch -z`        | loose `hash-object -w`          | Yes       | Loose lookup follows the prepared pack lookup.    |
| `mktree --batch -z`        | checkpointed `fast-import` pack | No        | Quick lookup does not refresh prepared pack data. |

The behavior follows upstream Git's lookup contract. `cat-file` uses
`odb_read_object_info_extended()` without `OBJECT_INFO_QUICK`, allowing a
second read to refresh source state. `mktree` explicitly requests
`OBJECT_INFO_QUICK`, which suppresses that second read.

- [Upstream object lookup retry](https://github.com/git/git/blob/41365c2a9ba347870b80881c0d67454edd22fd49/odb.c#L550-L610)
- [Upstream packed-source refresh](https://github.com/git/git/blob/41365c2a9ba347870b80881c0d67454edd22fd49/odb/source-packed.c#L35-L58)
- [Upstream mktree quick lookup](https://github.com/git/git/blob/41365c2a9ba347870b80881c0d67454edd22fd49/builtin/mktree.c#L118-L143)

## Scope

This cycle includes exactly one runtime correction:

- remove `cat-file` retirement after successful blob, bulk blob, and tree writes
- remove `mktree` retirement after successful one-shot loose blob writes
- retain `mktree` retirement after successful scoped bulk writes
- retain scoped `fast-import` checkpoint and retirement
- replace obsolete blanket-retirement tests with the exact coherence matrix
- add real-Git regression coverage and measured witness evidence

## Non-Goals

This cycle does not include:

- changing the public API or TypeScript declarations
- reusing `fast-import` across individual writes or separate batches
- changing individual `writeBlob()` from one-shot `hash-object`
- adding workspace, RootSet, retention, TTL, LRU, or cache policy
- coalescing staging-workspace generations
- changing Git ref, commit, or history operations
- changing session idle timeout, retry, invalidation, or explicit close behavior
- claiming that every remaining git-warp Git process is necessary

## Runtime Contract

The externally observable contract is unchanged. Internally, successful writes
apply this retirement policy:

| Operation                    | `cat-file` | `mktree`   | `fast-import` |
| ---------------------------- | ---------- | ---------- | ------------- |
| One-shot loose blob write    | Preserve   | Preserve   | Not opened    |
| Scoped bulk blob write       | Preserve   | Retire     | Retire        |
| Typed or fallback tree write | Preserve   | Preserve   | Not opened    |
| Failure in that protocol     | Invalidate | Invalidate | Invalidate    |
| Idle timeout                 | Retire     | Retire     | Retire        |
| Adapter close                | Close      | Close      | Close         |

## Determinism, Retention, and Lifecycle

Session preservation changes process topology only. Content bytes, tree entry
ordering, Git OIDs, CAS handles, refs, retention witnesses, and publication
state remain unchanged. Existing protocol failures still invalidate their own
generation. Idle retirement still bounds abandoned reusable processes.
`ContentAddressableStore.close()` remains the deterministic resource boundary.

## Risks

- Removing `mktree` retirement after bulk writes would be a correctness bug
  when `fast-import` leaves a pack above `fastimport.unpackLimit`.
- A timing-only benchmark could hide a process-topology regression in scheduler
  noise. Tests must assert protocol opening counts directly.
- Small bulk batches may unpack into loose objects, so the real-Git regression
  must exceed `fastimport.unpackLimit` to prove the unsafe packed case.
- External repository mutation can still affect a long-lived process. This
  cycle governs writes performed through this adapter; it does not promise a
  transactional snapshot over arbitrary concurrent Git maintenance.

## Alternatives Considered

### Preserve every session after every write

Rejected. A pack-primed `mktree --batch -z` process cannot validate an object
introduced in a later pack because its quick lookup does not refresh prepared
pack state.

### Retire every session after every write

Rejected. This is the current behavior and needlessly discards coherent
`cat-file` sessions and `mktree` sessions after loose writes.

### Raise the idle timeout

Rejected. A 30-second temporary timeout produced the same 558-process
git-warp trace because explicit retirement, not idle expiry, caused churn.

### Add a workspace batch API

Rejected for this cycle. Trie branches depend on child handles and workspace
retention has separate safety obligations. Combining that change would violate
the one-change release boundary.

## Tests To Write First

1. A one-shot blob write preserves already opened `cat-file` and `mktree`.
2. Typed and fallback tree writes preserve already opened `cat-file`.
3. A scoped bulk write preserves `cat-file`, retires `mktree`, and retires
   `fast-import`.
4. A real-Git session reads a new loose blob and tree without reopening.
5. A real-Git reader discovers a later pack without reopening.
6. A real-Git pack-primed `mktree` is replaced after a pack-producing batch
   and validates the new object through the replacement.
7. Existing prune/rewrite, failure, idle, close, SHA-1, and SHA-256 gates pass.

## Acceptance Criteria

- [x] Every checkbox in issue #94 is proven.
- [x] No public export or declaration changes.
- [x] The unit retirement matrix is explicit and complete.
- [x] Real-Git tests exceed `fastimport.unpackLimit`.
- [x] Full unit, integration, platform, lint, and release gates pass.
- [x] Witness evidence distinguishes deterministic process counts from local timing.
- [x] The complete diff passes self-review against `origin/main`.

## Implementation Slices

1. Commit design, failing matrix tests, and raw coherence evidence.
2. Apply the narrow adapter retirement correction.
3. Run full gates and record the witness.
4. Review, publish one PR, and release `v6.5.3`.

## Follow-On Debt

Git-warp still performs one-shot blob writes and frequent workspace RootSet,
ref, and commit updates. Their necessity and any safe coalescing contract remain
separate work. This cycle neither solves nor obscures that remaining cost.

## Landed Evidence

The single runtime correction merged through PR #95 as
`7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98`. The adapter preserves coherent
reader and tree-writer sessions while retaining the mandatory post-pack
`mktree` retirement boundary.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#93-175@7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98`]

The unit matrix and real-Git integration cover safe loose-object reuse, packed
object refresh, mandatory tree-writer replacement after `fast-import`, SHA-1,
SHA-256, lifecycle, and failure behavior.

[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessionCoherence.test.js#6-45@7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98`]
[cite: `test/integration/git-object-session-coherence.test.js#24-60@7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98`]
