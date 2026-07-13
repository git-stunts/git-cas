# API-0047 CacheSet Lifecycle Witness

Implementation slice: [#59](https://github.com/git-stunts/git-cas/issues/59)

Implementation commit: `1fc036112c489c17dd87a78be6421e938df52253`

Review-hardening commits:

- `188662645da60abb1e579e1762f3bae272c23c0c`
- `a17836884e21428f88843a23de9535d66f4ddce0`
- `fc29ff934722d61f841d5f7e1c7eaf74d8b57b60`
- `7167b5d90e77abfb886b92d9a4f9771558367fb7`

## Claim

Applications can delegate cache indexes, Git reachability, guarded replacement,
expiry, capacity, approximate recency, diagnostics, and authoritative repair to
`git-cas`. A CacheSet stores immutable pages and bundles below one parentless,
compare-and-swap current-generation ref; removing an entry releases its target
without deleting objects or running Git garbage collection.

## Source Evidence

- The public facade exposes only the frozen `caches.open()` capability and wires
  it to the same page, bundle, crypto, object, and ref adapters as other managed
  application storage. The registry itself is not a package-root API.
  [cite: `index.js#176-182@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `index.js#281-290@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CacheSetRegistry.js#26-56@a17836884e21428f88843a23de9535d66f4ddce0`]
- Canonical collection namespaces map injectively below
  `refs/cas/caches/*`; lowercase ASCII, component, length, reserved-name, and
  ref-safety rules reject ambiguous input before a write.
  [cite: `src/domain/value-objects/CollectionNamespace.js#4-49@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/value-objects/CacheSetRef.js#5-31@a17836884e21428f88843a23de9535d66f4ddce0`]
- Each generation anchors exactly one structured bundle index. The index stores
  one bounded state page plus ordered entry bundles whose `meta` page and
  `target` edge are real Git reachability edges, not OIDs hidden in metadata.
  [cite: `src/domain/services/CacheIndex.js#30-52@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CacheIndex.js#91-100@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CacheIndex.js#135-153@a17836884e21428f88843a23de9535d66f4ddce0`]
- RootSet publication validates target edges, writes a parentless generation,
  and updates the namespaced ref with an expected-old compare-and-swap. Its
  mutation loop rereads current truth and reruns the callback after conflicts.
  [cite: `src/domain/services/RootSetPersistence.js#134-153@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/RootSetPersistence.js#208-225@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/RootSet.js#197-232@a17836884e21428f88843a23de9535d66f4ddce0`]
- `get()` performs a targeted key lookup, treats expiry as a non-mutating miss,
  resolves only the selected target graph, verifies logical-byte accounting,
  and returns generation-consistent immutable retention evidence.
  [cite: `src/domain/services/CacheSet.js#43-56@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CacheSet.js#472-485@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/value-objects/CacheHit.js#12-45@a17836884e21428f88843a23de9535d66f4ddce0`]
- Writes validate the proposed target before mutation but stage entry objects
  only after existence and expected-handle guards succeed. Every retry clears
  attempt-local lifecycle state before evaluating the newly observed winner.
  [cite: `src/domain/services/CacheSet.js#311-336@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `test/unit/domain/services/CacheSet.test.js#129-163@a17836884e21428f88843a23de9535d66f4ddce0`]
- Cache inventory reads and rewrites stream shallow, direct Git references.
  Scans retain counters and two fixed-size candidate heaps, while full target
  graph resolution is reserved for a selected hit or explicit doctor audit.
  [cite: `src/domain/services/BundleService.js#204-268@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CacheIndex.js#76-132@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `test/unit/domain/services/CacheSet.test.js#247-258@a17836884e21428f88843a23de9535d66f4ddce0`]
- Expiry is applied first; then deterministic oldest eligible entries are
  removed until `maxEntries` and `maxBytes` are met. Pinned entries are excluded
  from capacity eviction and an unsatisfied pinned-only state is reported.
  [cite: `src/domain/services/CachePolicyEnforcer.js#15-48@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CachePolicyEnforcer.js#71-105@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/value-objects/CachePolicy.js#4-27@a17836884e21428f88843a23de9535d66f4ddce0`]
- Canonical, versioned metadata validates keys, handles, digests, timestamps,
  policy values, accounting values, counts, and state consistency. Reads also
  recompute the key digest and verify the target edge identity.
  [cite: `src/domain/services/CacheMetadataCodec.js#10-78@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CacheIndex.js#199-215@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CacheIndex.js#257-272@a17836884e21428f88843a23de9535d66f4ddce0`]
- `doctor()` is non-mutating and recomputes canonical state, entry shape, target
  support, and logical bytes. `repair()` ignores malformed current metadata and
  publishes only caller-authoritative, bounded, duplicate-free entries.
  [cite: `src/domain/services/CacheSet.js#205-275@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CacheSet.js#278-309@a17836884e21428f88843a23de9535d66f4ddce0`]
  [cite: `src/domain/services/CacheIndex.js#156-177@a17836884e21428f88843a23de9535d66f4ddce0`]

## Real Git Evidence

The Docker-gated integration proof creates a bare Git repository and verifies:

- a staged page is prunable before insertion and retained afterward;
- the CacheSet generation is parentless and its witness names the current ref;
- removal makes the old target prunable while preserving the winning index;
- concurrent writers retain independent keys;
- guarded replacement admits one winner and leaves the loser prunable;
- expiry and capacity eviction release targets; and
- pinned targets survive ordinary capacity sweeps.

[cite: `test/integration/cache-set.test.js#45-149@a17836884e21428f88843a23de9535d66f4ddce0`]

## Self-Review

The implementation was reviewed against #59 and API-0047 for object ownership,
publication order, concurrency, bounded residency, deterministic accounting,
retention evidence, malformed-state handling, repair authority, runtime
portability, and additive semver posture.

- CacheSet never invokes Git GC and never deletes an object.
- The only mutable datum is the current-generation ref; every cache state,
  entry, bundle, page, target, and returned evidence object is immutable.
- Rejected guards perform no cache-owned object write.
- Failed compare-and-swap attempts may leave harmless unanchored immutable
  objects, but cannot remove or misidentify the winning generation.
- Ordinary scans do not resolve target support graphs or retain an inventory
  proportional to cache cardinality.
- Doctor deliberately performs deeper work than ordinary reads and sweeps.
- Graft reports no removed export or breaking signature; the package-root
  surface change is additive and has minor-version impact.

## Code Lawyer Review

### CL-001: Retry callbacks could leak a failed attempt's success

`RootSet.mutate()` may rerun callbacks after a compare-and-swap conflict. Every
CacheSet callback now resets attempt-local lifecycle output before examining the
new generation; guarded replacement and concurrent removal prove only one
winner reports mutation evidence.
[cite: `src/domain/services/CacheSet.js#67-115@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `test/unit/domain/services/CacheSet.test.js#327-386@a17836884e21428f88843a23de9535d66f4ddce0`]

### CL-002: Rejected guards could manufacture avoidable garbage

Target validation remains before mutation, but metadata pages and entry bundles
are staged only after the current key and expected handle pass. A rejected guard
leaves object counts unchanged.
[cite: `src/domain/services/CacheSet.js#311-375@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `test/unit/domain/services/CacheSet.test.js#147-163@a17836884e21428f88843a23de9535d66f4ddce0`]

### CL-003: A streaming iterator performed a cardinality-sized preflight

Bundle iteration now yields each validated member before reading later members,
and the CacheSet-specific reference iterator retains only fanout state and
counters. Cache scans use that shallow iterator instead of complete target
resolution.
[cite: `src/domain/services/BundleService.js#204-268@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `test/unit/domain/services/BundleService.test.js#197-244@a17836884e21428f88843a23de9535d66f4ddce0`]

### CL-004: Sweeps recursively resolved every cached target

Internal prevalidated-reference writes verify direct Git object type and page
size without retraversing previously admitted support graphs. `get()` resolves
one selected target; doctor is the explicit full-accounting audit.
[cite: `src/domain/services/BundleService.js#335-374@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `src/domain/services/CacheSet.js#344-363@a17836884e21428f88843a23de9535d66f4ddce0`]

### CL-005: Persisted logical bytes were not compared with live targets

Selected hits and doctor recompute target logical bytes and fail closed on a
mismatch. Sweeps use the already validated, versioned persisted accounting as
specified, avoiding full target hydration during policy evaluation.
[cite: `src/domain/services/CacheSet.js#43-56@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `src/domain/services/CacheSet.js#205-248@a17836884e21428f88843a23de9535d66f4ddce0`]

### CL-006: Malformed Unicode keys could collide after UTF-8 replacement

Cache keys reject isolated UTF-16 surrogates before normalization and hashing,
in addition to rejecting non-NFC, control-bearing, empty, and oversized input.
[cite: `src/domain/value-objects/CacheKey.js#27-57@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `test/unit/domain/value-objects/CacheCollectionValues.test.js#34-45@a17836884e21428f88843a23de9535d66f4ddce0`]

### CL-007: Malformed index member kinds and extra entry edges were accepted

Outer entry paths must point to bundles, and doctor requires each entry bundle
to contain exactly canonical `meta` and `target` members. Direct corruption
tests prove both failures map to `CACHE_STATE_INVALID`.
[cite: `src/domain/services/CacheIndex.js#68-87@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `src/domain/services/CacheIndex.js#156-177@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `test/unit/domain/services/CacheSet.test.js#307-324@a17836884e21428f88843a23de9535d66f4ddce0`]

### CL-008: An internal registry escaped the package root

`CacheSetRegistry` is now internal. The public root exposes the CacheSet result
type and `cas.caches.open()` capability, while TypeScript prevents direct
CacheSet construction.
[cite: `index.js#58-72@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `index.d.ts#780-822@a17836884e21428f88843a23de9535d66f4ddce0`]

### CL-009: Repair admitted duplicate authoritative keys

Repair now rejects both duplicate keys and digest collisions before publishing
a generation, and remains bounded to the maximum representable cache entries.
[cite: `src/domain/services/CacheSet.js#278-309@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `test/unit/domain/services/CacheSet.test.js#292-303@a17836884e21428f88843a23de9535d66f4ddce0`]

### CL-010: Public diagnostics could expose mutable nested policy data

Canonical entry/state objects and nested policy records are frozen before they
leave codecs or policy construction; CacheHit also validates and freezes its
handle, generation, policy, timestamps, and retention evidence.
[cite: `src/domain/services/CacheMetadataCodec.js#25-78@a17836884e21428f88843a23de9535d66f4ddce0`]
[cite: `src/domain/value-objects/CacheHit.js#12-45@a17836884e21428f88843a23de9535d66f4ddce0`]

## Pull Request Review Follow-up

Bun exposed that its plumbing runner can return an empty stderr for a missing
`git cat-file -t` target. Git object type and size inspection now use the
structured `cat-file --batch-check` protocol: missing objects are explicit
stdout records, malformed metadata fails closed, and genuine command failures
remain errors. Unit tests pin the command shape, missing response, malformed
response, and non-missing failure behavior.
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#190-238@fc29ff934722d61f841d5f7e1c7eaf74d8b57b60`]
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.readTree.test.js#93-140@fc29ff934722d61f841d5f7e1c7eaf74d8b57b60`]

CodeRabbit's four actionable findings were valid and resolved: `logicalBytes`
has one non-null public type, cache-state version fields share codec constants,
the removal reachability proof owns its fixture and namespace, and the bounded
candidate test exercises digest ordering at an equal-time tie.
[cite: `index.d.ts#336-352@7167b5d90e77abfb886b92d9a4f9771558367fb7`]
[cite: `src/domain/services/CachePolicyEnforcer.js#4-7@7167b5d90e77abfb886b92d9a4f9771558367fb7`]
[cite: `src/domain/services/CachePolicyEnforcer.js#56-72@7167b5d90e77abfb886b92d9a4f9771558367fb7`]
[cite: `test/integration/cache-set.test.js#73-84@7167b5d90e77abfb886b92d9a4f9771558367fb7`]
[cite: `test/unit/domain/services/CacheCandidateHeap.test.js#5-17@7167b5d90e77abfb886b92d9a4f9771558367fb7`]

## Residual Constraints

- CacheSet releases reachability; it does not run GC. Other refs, reflogs, or
  duplicate object graphs may legitimately keep released objects alive.
- Approximate LRU changes only through explicit, coalesced `touch()` calls.
- Doctor is O(index plus retained support graphs) time by design; ordinary
  inventory and policy operations are the bounded-residency paths.
- Failed writes and failed authoritative repairs may leave immutable unanchored
  objects. This is safe CAS residue and is preferable to deleting a concurrent
  writer's possible winner.
- All currently accepted application-handle kinds have deterministic logical
  size. CacheSet fails closed with `CACHE_LOGICAL_SIZE_UNKNOWN` rather than
  silently admitting a future legacy handle with unknown accounting.
- Inspection cursors order by key digest and do not pin a multi-call snapshot;
  callers can compare the returned generation when strict pagination matters.

## Validation

- `pnpm lint`
- `pnpm test`
- `GIT_STUNTS_DOCKER=1 pnpm test:integration`
- `pnpm exec tsc --noEmit --skipLibCheck --module NodeNext --moduleResolution NodeNext --target ES2022 index.d.ts`
- `git diff --check`
- Graft structural review: no breaking changes; additive minor semver impact
