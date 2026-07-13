---
title: 'API-0047 - Application Storage And Cache Ownership'
cycle: '0047'
task_id: 'application-storage-cache-boundary'
legend: 'API'
release_home: 'v6.2.0'
issue: 'https://github.com/git-stunts/git-cas/issues/58'
goalpost_issue: 'https://github.com/git-stunts/git-cas/issues/50'
tracker_source: 'github'
status: 'active'
base_commit: '295f21fd5b4d73d353ee36647804b96686329157'
owners:
  - '@git-stunts'
sponsors:
  human: 'James'
  agent: 'Codex'
blocking_issues: []
supersedes: []
superseded_by: null
created: '2026-07-13'
updated: '2026-07-13'
---

<!-- markdownlint-disable MD013 MD025 MD034 -->

# API-0047 - Application Storage And Cache Ownership

## Linked Issue

- https://github.com/git-stunts/git-cas/issues/58

## Linked Tracker

- Milestone: `v6.2.0`
- Goalpost issue: https://github.com/git-stunts/git-cas/issues/50
- Design slice: https://github.com/git-stunts/git-cas/issues/58
- Asset and witness slice: https://github.com/git-stunts/git-cas/issues/54
- Bundle and page slice: https://github.com/git-stunts/git-cas/issues/51
- Cache lifecycle slice: https://github.com/git-stunts/git-cas/issues/59
- Expiry-safe set slice: https://github.com/git-stunts/git-cas/issues/53
- Diagnostics slices: https://github.com/git-stunts/git-cas/issues/55 and https://github.com/git-stunts/git-cas/issues/49
- Release slice: https://github.com/git-stunts/git-cas/issues/60

## Design Type

This design is primarily:

- [x] Runtime/API
- [x] Storage/substrate
- [x] Migration/release
- [x] CLI/operator
- [x] Docs/public guidance
- [ ] TUI/visual surface
- [x] Test/tooling

## Decision Summary

`git-cas` will add high-level application storage capabilities above its
existing plumbing, vault, and root-set surfaces. Applications will exchange
validated opaque handles and state retention intent; `git-cas` will own object
creation, structured bundles and pages, Git reachability, cache metadata,
expiry, capacity policy, repair, and storage evidence. Existing low-level APIs
remain available and compatible, but applications no longer need to assemble
Git trees, maintain cache-index refs, or reason from naked payload OIDs.

## Sponsored Human

A maintainer operating large WARP repositories wants one storage layer to own
CAS object lifetime and cache policy so live derived state survives Git GC,
expired state becomes collectible, and application packages do not each invent
their own subtly unsafe object graph.

## Sponsored Agent

An agent needs immutable handles, explicit policy, and machine-readable
retention evidence so it can store, publish, inspect, and repair application
state without reverse-engineering Git trees, refs, JSON pointer blobs, or
application-specific cache protocols.

## Hill

By the end of the `v6.2.0` goalpost, an application can stream immutable assets
and structured materialization pages into `git-cas`, publish or cache them under
an explicit policy, receive generation-scoped retention evidence, read only the
members it needs, and inspect or repair their lifecycle without directly
writing Git objects or cache refs.

## Current Truth

- `ContentAddressableStore.store()` returns a manifest, while
  `ContentAddressableStore.createTree()` separately turns a manifest into a Git
  tree and returns its naked OID. The caller owns that sequencing and any
  subsequent reachability action.
  [cite: `index.js#395-459@295f21f`]
- The TypeScript public surface exposes `store()`, `restore()`, and
  `createTree()` independently, including the raw string return from
  `createTree()`.
  [cite: `index.d.ts#583-617@295f21f`]
- `ContentAddressableStore.rootSets.open()` exposes current-generation mutable
  roots under `refs/cas/rootsets/*`.
  [cite: `index.js#138-139@295f21f`]
- `RootSet` provides compare-and-swap `put`, `remove`, `replace`, and `mutate`
  operations plus doctor and repair, but it deliberately does not own cache
  keys, TTL, byte/entry capacity, access recency, or eviction order.
  [cite: `src/domain/services/RootSet.js#45-215@295f21f`]
- Root-set entries distinguish application policy (`pinned` or `evictable`)
  from observed Git reachability, but callers still coordinate object storage,
  root mutation, indexes, and cleanup themselves.
  [cite: `index.d.ts#292-367@295f21f`]
