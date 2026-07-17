---
title: "PERF-0048 - Scoped Cache Acquisitions"
cycle: "0048"
task_id: "scoped-cache-acquisitions"
legend: "PERF"
release_home: "v6.3.0"
issue: "https://github.com/git-stunts/git-cas/issues/69"
goalpost_issue: "https://github.com/git-stunts/git-cas/issues/69"
tracker_source: "github"
status: "active"
base_commit: "432c5d9effb12c9f66536f1386791bb4421f3cea"
owners:
  - "@git-stunts"
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: []
supersedes: []
superseded_by: null
created: "2026-07-16"
updated: "2026-07-17"
---

# PERF-0048 - Scoped Cache Acquisitions

## Linked Issue

- https://github.com/git-stunts/git-cas/issues/69

## Linked Tracker

- Milestone: `v6.3.0`
- Goalpost issue: https://github.com/git-stunts/git-cas/issues/69
- Slice issues: none currently

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

`CacheSet.acquire(key)` will perform a reference-only cache lookup and atomically
anchor the exact observed cache generation under a unique git-cas-managed ref.
It returns a `CacheAcquisition` whose explicit, idempotent `release()` removes
that anchor. The lookup does not recursively validate or account the target
support graph. Existing `get()` validation semantics remain compatible.

## Sponsored Human

An application author wants a warm cache hit to remain usable while it is being
consumed so that cache replacement, eviction, or aggressive pruning cannot
invalidate an in-flight read, without creating application-owned Git refs.

## Sponsored Agent

An agent needs a bounded and inspectable acquisition contract so it can consume
large cached materializations without inferring retention from a mutable cache
ref or accidentally traversing the complete support graph during lookup.

## Hill

By the end of this cycle, an application can acquire, consume, and release a
cache entry whose lookup cost is independent of the target support-graph size,
and real-Git tests prove that the target survives cache replacement and
aggressive pruning until release.

## Current Truth

- `CacheSet.get()` calls `#resolveTarget()` on every hit to recompute logical
  bytes. A bundle target therefore recursively validates its complete support
  graph before the caller receives the hit.
- `CacheIndex.getEntry()` already performs a targeted lookup through
  `BundleService.getMemberReference()` and reads only the selected entry
  metadata plus its direct target reference.
- `BundleService.iterateMemberReferences()` already streams direct member
  descriptors without recursively resolving nested targets.
- A `CacheHit` records the mutable cache ref and observed generation, but it is
  an observation witness, not a lifetime guarantee.
- Root-set cache generations are parentless commits. Their trees create real
  Git reachability edges through the cache index to every retained target.
- `GitRefPort` can update one ref but has no atomic source-verification plus
  anchor-creation operation and no generation-checked ref deletion operation.

## Problem

A consumer currently has two bad choices. It can call `get()` and pay a cost
that scales with the complete target graph, defeating a warm materialization
cache, or it can retain a bare handle after observing the cache and race cache
replacement or eviction. A handle is a locator, not a retention claim. The
application must not compensate by creating its own refs because git-cas owns
all CAS retention and cache policy.

## Scope

This cycle includes:

- a bounded `CacheSet.acquire(key)` operation
- a `CacheAcquisition` value with immutable hit/evidence fields
- explicit, idempotent `release()`
- an atomic adapter operation that verifies the source cache generation while
  creating a unique acquisition ref
- generation-checked acquisition-ref deletion
- bounded namespace-scoped acquisition inspection
- explicit operator cleanup of one observed acquisition
- repository-doctor acquisition count and age evidence
- declarations, API docs, README, changelog, tests, and release evidence

## Non-Goals

This cycle does not include:

- changing `CacheSet.get()` validation behavior
- automatic time-based revocation of active acquisitions
- application-owned refs, OIDs, or Git commands
- physical-byte attribution to one acquisition
- generic distributed locks
- git-warp materialization or causal-slicing implementation

## Runtime / API Contract

The application contract is:

```javascript
const acquisition = await cache.acquire(key);
if (acquisition === null) {
  return null;
}

try {
  return await consume(acquisition.hit.handle);
} finally {
  await acquisition.release();
}
```

`acquire(key)` returns `Promise<CacheAcquisition|null>`.

- A missing or expired entry returns `null` and creates no acquisition ref.
- A hit is selected through reference-only cache-index traversal.
- The operation atomically verifies that the cache ref still names the
  selected generation while creating a unique acquisition ref to that same
  generation.
- A concurrent cache-generation change retries from a fresh bounded lookup.
- Exhausted retries fail with a typed conflict; they never return an unanchored
  handle.
- Successful return means the acquisition ref reaches the selected cache
  generation and therefore its target support graph.

