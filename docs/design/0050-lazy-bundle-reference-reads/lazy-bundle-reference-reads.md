---
schema: 'method.design/v1'
cycle: '0050'
slug: 'lazy-bundle-reference-reads'
status: 'active'
sponsor_human: 'James Ross'
sponsor_agent: 'Codex'
created: '2026-07-18'
updated: '2026-07-18'
issue: 'https://github.com/git-stunts/git-cas/issues/81'
milestone: 'v6.5.0'
---

# PERF-0050 - Lazy Bundle Reference Reads

## Linked Issue

- [#81 - perf: add lazy bundle references and bounded immutable metadata reads](https://github.com/git-stunts/git-cas/issues/81)

## Design Type

- Public additive API
- Git read-path performance correction
- Bounded-residency infrastructure
- Integrity-boundary clarification

## Decision Summary

Add public `getMemberReference()` and `iterateMemberReferences()` bundle
operations. These operations validate the bundle descriptors and the selected
direct Git tree edges without recursively resolving every member target.
Existing `getMember()`, `iterateMembers()`, `openMember()`, and `resolveRoot()`
retain their complete target-validation behavior.

The Git persistence adapter will coalesce successful immutable object-info and
exact tree-entry reads through a fixed-size least-recently-used map.
`BundleService` will separately coalesce raw structural descriptor bytes under
both entry and byte bounds. Neither cache owns application payloads, full
arbitrary trees, refs, or mutable collection state.

## Sponsored Human

Application operators need exact reads to remain responsive when a retained
materialization references a graph much larger than memory.

## Sponsored Agent

Agents need a precise API that distinguishes locating an immutable member edge
from proving the complete transitive support graph. They also need stable
command-count evidence rather than undocumented process-local shortcuts.

## Hill

A consumer can open a retained structured manifest, inspect only its direct
member references, and dereference only the requested data while Git command
count stays proportional to the selected path rather than the transitive graph.

## Current Truth

- `iterateMembers()` is the explicit full-index validation surface and validates
  each member support graph before yielding it.
- `BundleService` already contains internal direct-reference methods used by
  CacheSet and ExpiringSet indexes.
- Those methods are absent from the frozen public facade and declarations.
- Every `readTreeEntry()` and object-info call currently starts another Git
  command, even when an immutable OID/path was read moments earlier.
- A four-node git-warp retained-property read performs 192 Git commands and
  takes approximately 3-5 seconds on the development host.
- A controlled direct-reference A/B performs 92 commands and takes 1.44
  seconds with the same result, zero replay, and no whole-state cache.
- Public references plus immutable Git metadata coalescing reduce the same
  one-read fixture to 71 commands, 1.215 seconds wall, and 80.947 ms Node CPU.
  A 16-read run proves structural descriptor rereads remain the dominant warm
  data-plane cost until they are coalesced separately.

## Problem

Consumers that need only an immutable manifest edge must currently choose
between an internal API and a public API that recursively validates unrelated
targets. The latter defeats bounded causal reads. Repeated descriptor and
object-info reads then multiply process startup cost even though Git objects are
immutable by OID.

## Scope

- Promote direct-reference lookup and iteration as public bundle capabilities.
- Define and declare `BundleMemberReference` separately from fully resolved
  `BundleMember`.
- Preserve direct-edge, descriptor, fanout, path, and summary checks.
- Add fixed-residency immutable metadata and structural descriptor coalescing.
- Add unit, real-Git, facade, declaration, and command-count proof.
- Document the integrity distinction and migration guidance.

## Non-Goals

- Changing complete validation semantics.
- Caching application payload pages or blobs, arbitrary full trees, refs, or
  CacheSet state.
- Moving CAS or cache ownership into git-warp.
- Replacing `@git-stunts/plumbing` or introducing a long-lived Git subprocess.
- Claiming a performance result before same-fixture measurements pass.

## Runtime / API Contract

```ts
interface BundleMemberReference {
  readonly version: 1;
  readonly path: string;
  readonly handle: ApplicationHandle;
  readonly type: 'blob' | 'tree';
  readonly size: number | null;
}

interface BundleCapability {
  getMemberReference(options: {
    handle: BundleHandleInput;
    path: string;
  }): Promise<BundleMemberReference | null>;

  iterateMemberReferences(options: {
    handle: BundleHandleInput;
  }): AsyncIterable<BundleMemberReference>;
}
```

A reference result proves:

1. the bundle root descriptor and persisted limits decoded successfully
2. the fanout path and summaries are structurally consistent
3. the named leaf descriptor is canonical
4. the direct Git tree edge exists and agrees with the encoded handle/type

It does not prove that the referenced target's complete support graph is
healthy. `getMember()`, `iterateMembers()`, `openMember()`, and `resolveRoot()`
remain the complete-validation and dereference surfaces.

## Data / State Model

No persisted schema changes. Reference reads consume existing bundle root,
fanout-node, and leaf descriptors. Metadata caches are process-local,
non-authoritative accelerators keyed only by immutable Git OID, structural
descriptor OID plus read bound, or exact `(treeOid, path)` identity.

## Architecture / Anti-SLUDGE Posture

- Bundle semantics remain in `BundleService`.
- Git command coalescing remains in `GitPersistenceAdapter`.
- Structural bundle descriptor coalescing remains in `BundleService`; the
  persistence adapter does not learn descriptor semantics.
- The facade exposes named capabilities; consumers do not import domain
  services or Git plumbing.
- One small bounded cache helper may be introduced if it removes duplicated LRU
  and rejected-promise handling.
- git-warp remains unable to manage raw CAS objects or invent a second cache.

## Cost / Residency Posture

- Every metadata cache has a fixed entry maximum.
- Structural descriptor bytes also have a fixed 16 MiB aggregate maximum;
  descriptors larger than the budget are returned but not retained.
- Values are immutable metadata, exact tree-entry records, or structural bundle
  descriptors, never application payloads.
- Successful concurrent reads for one key share one promise.
- Rejected reads are removed so transient failures are not cached.
- Access refreshes recency; insertion evicts the oldest entry.
- Returning data clones mutable record shapes so callers cannot mutate cached
  truth.
- Direct-reference iteration remains streaming and bounded by fanout depth plus
  descriptor limits.

## Git Substrate Impact

No new refs or object formats. The change reduces repeated `ls-tree`,
`cat-file --batch-check`, and structural descriptor `cat-file blob`
invocations. Cache acquisition refs continue to pin a generation and retain
their explicit release contract.

## Compatibility / Migration Posture

The API is additive. Existing methods and result types are unchanged. Consumers
that need transitive integrity continue using full-validation methods.
Consumers that need a manifest/index edge and will validate payloads on access
may adopt the reference methods.

## Error Contract

Reference methods retain existing bundle corruption, path, descriptor, fanout,
handle-edge, and direct target type/existence errors. They intentionally defer
errors below the direct target root until that target is dereferenced or fully
validated. Cached failures are never replayed as durable conclusions.

## Security / Trust / Redaction Posture

Direct references are not witnesses of transitive target health. Documentation
and types must not call them resolved or validated members. A malicious or
corrupt direct edge still fails closed. Full validation remains available and
is still mandatory for retention, publication, and doctor paths.

## Lower Modes

Memory persistence and non-Node runtimes keep the same domain semantics.
Metadata coalescing is an optimization of the default Git adapter only.

## Accessibility Posture

No visual interface changes. API and diagnostic terminology must distinguish
"reference" from "resolved member" without relying on color or symbols.

## User-Facing Text / Directionality

New prose uses plain English and code identifiers. No localization or text
direction assumptions are introduced.

## Agent Inspectability / Explainability Posture

Command-count tests expose whether a future change restores per-edge Git
chatter. Public method names encode the integrity level instead of hiding it in
an option boolean.

## Design Alternatives Considered

### Change `iterateMembers()` to shallow validation

Rejected. The published contract explicitly promises complete support-graph
validation. Silent weakening would be a security and compatibility regression.

### Add `validation: false`

Rejected. A boolean hides which guarantees remain. Separate reference methods
make the weaker but useful integrity posture explicit in code review.

### Cache whole trees and blobs

Rejected. Arbitrary Git trees and payloads can exceed memory. This would undo
the bounded-residency work the optimization exists to protect.

### Cache materializations in git-warp

Rejected. git-cas owns CAS lifecycle and caching. Duplicating that policy in a
consumer recreates split authority and stale-state risk.

### Use only targeted reads with no metadata coalescing

Rejected. It preserves memory bounds but repeats identical immutable Git
processes across hot reads. Fixed-size metadata coalescing has a stronger
latency/complexity tradeoff without becoming authoritative state.

## Decision

Ship explicit direct-reference bundle APIs and fixed-residency immutable
metadata coalescing together. Measure each contribution independently.

## Proof Surface

- `BundleService` unit tests distinguish direct-edge and transitive validation.
- Facade tests lock public method names and frozen capability shape.
- Declaration tests lock `BundleMemberReference` and method signatures.
- Git persistence tests prove coalescing, cloning, rejection eviction, and LRU
  bounds.
- Real-Git tests record command histograms for first and repeated reads.
- git-warp reruns the exact retained-property benchmark after publication.

## Implementation Slices

1. RED public reference API tests and design checkpoint.
2. Public facade, declarations, docs, and reference implementation.
3. RED metadata coalescing and residency tests.
4. Fixed-size adapter implementation and real-Git command-count proof.
5. Witness, self-review, code-lawyer review, PR, and release.

## Tests To Write First

- A direct reference survives a missing nested support object while
  `getMember()` fails complete validation.
- Reference iteration never calls the target resolver.
- Full iteration still detects a missing nested target.
- Duplicate object-info reads execute plumbing once.
- Duplicate exact tree-entry reads execute plumbing once.
- Concurrent duplicate reads share in-flight work.
- Failed reads are retried, not cached.
- Capacity overflow evicts the least recently used metadata entry.

## Acceptance Criteria

- Public declarations and frozen facade expose both reference methods.
- Existing full-validation tests remain green unchanged.
- No application payload or mutable ref state enters the metadata cache.
- Cache residence is mechanically bounded and tested.
- Direct-reference iteration is independent of nested target cardinality.
- Same-fixture git-warp command count and wall/CPU time materially improve.
- README/API/CHANGELOG and witness material state the exact guarantees.

## Validation Plan

- Focused BundleService, facade, declaration, and persistence tests.
- Real-Git integration and command-count tests.
- `pnpm run lint`.
- `pnpm test`.
- `pnpm test:integration` where the host permits it.
- Type declaration compile check.
- Package dry run/release verification before publication.

## Playback / Witness

Human playback questions:

1. Can an operator see before/after command count, CPU, wall, and RSS?
2. Does the design still fail closed for complete validation?
3. Is peak metadata residency explicitly bounded?

Agent playback questions:

1. Can an agent select the integrity posture from the method name alone?
2. Can it distinguish a direct-edge reference from a resolved member?
3. Can it consume a manifest without materializing unrelated targets?

Witness output belongs under `witness/` and includes exact commands, test
counts, and before/after JSON.

## Risks

- Consumers may mistake a reference for transitive integrity evidence.
- A cache may accidentally retain rejected work or mutable records.
- Too-small bounds may reduce hit rate; too-large bounds may waste memory.
- Command-count wins on one fixture may not generalize to deep fanout.
- Per-read acquisition refs may remain the next fixed-cost bottleneck.
- Successful metadata can outlive externally pruned, unretained objects within
  one adapter lifetime. Consumers must retain roots for the operation lifetime;
  destructive external pruning must not race active reads. Payload access
  performs authoritative Git I/O if that precondition is violated.

## Follow-On Debt

Persistent `cat-file` batching and longer-lived cache acquisition scopes remain
separate decisions unless evidence proves this cycle cannot meet its hill.

## Tracker Disposition

Issue #81 remains open until implementation, witness, PR review, and release
evidence satisfy every acceptance criterion.

## Done Does Not Mean

- Every git-warp operation is fast.
- Full support-graph validation is cheap.
- Payloads fit in memory.
- Cache acquisitions may be leaked or held forever.

## Retrospective

Pending merge and production benchmark evidence.
