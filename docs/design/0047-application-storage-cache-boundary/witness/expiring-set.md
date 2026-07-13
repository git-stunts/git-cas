# API-0047 ExpiringSet Lifecycle Witness

Implementation slice: [#53](https://github.com/git-stunts/git-cas/issues/53)

Implementation commit: `17e9679b2de1416abe3de7e6a50841b6186c0c26`

Review-hardening commits:

- `5fbe903634d45eee8aab82ac7f9def83ba4857e2`
- `3dcd1f4c846549e08c2c357f002e19fd11450672`
- `cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`
- `bf66f6e5247284975631ffdfaabdc15fdb0e25d4`
- `b00d7abfa830a432e156d5aa037657a5dad98e82`
- `a34feb40f82e7246eaf554a21246e18204611224`
- `82f540a95a0dbb3b4f0791b63fe077d37a7122dc`

## Claim

Applications can delegate security-sensitive replay markers to `git-cas`.
ExpiringSet atomically admits one marker per canonical key, stores no plaintext
key, anchors every marker through its declared acceptance window, survives
process restart, and releases only expired support. It exposes no removal,
repair, capacity, or recency policy that could evict a live marker early.

## Source Evidence

- The public facade exposes a frozen `expiringSets.open()` capability and the
  application-facing `ExpiringSet` and `ExpiringMarker` values. TypeScript makes
  construction private and declares only membership, admission, expiry sweep,
  bounded inspection, and doctor operations.
  [cite: `index.js#63-76@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `index.js#93-96@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `index.js#179-188@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `index.d.ts#883-913@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
- Canonical namespaces map below `refs/cas/expiring/*`. Opening accepts only a
  namespace and RootSet retry policy; capacity and eviction fields fail instead
  of being silently ignored.
  [cite: `src/domain/services/ExpiringSetRegistry.js#11-54@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSetRegistry.js#85-97@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/value-objects/ExpiringSetRef.js#5-42@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
- Keys must cross the canonical Unicode collection-key boundary. Two
  domain-separated SHA-256 values provide the deterministic index and a
  collision verifier; malformed or domain-collapsing crypto adapters fail
  closed.
  [cite: `src/domain/value-objects/ExpiringSetKey.js#5-27@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSet.js#10-13@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSet.js#357-378@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
- Persisted marker pages contain only canonical versioned digests and lifecycle
  timestamps. The codec rejects extra, reordered, invalid, equal-domain, or
  internally inconsistent metadata and freezes normalized records.
  [cite: `src/domain/services/ExpiringSetMetadataCodec.js#10-45@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSetMetadataCodec.js#47-81@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSetMetadataCodec.js#97-115@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
- Each RootSet generation anchors exactly one structured bundle. Its bounded
  state page and ordered `markers/<digest>` page edges are ordinary transitive
  Git reachability; scans and rewrites consume the bundle iterator without
  retaining an array proportional to marker cardinality.
  [cite: `src/domain/services/ExpiringSetIndex.js#26-50@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSetIndex.js#52-116@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSetIndex.js#119-171@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
- RootSet publication validates targets, writes a parentless generation, and
  updates the namespaced ref with expected-old compare-and-swap. A conflict
  causes a fresh read and callback evaluation before another attempt.
  [cite: `src/domain/services/RootSetPersistence.js#134-153@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/RootSetPersistence.js#208-225@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/RootSet.js#197-224@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
- Admission validates expiry on every mutation attempt, clears retry-local
  result state, checks an existing marker before staging any object, and
  publishes only after persisted state agrees with historical marker edges.
  [cite: `src/domain/services/ExpiringSet.js#45-110@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSet.js#336-355@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
- `contains()` performs a targeted, non-mutating lookup. `sweep()` validates
  current state and rewrites only when expired markers exist; its rewrite
  predicate cannot remove a live marker.
  [cite: `src/domain/services/ExpiringSet.js#34-43@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSet.js#113-160@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSetIndex.js#133-157@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
- Returned marker evidence is immutable, generation-scoped, names the physical
  RootSet slot, and is valid only when observed before expiry. Inspection is
  digest-only and bounded; doctor checks nested support and recomputes state.
  [cite: `src/domain/value-objects/ExpiringMarker.js#10-59@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/value-objects/ExpiringMarker.js#65-78@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSet.js#162-208@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSet.js#210-265@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
  [cite: `src/domain/services/ExpiringSet.js#294-324@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]

## Real Git Evidence

The Docker-gated integration proof creates a bare Git repository and verifies:

- marker bytes omit the plaintext key;
- the witness path is an actual generation-tree edge and the marker page is
  transitively reachable from the current ref;
- the current generation is parentless and `contains()` does not move it;
- both facade recreation and a new plumbing adapter recover the marker from
  Git alone;
- an expired marker remains non-prunable before sweep and becomes prunable
  after sweep while the winning index stays retained; and
- concurrent duplicate insertion has one winner while every live marker
  survives collection pressure and an ordinary sweep.

[cite: `test/integration/expiring-set.test.js#64-130@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]

## Self-Review

The implementation was reviewed against #53 and API-0047 for replay-window
integrity, publication order, concurrent writers, restart behavior, key
privacy, collision handling, bounded residency, immutable evidence, malformed
state, clock behavior, and additive semver posture.

- ExpiringSet never invokes Git GC and never deletes an object. Release means a
  new parentless generation no longer reaches expired support.
- The only mutable datum is the namespaced current-generation ref. Marker,
  state, page, bundle, generation, result, and witness values are immutable.
- A duplicate live-key rejection stages no object and returns the generation
  and evidence observed from authoritative Git state.
- There is deliberately no `remove()`, `repair()`, capacity, or LRU path. The
  only ordinary release predicate is `expiresAt <= now`.
- Reads and lifecycle scans are targeted or streaming. `inspect()` retains at
  most its explicit page limit; no process-level cache is authoritative.
- Graft reports no removed export or breaking signature. The package-root
  surface is additive and has minor-version impact.

## Code Lawyer Review

### CL-001: Digest domains could collapse under a faulty crypto adapter

Both outputs must be canonical lowercase 64-character digests and must differ.
A second key that shares a primary digest must match the persisted verification
digest or all membership and admission operations fail closed.
[cite: `src/domain/services/ExpiringSet.js#357-378@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `src/domain/services/ExpiringSet.js#457-465@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `test/unit/domain/services/ExpiringSet.test.js#361-388@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]

### CL-002: A conflict retry could admit an already-expired window

Every RootSet callback re-reads the clock and revalidates the requested expiry.
Attempt-local winner state is reset on every callback. Returned evidence also
requires an observation timestamp strictly before marker expiry.
[cite: `src/domain/services/ExpiringSet.js#45-83@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `src/domain/value-objects/ExpiringMarker.js#65-78@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `test/unit/domain/services/ExpiringSet.test.js#189-216@a34feb40f82e7246eaf554a21246e18204611224`]

### CL-003: Public doctor issues could retain mutable nested records

Doctor freezes its report, issue array, and every copied issue record on both
RootSet and ExpiringSet failures.
[cite: `src/domain/services/ExpiringSet.js#210-230@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `src/domain/services/ExpiringSet.js#504-506@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `test/unit/domain/services/ExpiringSet.test.js#257-279@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]

### CL-004: A logical bundle member path was not a physical Git witness path

Witnesses now name `root-00000000`, the actual RootSet tree slot. The real-Git
proof separately verifies that the selected marker page is reachable through
that structured bundle edge.
[cite: `src/domain/services/ExpiringSet.js#294-324@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `test/integration/expiring-set.test.js#70-80@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]

### CL-005: Canonical but inconsistent state could be silently healed

Before admission or sweep stages a write, ExpiringSet replays the marker stream
at the persisted evaluation timestamp and compares the complete derived state.
Missing support fails closed without moving the ref or writing objects; doctor
reports the same inconsistency.
[cite: `src/domain/services/ExpiringSet.js#83-110@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `src/domain/services/ExpiringSet.js#124-150@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `src/domain/services/ExpiringSet.js#336-355@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `test/unit/domain/services/ExpiringSet.test.js#326-358@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]

### CL-006: Duplicate rejection could manufacture avoidable CAS residue

The current marker and collision verifier are checked before staging the
replacement page. A live duplicate returns immediately, and the regression
asserts unchanged blob and tree counts.
[cite: `src/domain/services/ExpiringSet.js#69-90@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `test/unit/domain/services/ExpiringSet.test.js#141-154@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]

### CL-007: General cache policy could weaken replay protection

ExpiringSet refuses unknown open policy, publishes no live removal or repair
method, and its sole sweep predicate removes only expired records. Tests prove
live markers remain present under arbitrary collection pressure.
[cite: `src/domain/services/ExpiringSetRegistry.js#85-97@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `src/domain/services/ExpiringSet.js#113-160@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]
[cite: `test/unit/domain/services/ExpiringSet.test.js#170-214@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]

### CL-008: Sweep could reuse stale time across a conflict retry

Sweep now captures the injected clock inside every RootSet callback. If time
rolls backward after a failed compare-and-swap, the retry extends protection
and leaves a marker that is live under the newly observed clock anchored.
[cite: `src/domain/services/ExpiringSet.js#113-161@b00d7abfa830a432e156d5aa037657a5dad98e82`]
[cite: `test/unit/domain/services/ExpiringSet.test.js#230-258@b00d7abfa830a432e156d5aa037657a5dad98e82`]

### CL-009: Doctor could splice two concurrent generations

The RootSet target report and the ExpiringSet index read must name the same
head. A concurrent ref movement now returns an explicit conflict report instead
of presenting generation A's reachability evidence beside generation B's
state.
[cite: `src/domain/services/ExpiringSet.js#235-248@b00d7abfa830a432e156d5aa037657a5dad98e82`]
[cite: `test/unit/domain/services/ExpiringSet.test.js#328-354@b00d7abfa830a432e156d5aa037657a5dad98e82`]

## Pull Request Review Follow-up

CodeRabbit raised six inline threads. Three valid findings were resolved:

- marker, inspection, and sweep evidence now share one retention-witness
  constructor so their root metadata cannot drift;
- nullish `ExpiringMarker` evidence maps to the marker-domain error contract
  rather than a raw constructor failure; and
- ExpiringSetKey now has direct lone-surrogate rejection coverage.

[cite: `src/domain/services/ExpiringSet.js#281-314@82f540a95a0dbb3b4f0791b63fe077d37a7122dc`]
[cite: `src/domain/value-objects/ExpiringMarker.js#30-41@82f540a95a0dbb3b4f0791b63fe077d37a7122dc`]
[cite: `test/unit/domain/value-objects/ApplicationStorageResults.test.js#185-195@82f540a95a0dbb3b4f0791b63fe077d37a7122dc`]
[cite: `test/unit/domain/value-objects/CacheCollectionValues.test.js#37-46@82f540a95a0dbb3b4f0791b63fe077d37a7122dc`]

Three suggestions did not require code changes:

- the explicit well-formed Unicode loop preserves the package's Node, Bun, and
  Deno runtime boundary instead of introducing a newer host-string dependency;
- `updatedAt >= createdAt` is not a valid persisted invariant because the
  injected wall clock is explicitly non-monotonic and rollback extends
  protection; and
- equal digest-domain rejection already had a direct codec regression.

[cite: `src/domain/helpers/isCanonicalCollectionKey.js#5-35@82f540a95a0dbb3b4f0791b63fe077d37a7122dc`]
[cite: `docs/API.md#1675-1682@bf66f6e5247284975631ffdfaabdc15fdb0e25d4`]
[cite: `test/unit/domain/services/ExpiringSetMetadataCodec.test.js#35-64@cdaf18c7814f2f3ad736d210c6832d7ec8d6d1c7`]

## Residual Constraints

- Expiry and sweep release RootSet reachability; they do not run GC. Other refs,
  reflogs, duplicate graphs, or Git's expiry policy may keep released objects.
- Failed compare-and-swap attempts may leave immutable, unreachable pages,
  bundles, trees, and commits. They cannot displace the winning generation.
- Marker scans and rewrites are O(cardinality) time with bounded residency.
  Targeted `contains()` remains proportional to one bundle lookup path.
- The injected wall clock is a trust boundary. Rollback extends retention;
  a forward jump can shorten an acceptance window.
- Deterministic key digests hide plaintext storage but do not prevent offline
  guessing of low-entropy keys. Security callers should use high-entropy
  protocol nonces or suitably secret preimages.
- Expired records remain anchored until explicit sweep or replacement of that
  same key. This favors replay safety over eager object reclamation.
- Malformed state has no automatic repair path. Rebuilding replay state requires
  an authoritative external ledger and a separately reviewed operator flow.

The public documentation makes these boundaries and the physical storage shape
explicit.
[cite: `docs/API.md#1562-1683@bf66f6e5247284975631ffdfaabdc15fdb0e25d4`]

## Validation

- `pnpm lint`
- `pnpm test`
- `GIT_STUNTS_DOCKER=1 pnpm test:integration`
- `pnpm exec tsc --noEmit --skipLibCheck --module NodeNext --moduleResolution NodeNext --target ES2022 index.d.ts`
- `git diff --check`
- Graft structural review: no breaking changes; additive minor semver impact