- The vault is the durable history-preserving registry. Root sets intentionally
  retain only their current generation so removed entries can become
  collectible. Neither surface is a cache policy API.
  [cite: `docs/releases/v6.1.0.md#5-64@295f21f`]
- Downstream inspection found `git-warp` implementing its own CAS adapters,
  pointer formats, cache indexes, RootSet coordination, LRU policies, and
  doctor logic. The downstream migration is tracked in
  https://github.com/git-stunts/git-warp/issues/734.

## Problem

The current API is powerful but invites every application to become a storage
system:

1. `store()` and `createTree()` expose an unrooted interval and a naked OID.
2. A caller must decide how a handle is serialized and later validated.
3. A caller that needs cache behavior must invent an index, ref namespace,
   replacement ordering, expiry, recency, capacity, doctor, and repair path.
4. A caller can confuse policy words such as `pinned` with observed Git
   reachability.
5. Structured state commonly becomes one monolithic asset or a hand-built Git
   tree, preventing bounded member reads.
6. Security-sensitive replay markers are often put in ordinary in-memory LRUs,
   where capacity eviction can weaken the security window.

This is an API design gap rather than a failure of RootSet. RootSet is the
correct low-level current-generation reachability primitive. The missing layer
is an application storage facade that composes it safely.

## Scope

This goalpost includes:

- validated, immutable, serializable handles for assets, bundles, and pages
- streaming asset put/open operations
- generic application-owned commit/ref publication through `git-cas`
- generation-scoped retention witnesses
- deterministic structured bundles with targeted member reads
- a generic immutable Merkle page store
- RootSet-backed cache collections with TTL and bounded capacity policy
- an expiry-safe add-if-absent set for replay markers
- cache and repository doctor/repair evidence
- compatibility aliases and migration guidance for existing public methods
- tests proving reachability and collectibility without destructive GC

## Non-Goals

This goalpost does not include:

- replacing the vault or changing its historical durability semantics
- removing existing low-level methods in the `v6.x` line
- interpreting application payload schemas
- defining WARP coordinates, materialization roots, patch formats, or causal
  commit messages inside `git-cas`
- promising repository-wide byte attribution where Git cannot prove it
- running `git gc`, `git prune`, or automatic destructive cleanup
- providing distributed cache coherence across unrelated repositories
- treating a retention witness as a permanent guarantee after its observed
  root generation changes
- adding a browser Git implementation

## Runtime / API Contract

The additive facade shape is:

```javascript
const cas = new ContentAddressableStore(options);

const avatar = await cas.assets.put({
  source: avatarByteStream,
  slug: 'alice-avatar',
  mime: 'image/png',
});

const materialization = await cas.bundles.put({
  members: {
    'nodes/root': nodePageHandle,
    'edges/root': edgePageHandle,
    'properties/root': propertyPageHandle,
    'frontier.cbor': frontierBytes,
  },
});

const publication = await cas.publications.commit({
  root: materialization.handle,
  commit: {
    message: applicationCommitMessage,
    parents: applicationParentCommitIds,
  },
  ref: {
    name: applicationRef,
    expected: expectedApplicationHead,
  },
});

const cache = await cas.caches.open({
  namespace: 'git-warp/materializations',
  policy: {
    maxEntries: 128,
    maxBytes: 20 * 1024 * 1024 * 1024,
    accessResolutionMs: 60 * 60 * 1000,
  },
});

await cache.put(coordinateKey, materialization.handle, {
  retention: 'evictable',
  expiresAt: new Date('2026-07-27T00:00:00Z'),
});

const hit = await cache.get(coordinateKey);
if (hit !== null) {
  for await (const chunk of cas.bundles.openMember({
    handle: hit.handle,
    path: 'properties/root',
  })) {
    consume(chunk);
  }
}
```

The exact JavaScript names may tighten during implementation, but the ownership
and state transitions in this design are normative.

### Capability Boundaries