`CacheAcquisition` exposes:

```javascript
{
  id: '<opaque-acquisition-id>',
  hit: CacheHit,
  evidence: RetentionWitness,
  acquiredAt: '2026-07-16T00:00:00.000Z',
  release: async () => CacheAcquisitionRelease,
}
```

The acquisition evidence has policy `pinned`, reachability `anchored`, root
kind `cache-set`, and the same handle and generation as the hit. The retained
object is a cache-set generation; the acquisition ref identifies the scoped
retention mechanism. Reusing the existing root kind preserves the public closed
`RetentionRootKind` union. The hit retains its original cache policy and
observation evidence. These are two different facts: cache policy and scoped
retention.

`release()` on one acquisition object is idempotent. It deletes only the
acquisition ref whose current OID still equals the acquired generation. Its
result includes `changed`, `id`, `generation`, and `releasedAt`; calls after a
successful deletion reuse the receipt with `changed: false`. The production Git
adapter fails closed on a standalone checked-delete conflict, including an
apparently missing ref, because Git 2.43 cannot atomically distinguish absence
from an enumerator-invisible dangling symbolic ref.
A generation mismatch fails closed and does not delete the ref.

Namespace-scoped operator methods are bounded:

```javascript
const inspection = await cache.inspectAcquisitions({ limit });
await cache.releaseAcquisition({ id, expectedGeneration });
```

Inspection consumes no more than `limit + 1` records and returns acquisition
IDs, generations, canonical acquisition times, and a `truncated` flag. Cleanup
releases the returned page and repeats inspection while `truncated` is true;
there is no cursor that can force a hidden scan through skipped refs. Forced
release requires the expected generation from inspection. There is no automatic
age threshold because age alone cannot prove that a caller is dead.

## User Experience / Product Shape

The public runtime API is the user-visible contract. Ordinary callers use
`try/finally`; operators use bounded inspection plus generation-checked release.
No Git ref or OID is required by ordinary application code.

## Data / State Model

| State | Source of truth | Derived state | Invalid states | Reset behavior | Serialization | Determinism assumptions |
| --- | --- | --- | --- | --- | --- | --- |
| Cache entry | Cache generation ref | `CacheHit` | corrupt index/direct edge | cache repair | existing cache bundles | key digest is deterministic |
| Active acquisition | Unique acquisition ref | evidence and age | malformed ref or wrong target generation | explicit release | ref name plus target OID | ID nonce is unique; cross-host clock order is not assumed |
| Released acquisition | Absence of acquisition ref | release result | ref points to unexpected generation | fail closed | none | repeated release is a no-op |

The internal ref namespace is
`refs/cas/cache-acquisitions/<encoded-cache-namespace>/<acquisition-id>`. The
canonical cache namespace is percent-encoded into exactly one Git ref segment,
so parent and child collection namespaces cannot overlap during inventory. The opaque ID
encodes a version, canonical acquisition epoch, key digest, and random nonce so
inspection does not read target objects. Ref-name parsing is strict and
malformed or enumerated symbolic managed refs are reported by doctor. Missing
ref-type evidence is unhealthy rather than assumed direct.

## Architecture / Anti-SLUDGE Posture

| Concern | Decision |
| --- | --- |
| Domain changes | Add `CacheAcquisition`, acquisition ref/value parsing, and lifecycle service |
| Port changes | Add optional semantic anchor, checked delete, and bounded ref iteration capabilities without breaking legacy structural adapters |
| Adapter changes | Preflight symbolic refs for ordinary and acquisition mutations, use `git update-ref --no-deref` to contain type races, re-probe after checked-delete conflicts, and pass a hard `for-each-ref --count` bound |
| Boundary validation | Validate namespace, key digest, OIDs, timestamps, nonce, and expected generation |
| Runtime-backed nouns introduced | Acquisition is backed by an actual Git ref, not metadata alone |
| Expected failure representation | Typed miss, conflict, invalid-ref, and release-conflict outcomes |
| Banned shortcuts avoided | No app refs, whole-target validation, shadow cache, implicit TTL, or raw-OID API |

## Cost / Residency Posture

| Surface | Current cost | Target cost | Limit/budget | Failure mode |
| --- | --- | --- | --- | --- |
| `get(key)` | complete target validation | unchanged compatibility | bundle limits | existing typed errors |
| `acquire(key)` | absent | cache root plus targeted index path and one ref transaction | retry bound | miss or typed conflict |
| acquisition inspection | absent | exact encoded namespace prefix and bounded first page | required `limit + 1` ceiling | invalid/symbolic managed-ref error |
| release | absent | one checked ref deletion | one ref | mismatch fails closed |

