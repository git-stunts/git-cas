---
schema: 'method.design/v1'
cycle: '0051'
slug: 'bounded-page-payload-reuse'
status: 'active'
sponsor_human: 'James Ross'
sponsor_agent: 'Codex'
created: '2026-07-18'
updated: '2026-07-18'
issue: 'https://github.com/git-stunts/git-cas/issues/85'
milestone: 'v6.5.1'
---

# PERF-0051 - Bounded Page Payload Reuse

## Linked Issue

- [#85 - perf: bound and reuse immutable page payload reads](https://github.com/git-stunts/git-cas/issues/85)

## Decision Summary

Reuse successful `pages.get()` payload reads in a process-local LRU keyed by
immutable page OID. Residence is bounded independently by entry count and total
payload bytes. Every caller receives a copy, rejected reads are removed, and a
value larger than the byte budget is returned to its current caller without
remaining resident or evicting unrelated entries.

`pages.open()` remains an uncached streaming operation. The cache is an
acceleration of the already bounded collecting API, not a reason to buffer the
streaming API.

## Current Truth

- v6.5.0 coalesces immutable Git object metadata, exact tree entries, and bundle
  descriptor bytes.
- `PageService.get()` still starts a fresh `cat-file blob` stream for every call.
- A git-warp retained-property fixture performed 16 identical reads in 2.61
  seconds, including 32 blob reads and a 1.80-second time to first reading.
- Page OIDs are immutable, and `get()` already enforces both the configured page
  limit and the caller's lower operation limit.

## Scope

- Add page payload cache entry and byte bounds to `ContentAddressableStore`.
- Share successful in-flight and completed `get()` work by page OID.
- Preserve per-call `maxBytes` checks for warm and cold reads.
- Clone cached bytes before returning them.
- Prove rejection retry, LRU eviction, byte-budget behavior, and real-Git warm
  command elimination.
- Document the residency and lifetime assumptions.

## Non-Goals

- Caching `pages.open()` streams.
- Caching unbounded assets, arbitrary Git blobs, refs, or mutable collection
  state.
- Establishing retention. A cache hit is not a retention witness.
- Surviving destructive external pruning that races an active store instance.
- Solving path-local persistent bundle updates; that work is tracked in
  [#86](https://github.com/git-stunts/git-cas/issues/86).

## Runtime Contract

```ts
interface ContentAddressableStoreOptions {
  maxPageSize?: number;       // default 16 MiB
  pageCacheEntries?: number;  // default 128
  pageCacheBytes?: number;    // default 8 MiB
}
```

The cache allocates no fixed arena. Its actual residence is the sum of retained
payload byte lengths plus bounded completed-entry overhead. In-flight reads are
tracked separately so capacity pressure cannot break coalescing; their memory
follows caller concurrency and the configured per-page size bound. A configured
byte bound of zero disables non-empty completed payload residence while
preserving in-flight coalescing.

## Correctness Invariants

1. Cache identity is the immutable Git blob OID carried by a validated
   `PageHandle`.
2. Every call parses its `PageHandle`. A cold payload miss validates object type
   and size before reading; a resident or in-flight hit reuses that immutable
   OID validation without another metadata access.
3. Cold misses check the caller's effective byte limit before starting a payload
   read. Every resolved payload, including warm and shared in-flight hits, is
   checked again against the current caller's limit.
4. Returned `Uint8Array` values never alias resident bytes.
5. Rejected work is absent before its returned promise settles.
6. An individually oversized resolved value cannot evict unrelated residents.
7. Streaming page reads never enter the payload cache.

## Residency Posture

The defaults retain at most 128 page payloads and 8 MiB of payload bytes. Both
bounds are configurable downward. Payloads larger than the byte budget remain
readable but are not retained. This keeps correctness independent of cache
capacity and lets low-heap consumers explicitly choose their residency ceiling.

## Compatibility

No persisted formats, handles, refs, witnesses, or existing method signatures
change. Constructor options are additive. `pages.get()` returns the same bytes
and errors as before; only repeat-read command count changes.

## Alternatives Considered

### Cache page bytes in git-warp

Rejected. git-cas owns immutable CAS access and cache policy. A consumer-local
cache would duplicate authority and produce inconsistent residency controls.

### Cache all blob streams in GitPersistenceAdapter

Rejected. Persistence serves assets and metadata with different boundedness and
streaming contracts. `PageService` is the layer that knows a payload is an
admitted bounded page.

### Cache `pages.open()`

Rejected. It would silently turn a streaming API into a collecting API and make
memory behavior depend on access history.

### Retain no payloads

Rejected by measurement. Immutable metadata reuse alone leaves one Git process
and full payload read per repeated exact observation.

## Proof Surface

- Unit tests cover concurrent coalescing, caller-copy isolation, entry LRU,
  aggregate byte bounds, oversized-value behavior, rejected-read retry, and
  option validation.
- A Docker real-Git test proves an identical warm `pages.get()` performs zero
  additional Git commands.
- git-warp reruns its retained-property CPU, wall, command-count, and bounded
  memory scenarios against the published patch release.

## Acceptance Criteria

- `pages.get()` warm reads issue no payload Git command.
- Residence is bounded by entries and bytes.
- Streaming semantics and retention authority are unchanged.
- Public declarations and API documentation expose exact defaults.
- Node, Bun, and Deno release verification remains green.