| Capability     | Owns                                                              | Does not own                                              |
| -------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `assets`       | byte stream to manifest/tree, validated handle, streaming open    | application meaning or durability policy                  |
| `bundles`      | named handles/streams, deterministic layout, targeted reads       | application member schema                                 |
| `pages`        | immutable page put/get, content identity, bounded byte reads      | trie/index algorithms or decoded application objects      |
| `publications` | generic commit/tree/ref write and compare-and-swap publication    | commit message semantics or causal rules                  |
| `rootSets`     | current-generation reachability primitive                         | cache policy or application schema                        |
| `caches`       | key index, rooting, TTL, capacity, recency, sweep, doctor, repair | domain key derivation or payload interpretation           |
| `expiringSets` | durable add-if-absent markers protected until expiry              | request-authentication policy or acceptance-window choice |
| `vault`        | durable history-preserving asset registry                         | cache eviction or current-generation replacement          |
| `plumbing`     | deliberate low-level object operations                            | safety composition or policy                              |

### Handle Contract

`AssetHandle`, `BundleHandle`, and `PageHandle` are immutable branded value
objects with these properties:

- they carry a versioned canonical serialization suitable for an application
  commit, database field, queue, or receipt
- parsing validates version, kind, hash algorithm, object identifier shape, and
  required format metadata
- application code can compare and serialize handles but does not need to read
  or construct their underlying OIDs
- `git-cas` can inspect a handle into low-level evidence for doctor and agent
  output
- handles are content locators, not durability claims
- handles are portable to another repository only when the referenced object
  graph has also been transferred; a missing graph fails explicitly

The canonical serialized form must not depend on a filesystem path or repository
location. Clone and mirror workflows remain possible.

### Publication Contract

`publications.commit()` is generic Git-backed publication, not an application
history model. The caller supplies validated commit message bytes, ordered
parents, target ref, and expected head. `git-cas`:

1. validates the root bundle handle and referenced object graph
2. constructs the commit through the persistence port
3. updates the ref with compare-and-swap semantics
4. returns the application commit ID and a publication witness

The commit ID remains public because it is an application causal identity. Raw
payload object IDs remain behind handles.

Publication ref validation accepts explicitly configured application
namespaces; it does not force causal application refs under `refs/cas/*` or
permit arbitrary ref writes by default.

### Retention Witness Contract

A retention witness is immutable observed evidence:

```javascript
{
  version: 1,
  handle,
  policy: 'pinned',
  reachability: 'anchored',
  root: {
    kind: 'cache-set',
    namespace: 'git-warp/materializations',
    ref: 'refs/cas/caches/git-warp/materializations',
    generation: '<commit-id>',
    path: '<validated-entry-path>',
  },
  observedAt: '2026-07-13T00:00:00.000Z',
}
```

The witness proves what the named generation contained when observed. It does
not promise that a mutable ref still points to that generation later. A caller
that needs current truth asks doctor or reads the collection again.

### Retention Vocabulary

Policy and reachability are independent axes:

| Term        | Axis                  | Meaning                                                         |
| ----------- | --------------------- | --------------------------------------------------------------- |
| `pinned`    | cache policy          | ordinary capacity or recency eviction must not remove the entry |
| `evictable` | cache policy          | capacity, recency, or explicit sweep may release the entry      |
| `anchored`  | observed reachability | a Git ref/reflog edge currently reaches the object graph        |
| `orphaned`  | observed reachability | unreachable, but still inside the configured grace period       |
| `volatile`  | observed reachability | unreachable and eligible for prune under the inspected policy   |

Expiry is a third independent dimension. A pinned marker may be protected until
its expiry and released afterward. For an ordinary cache entry, an explicit
expiry authorizes release after that time even when capacity policy is
`pinned`; without an expiry, only an explicit unpin/remove may release it.
`Pinned` does not mean a pack `.keep` file.

### CacheSet Contract

`caches.open()` owns a namespace under `refs/cas/caches/*`. A cache generation
is self-describing and creates actual Git tree edges to every retained handle;
OID strings inside metadata never stand in for reachability.

Required operations:

- `get(key)` returns a validated hit or `null`; expired entries are misses
- `put(key, handle, options)` stores or replaces one entry and returns a witness
- `remove(key)` releases one entry and returns mutation evidence
- `touch(key)` explicitly advances recency when the configured resolution allows
- `sweep(options)` applies expiry and capacity policy deterministically
- `inspect()` reports count, logical bytes, age, expiry, and policy
- `doctor()` validates metadata, tree edges, target existence/type, and policy
- `repair(authoritativeEntries)` rebuilds only from caller-authoritative state