`acquire()` cost may scale with cache-index depth, but not with target member
count, target nesting depth, or target logical bytes. It does not read target
payloads and does not recompute logical-byte accounting.

## Git Substrate Impact

| Substrate area | Impact |
| --- | --- |
| refs | New managed acquisition-ref namespace; atomic create and checked delete |
| commits | Acquisition refs point directly to existing parentless cache-generation commits |
| trees/blobs | No new tree or blob format |
| object ids | Remain adapter/domain evidence; ordinary consumers use handles and IDs |
| tag/release behavior | v6.3.0 package and tag after merge |
| migration compatibility | No migration; old caches are immediately acquirable |

The anchor transaction verifies the source cache ref and creates the target
acquisition ref in one Git ref transaction. There is no instant at successful
linearization when neither ref reaches the selected generation.

## Compatibility / Migration Posture

| Concern | Decision |
| --- | --- |
| Public API compatibility | Additive; existing methods retain behavior |
| Package export changes | Export acquisition value/type and new methods |
| Storage/read compatibility | Existing cache generations remain valid |
| Legacy behavior retained | `get()` continues full target validation |
| Deprecation behavior | None in this cycle |
| Migration path | None required |
| Release note impact | Document scoped retention and bounded-read distinction |

## Error Contract

| Failure | Error/result | Caller recovery | Test |
| --- | --- | --- | --- |
| key absent/expired | `null` | recompute value | unit and integration |
| source generation changed | bounded retry | transparent until exhausted | injected race |
| retry exhausted | `CACHE_ACQUISITION_CONFLICT` | retry operation | unit |
| malformed managed ref | `CACHE_ACQUISITION_INVALID`/doctor issue | inspect and repair | unit |
| repeated release on one acquisition object | cached receipt with `{ changed: false }` | none | idempotence test |
| standalone release cannot prove direct ref | typed release conflict | none | missing/dangling conflict tests |
| release generation mismatch | `CACHE_ACQUISITION_RELEASE_CONFLICT` | re-inspect; do not delete | unit |
| direct target corruption after acquire | existing read/resolve error | doctor/repair cache | integration |

## Security / Trust / Redaction Posture

- trust boundary: Git refs and immutable object edges are authoritative.
- authority or capability checked: possession of a CacheSet permits acquisition;
  forced release additionally requires the observed acquisition ID and expected
  generation.
- secret-bearing values: none. Keys are represented in refs only by SHA-256
  digest; random nonces are not credentials.
- redaction behavior: doctor does not emit original cache keys.
- log/report behavior: reports IDs, age, namespace, and generation, not payloads.
- clock posture: future-dated valid refs remain healthy with unknown age and an
  explicit clock-skew issue; elapsed time does not determine ref validity.
- abuse or replay concern: acquisition-ref accumulation can retain storage;
  bounded inspection and explicit cleanup make that debt visible and removable.

## Lower Modes

The API is machine-readable JavaScript and JSON evidence. Documentation uses a
linear `try/finally` example. No visual-only state is introduced.

## Accessibility Posture

Not a rendered feature. API docs, errors, doctor output, and witness files use
stable labels and a linear reading order.

## User-Facing Text / Directionality

New docs and error strings are concise ASCII English. Structured fields carry
the canonical machine meaning; prose is explanatory only.

## Agent Inspectability / Explainability Posture

Agents can inspect immutable acquisition fields, release results, bounded
inspection pages, and repository-doctor acquisition totals without scraping
logs or traversing the target graph.

## Linked Invariants

- A handle is a locator, not a durability claim.
- git-cas alone owns CAS retention and cache refs.
- Reachability requires actual Git edges, never OID strings in metadata alone.
- Mutable refs are coordination boundaries; returned evidence names the exact
  observed generation.
- Large cached targets must be consumable without whole-target lookup work.
- Cleanup must never delete a ref whose generation differs from the caller's
  observation.

## Design Alternatives Considered

### Return a bare reference-only CacheHit

Pros:

- Minimal implementation.

Cons:

- Leaves the eviction/prune race unresolved.
- Encourages callers to mistake observation for retention.

### Make every `get()` pin forever

Pros:

- Simple caller behavior.

Cons:

- Converts reads into unbounded durable retention.
- Defeats CacheSet eviction policy and leaks storage.

### Reuse `RootSet.retain()` after lookup

Pros:

- Reuses a public retention primitive.

Cons:

- Recursively validates the complete target graph.
- Has a race between cache observation and retention.
- Creates a separate durable policy instead of a scoped acquisition.

### Use reflog grace as the lease

Pros:

- No new refs.

Cons:

- Fails under aggressive prune and repository-specific reflog policy.
- Cannot produce a precise release or lifetime witness.