`get()` must not durably rewrite metadata on every hit. Recency is approximate:
touches are explicit or coalesced into `accessResolutionMs` epochs. Capacity
policy must state whether pinned entries count toward limits and must report an
over-capacity state when pinned entries alone exceed a limit.

`maxBytes` is defined over deterministic logical payload bytes recorded by
validated manifests. Physical Git bytes are diagnostic evidence, not a cache
capacity oracle, because deduplication and shared reachability prevent exact
single-owner attribution. An expired `get()` is a non-mutating miss; the entry
remains anchored until an explicit or mutation-triggered sweep releases it.

Cache replacement follows safe publication order. The new object graph is
fully written and validated before a compare-and-swap generation update makes
it current. Concurrent conflicts are retried from observed current state.
Cleanup may retain harmless extra roots after an ambiguous race; it must not
remove another writer's winner.

### ExpiringSet Contract

`expiringSets.open()` provides durable replay-marker semantics:

- `addIfAbsent(key, { expiresAt })` atomically admits one live key
- `contains(key)` treats an unexpired key as present
- `sweep()` releases only expired entries
- capacity pressure cannot remove unexpired entries
- persisted entry names are deterministic digests, not plaintext keys
- an injected clock supports deterministic tests

Wall-clock correctness remains part of the host trust boundary. Clock rollback
extends protection. A host clock that jumps forward can shorten it, so security
callers must also validate request timestamps against the same trusted clock.

## User Experience / Product Shape

There is no rendered workflow in this design. The user-visible shape is a
boring public API and doctor output that answers:

- what was stored
- where it is retained
- which policy applies
- when it expires
- how large it is
- whether its target graph exists and is reachable
- what repair can and cannot do

CLI/TUI work may expose these facts later, but machine-readable library results
are the first required surface.

## Data / State Model

| State       | Source of truth                         | Derived state                  | Invalid states                                                | Reset behavior                         | Serialization                               | Determinism assumptions                   |
| ----------- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------- | -------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| Handle      | referenced Git object graph             | inspectable object kind/format | malformed token, unknown version, missing target              | reacquire or transfer graph            | versioned canonical token                   | same graph and format produce same handle |
| Bundle      | deterministic root tree plus descriptor | member lookup/fanout           | duplicate path, traversal path, kind mismatch, missing member | rebuild from authoritative members     | Git tree and canonical descriptor           | stable member order and fanout            |
| Publication | application ref                         | current application commit     | ref conflict, missing root, invalid parent                    | retry from observed head               | Git commit/ref                              | caller controls message and parent order  |
| CacheSet    | current cache ref generation            | expiry/capacity/age report     | malformed metadata, missing edge/target, duplicate key        | repair from authoritative entries      | parentless commit, tree, canonical metadata | stable key ordering and policy evaluation |
| ExpiringSet | current expiring-set ref generation     | live/expired classification    | malformed time, digest collision, missing marker              | repair or recreate from trusted ledger | parentless commit and canonical metadata    | injected clock and stable digest          |
| Witness     | observed immutable generation           | explanatory text               | unknown version or mismatched root evidence                   | obtain a fresh witness                 | canonical object/JSON form                  | fixed generation fixes evidence           |

## Architecture / Anti-SLUDGE Posture

| Concern                | Decision                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain changes         | Add focused handle, asset, bundle, page, publication, cache, expiry, and witness services. Do not grow one facade service into all behavior. |
| Port changes           | Add only object/ref capabilities required by domain services; preserve `Uint8Array` and `AsyncIterable<Uint8Array>` boundaries.              |
| Adapter changes        | Git object, commit, tree, and ref operations remain in infrastructure persistence adapters.                                                  |
| Facade changes         | `ContentAddressableStore` exposes lazily initialized capability groups and delegates to cohesive services.                                   |
| Codecs                 | Every persisted descriptor has a schema version and deterministic codec.                                                                     |
| Application separation | No WARP nouns, keys, codecs, or policy defaults enter `git-cas`.                                                                             |
| Cache ownership        | Cache refs, indexes, recency, expiry, sweep, doctor, and repair exist only in `git-cas`.                                                     |
| Banned shortcut        | Never treat an OID written inside JSON/CBOR as a Git reachability edge.                                                                      |

## Cost / Residency Posture

| Surface              | Target residency                                     | Cost model                                 | Budget/failure mode                                                 |
| -------------------- | ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| Asset put/open       | bounded chunk/frame windows                          | O(payload bytes)                           | configured chunk and crypto limits                                  |
| Bundle creation      | bounded member batches plus fanout level             | O(member count) writes                     | reject duplicate/invalid paths; page member descriptors when needed |
| Targeted member read | path depth plus opened member stream                 | O(path depth + member bytes)               | no unrelated member hydration                                       |
| Page put/get         | one encoded page plus stream buffers                 | O(page bytes)                              | caller/configured max page size                                     |
| Cache get            | targeted metadata/path lookup                        | O(path depth) target                       | explicit fallback limits if adapter cannot target-read              |
| Cache sweep          | streamed current entries plus bounded candidate heap | O(entry count log budget)                  | report unsatisfied limit when pinned entries dominate               |
| Repository doctor    | streamed object/ref inventory                        | O(repository objects) time, bounded memory | explicit unknown/bounded attribution rather than full buffering     |

No API may claim streaming merely because its final return type is an async
iterable after a complete payload or collection was buffered.

## Determinism / Replay / Causality

- Handle serialization, bundle descriptors, member ordering, fanout, cache
  metadata, and policy evaluation must be deterministic.
- Cache mutations and publication refs use compare-and-swap; conflicts are
  observable and retry from current truth.
- Parentless cache/root-set generations intentionally release old history.
- Application publication parent order remains caller-controlled because it may
  encode causal meaning.
- Clock-dependent expiry tests use an injected clock and record exact times.
- Doctor results sort stable identifiers so witnesses are diffable.

## Git Substrate Impact

| Substrate area | Impact                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| blobs          | Store payload chunks, manifests, descriptors, page bytes, and collection metadata.                      |
| trees          | Anchor asset graphs and provide targeted bundle/cache member lookup.                                    |
| commits        | Parentless current-generation collection commits; caller-specified application publication commits.     |
| refs           | Add validated `refs/cas/caches/*` and `refs/cas/expiring/*`; retain existing vault/root-set namespaces. |
| object IDs     | Encapsulated by handles for payloads; application commit IDs remain public causal identities.           |
| reachability   | Tree entries create anchors; metadata references are descriptive only.                                  |
| pruning        | Released objects may become orphaned/volatile when no other ref or reflog reaches them.                 |

## Compatibility / Migration Posture

| Concern                  | Decision                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Semver                   | Additive `v6.2.0` public capabilities.                                                                  |
| Existing facade methods  | Preserve `store`, `restore`, `createTree`, vault, and RootSet behavior through `v6.x`.                  |
| Low-level naming         | Add a `plumbing` capability/alias where useful; do not move or remove existing methods in this release. |
| Existing manifests/trees | Remain readable and may be adopted into handles after validation.                                       |
| Existing root sets       | Remain valid; CacheSet uses its own namespace and schema.                                               |
| Vault                    | Unchanged. It remains the durable history-preserving policy.                                            |
| Downstream migration     | Applications migrate one subsystem at a time, then prohibit their former raw object/cache code.         |
| Future major             | Root-level low-level methods may move behind `plumbing` only in a separately designed major release.    |

## Error Contract

| Failure                        | Error/result                                    | Caller recovery                             | Required proof             |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------- | -------------------------- |
| Malformed handle               | stable handle validation code                   | reject input or reacquire handle            | parser table tests         |
| Missing handle target          | object-not-found with handle kind               | transfer/restore source graph               | real-repo test             |
| Wrong target kind              | handle-kind mismatch                            | use correct handle/parser                   | unit and integration tests |
| Publication conflict           | expected/observed ref evidence                  | retry application transition                | concurrent writer test     |
| Invalid bundle path            | path validation error                           | normalize domain member path                | path corpus                |
| Cache conflict exhausted       | cache conflict with attempts/head               | retry or surface obstruction                | deterministic retry test   |
| Expired cache hit              | `null` plus optional inspection fact            | recompute/store                             | injected-clock test        |
| Pinned entries exceed limit    | successful state plus unsatisfied-policy report | raise limit or unpin explicitly             | policy test                |
| Unexpired replay duplicate     | admitted false with existing expiry evidence    | reject replay                               | concurrency test           |
| Missing object during repair   | unrecoverable missing-target finding            | restore bytes or remove authoritative entry | repair test                |
| Unknown repository attribution | explicit unknown/bounded fact                   | inspect refs manually                       | synthetic repository test  |