### Add an implicit TTL lease

Pros:

- Automatically bounds abandoned retention.

Cons:

- Can silently revoke a valid long-running consumer.
- Requires renewal and distributed-clock policy before correctness is clear.

### Atomic generation acquisition ref

Pros:

- Bounded lookup, exact linearization, real Git reachability, explicit release.
- Keeps all retention policy inside git-cas.

Cons:

- One temporary ref per active acquisition.
- Crashed callers require visible operator cleanup.

## Decision

Use an atomic generation acquisition ref. Prefer explicit lifetime correctness
over an implicit timeout. Make abandoned refs visible and generation-checked
for operator cleanup rather than guessing that age proves liveness.

## Proof Surface

The implementation must be proven through:

- actual surface under test: public `cas.caches.open()` CacheSet API against
  memory and real Git adapters
- first RED test: `CacheSet.acquire()` returns an anchored acquisition without
  calling the recursive target resolver
- required witness command: focused unit/integration tests plus full test,
  lint, declarations, docs, and release verification
- non-acceptable proof: controller mocks, documentation claims, or object-count
  assertions without instrumented Git reads and aggressive-prune behavior

## Implementation Slices

- Add failing CacheSet acquisition and adapter transaction tests.
- Add acquisition value/ref/lifecycle domain types and errors.
- Add semantic port operations and Git/memory adapter implementations.
- Wire CacheSet/registry/facade declarations and bounded inspection.
- Extend repository doctor, docs, changelog, witnesses, and release checks.

## Tests To Write First

Behavior tests required:

- [x] A hit acquires without invoking `resolveHandle`.
- [x] A miss or expired entry writes no acquisition ref.
- [x] A generation race retries and never returns an unanchored handle.
- [x] Cache replacement plus aggressive prune preserves an acquired target.
- [x] Release is idempotent and makes the old generation collectible afterward.
- [x] Forced cleanup rejects an unexpected generation.
- [x] Lookup Git-read counts do not scale with target graph size.
- [x] Doctor reports acquisition counts and ages without key disclosure.

Rule: documentation tests cannot be the only proof for implementation work.

## Acceptance Criteria

The work is done when:

- [x] Behavior tests prove bounded acquisition and scoped reachability.
- [x] Real-Git prune evidence proves lifetime correctness.
- [x] Inspection and checked cleanup prove abandoned anchors are manageable.
- [x] Existing cache, root-set, bundle, doctor, and facade tests remain green.
- [x] Public declarations and docs match runtime behavior.
- [x] README, changelog, release notes, and witness are updated.
- [ ] Issue and PR are linked correctly.
- [ ] CI, Code Rabbit, self-review, and independent Code Lawyer review are clean.
- [ ] v6.3.0 is published before git-warp consumes the API.

## Validation Plan

Commands expected before PR:

```bash
npx eslint .
npm test
npm run release:verify -- --skip-jsr
```

Focused unit, adapter, facade, declaration, docs, and real-Git integration tests
will run before the full suite.

## Playback / Witness

The witness records:

- the exact instrumented read-count comparison for small and large targets
- the real-Git ref topology before acquisition, after cache replacement, and
  after release
- aggressive-prune results while acquired and after release
- release idempotence and checked-cleanup output
- full validation command results

Human playback question: can an application safely get the warm-cache speedup
without learning Git or risking in-flight collection?

Agent playback question: can an agent distinguish a cache observation from an
active scoped retention claim using structured fields alone?

## Risks

Known risks:

- crashed callers can leave acquisition refs
- ref churn can be high for very short reads
- a malformed acquisition namespace could confuse diagnostics
- concurrent Git maintenance behavior must match the atomic-ref proof

Mitigations:

- doctor reports count and age; explicit checked cleanup is available
- callers acquire only around actual target consumption
- strict versioned ref parsing fails closed
- integration tests use real Git transactions and aggressive pruning

## Follow-On Debt

An automatic renewable TTL lease may be designed later if operational evidence
shows explicit cleanup is insufficient. It must not be smuggled into this cycle
without a renewal and clock-authority design.

## Tracker Disposition

| Issue | Role | Expected disposition |
| --- | --- | --- |
| https://github.com/git-stunts/git-cas/issues/69 | primary goalpost | close after v6.3.0 release evidence |
| https://github.com/git-stunts/git-warp/issues/738 | downstream blocked-by | leave open; update after package publication |

## Done Does Not Mean

When this lands, it does not prove:

- that every cache consumer uses acquisitions
- that `CacheSet.get()` is bounded for nested bundle targets
- that acquisition refs have automatic crash recovery
- that git-warp causal materialization is fully bounded

## Retrospective

Fill this in after implementation.

PR:

- none currently