## Security / Trust / Redaction Posture

- Handles and witnesses contain object identities and collection names, not
  payload bytes or encryption keys.
- Collection namespaces and application metadata are visible in ordinary Git
  storage unless the caller encrypts payload metadata at a higher layer.
- ExpiringSet persists deterministic key digests rather than plaintext replay
  keys.
- Cache and expiry mutation authority is the authority to update the validated
  collection ref.
- Repair never fabricates missing bytes and never broadens retention silently.
- Capacity eviction never overrides pinned policy or unexpired replay safety.
- Doctor output may report OIDs, refs, counts, sizes, and timestamps; it must
  redact configured secret metadata and never print payload contents.

## Lower Modes

Every human-readable result has a stable object/JSON equivalent. Required lower
modes include:

- serialized handle and witness objects
- cache inspection and doctor JSON
- deterministic test/witness transcripts
- stable error codes and structured context

No essential meaning depends on color, table alignment, or an interactive TUI.

## Accessibility Posture

This is a runtime and operator-evidence design. Documentation uses linear
headings, explicit state names, and tables that repeat the meaning in text.
Future CLI/TUI output must preserve the same facts in plain text and JSON.

## User-Facing Text / Directionality

Visible strings are API names, errors, docs, and doctor output. English text is
left-to-right, but persisted keys and machine-readable fields do not encode
directional assumptions. Paths use Git's forward-slash representation and are
validated as storage identifiers, not localized prose.

## Agent Inspectability / Explainability Posture

Agents can:

- parse and validate handles without inspecting private fields
- request low-level handle evidence from `git-cas`
- distinguish policy from observed reachability
- inspect exact collection generation, ref, path, age, expiry, and size
- explain why a cache entry was retained, missed, expired, evicted, or blocked
- run doctor and repair through structured APIs
- cite immutable witness generations in downstream receipts

Agents must not infer durability merely from possession of a handle.

## Linked Invariants

- [I-001 - Determinism, Trust, And Explicit Surfaces](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md)
- [I-002 - Application Storage Ownership](../../invariants/I-002-application-storage-ownership.md)

## Design Alternatives Considered

### Put every application asset in the vault

Rejected. Vault history intentionally keeps old generations reachable and is
the wrong default for evictable materializations or TTL state.

### Have applications compose RootSet directly

Rejected as the default. RootSet is correct plumbing, but leaving cache schema,
expiry, capacity, recency, concurrency ordering, and repair to every caller is
the bug this design addresses.

### Expose raw OIDs but document them better

Rejected. Documentation cannot mechanically prevent kind confusion, malformed
serialization, pointer blobs mistaken for roots, or application tree assembly.

### One monolithic cached state asset

Rejected. CDC deduplicates bytes but does not provide targeted semantic member
reads. Large application materializations need independently addressable pages
and named roots.

### Exact LRU with durable write on every read

Rejected. It amplifies writes, creates ref contention, and retains metadata
history pressure for little policy value. Coarse access epochs are sufficient.

### In-memory replay LRU

Rejected. Restart loses protection and capacity eviction can re-admit a replay
before the acceptance window closes.

### Make `pinned` synonymous with Git `.keep`

Rejected. Application cache policy and pack maintenance are different axes.

## Decision

Build additive high-level capabilities in `git-cas`; keep RootSet and existing
store/restore/tree APIs as advanced and compatibility surfaces; make handles,
retention evidence, structured pages, CacheSet, and ExpiringSet the ordinary
application path.

## Proof Surface

The goalpost is proven by executable package behavior, not documentation alone:

- handle parser and canonical round-trip tests
- streaming asset put/open tests with bounded buffers
- application publication and ref-conflict tests
- bundle targeted-read and deterministic-fanout tests
- page deduplication and max-size tests
- CacheSet replacement, concurrency, TTL, capacity, pinning, doctor, and repair
  tests
- ExpiringSet restart, concurrency, expiry, and capacity-pressure tests
- real Git repository `git prune -n --expire=now` reachability witnesses
- repository-wide doctor fixtures from #49
- TypeScript declaration and package export tests
- downstream git-warp integration and constrained-memory witnesses

## Implementation Slices

1. #54 adds handles, streaming asset APIs, generic publication, and witnesses.
2. #51 adds bundles, targeted member reads, deterministic fanout, and pages.
3. #59 adds CacheSet lifecycle, policy, doctor, and repair.
4. #53 adds expiry-safe replay-marker storage.
5. #55 and #49 add cache/repository usage and reachability evidence.
6. #60 updates public docs, verifies the package, and publishes `v6.2.0`.

Each slice lands through a separate non-draft pull request. A later slice starts
from merged `main`; no stacked implementation branch bypasses a previous
slice's CI and review evidence.

## Tests To Write First

For each implementation slice, first tests must establish:

1. the public call shape and immutable result types
2. malformed and missing-input errors
3. deterministic serialization
4. concurrency conflict behavior
5. actual Git reachability transitions
6. bounded streaming/residency behavior
7. JavaScript and TypeScript export compatibility

The cache and expiry slices start with failing tests for the unsafe race:
replacement or capacity pressure must never release the winning live target or
an unexpired replay marker.

## Acceptance Criteria

- The design resolves every decision requested by #58.
- The public capability boundary is application-neutral.
- Policy, expiry, and reachability are separate concepts.
- Handle serialization is versioned, deterministic, and repository-location
  independent.
- Retention witnesses state their generation-scoped limitation.
- Cache get does not require a durable metadata write on every hit.
- ExpiringSet cannot evict unexpired entries for capacity.
- Structured members/pages are targeted and streamable.
- Existing public APIs remain compatible in `v6.2.0`.
- Every runtime claim has a named executable proof surface.

## Validation Plan

For this design slice:

- `pnpm run lint`
- `pnpm test`
- documentation link and planning-index review
- self-review against issue #58 and the design template
- Code Lawyer review for ambiguous guarantees, hidden policy coupling,
  unproven streaming claims, unsafe concurrency, and semver overreach

Implementation PRs add their slice-specific integration and runtime matrix
tests. Release slice #60 runs the full release method.

## Playback / Witness

The design playback asks:

1. Can a human identify who owns each storage and cache concern?
2. Can an agent distinguish a handle from a durability claim?
3. Can a caller publish causal history without assembling payload trees?
4. Can cache data be live now and collectible later without a custom protocol?
5. Can large structured state be read by member/page rather than as one object?
6. Can doctor explain size, age, policy, expiry, and reachability without
   destructive GC?

The design PR records review and validation. Each implementation slice creates
its own committed witness under its cycle directory.

Design review evidence is recorded in
[witness/design-review.md](./witness/design-review.md).

## Risks

- The facade could become a new monolith. Mitigation: capability groups delegate
  to focused services and ports.
- Opaque handles could become inconvenient escape-hatch blockers. Mitigation:
  canonical serialization plus explicit inspection/plumbing APIs.
- Cache metadata may become too large. Mitigation: deterministic fanout and
  targeted paths; prove bounded traversal before claiming scale.
- Approximate recency may surprise callers. Mitigation: explicit
  `accessResolutionMs`, explicit `touch`, and inspectable epochs.
- Generic application publication may accidentally absorb domain semantics.
  Mitigation: caller controls message, parents, and ref rules; `git-cas` only
  validates and executes storage transitions.
- Clock errors can weaken expiry. Mitigation: document clock trust, inject the
  clock in tests, and require security callers to validate request time too.
- Backward-compatible aliases can leave two stories. Mitigation: docs headline
  high-level capabilities and label old methods as deliberate plumbing.

## Follow-On Debt

- A future major release may move root-level low-level methods under
  `cas.plumbing` after an explicit migration cycle.
- Browser/edge persistence remains #41.
- Cross-repository transfer helpers may later package all objects reachable from
  a handle.
- Very large repository attribution may need commit-graph/bitmap acceleration
  after #49 establishes the correct evidence model.

## Tracker Disposition

- #58 closes when this design is merged with clean review and validation.
- #50 remains open until all implementation and release slices close.
- Implementation findings become comments or new GitHub issues; they do not
  silently expand this document's active queue.

## Done Does Not Mean

- documentation alone proves the runtime
- a handle is durable without a witness or current reachability observation
- every repository byte can be attributed to one cache
- old low-level methods are removed
- git-cas interprets WARP domain state
- running doctor performs garbage collection

## Retrospective

Pending implementation and release playback.
