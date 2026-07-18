---
title: "PERF-0049 - Scoped Staging Workspaces"
cycle: "0049"
task_id: "scoped-staging-workspaces"
legend: "PERF"
release_home: "v6.4.0"
issue: "https://github.com/git-stunts/git-cas/issues/75"
goalpost_issue: "https://github.com/git-stunts/git-cas/issues/75"
tracker_source: "github"
status: "active"
base_commit: "beb8a299c7f36903a250040cb6ef7c5c81063a32"
owners:
  - "@git-stunts"
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: []
supersedes: []
superseded_by: null
created: "2026-07-17"
updated: "2026-07-17"
---

# PERF-0049 - Scoped Staging Workspaces

## Linked Issue

- https://github.com/git-stunts/git-cas/issues/75

## Linked Tracker

- Milestone: `v6.4.0`
- Goalpost issue: https://github.com/git-stunts/git-cas/issues/75
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

`ContentAddressableStore.workspaces` will own renewable, explicitly releasable
staging leases for multi-object construction. Each workspace uses one dedicated
RootSet generation to anchor staged handles directly. Workspace-scoped asset,
page, and bundle capabilities retain each successful staged result before
returning it. Checkpoint compaction replaces the active roots, promotion first
establishes destination retention and then releases the workspace, and
repository diagnostics expose active and expired workspace debt.

## Sponsored Human

An application author wants a large aggregate to remain safe throughout its
construction so that ordinary supported Git maintenance cannot collect early
objects, without implementing refs, RootSets, or a shadow cache in the
application.

## Sponsored Agent

An agent needs a bounded workspace handle with explicit retention evidence,
expiry posture, promotion, renewal, and release receipts so it can build and
clean up multi-object graphs without inferring durability from object age or
Git defaults.

## Hill

By the end of this cycle, an application can stage pages, assets, and bundles
through one git-cas workspace, prove every returned object is anchored through
construction and promotion, release the temporary root idempotently, and
inspect or sweep abandoned workspaces without application-managed Git state.

## Current Truth

- `assets.put()`, `pages.put()`, and `bundles.putOrdered()` intentionally return
  staged handles without retention claims.
- `RootSet` writes current-generation parentless commits whose tree edges make
  referenced Git objects reachable.
- `CacheSet` is a general indexed cache with policy accounting, metadata pages,
  target bundles, and mutation scans. It is correct for reusable caches but
  expensive as a one-entry build lease.
- `CacheSet.acquire()` now anchors one observed generation for in-flight reads;
  it does not provide an incremental multi-object staging scope.
- `git-warp` currently builds a temporary bundle, inserts it into a pinned
  CacheSet entry, promotes a second bundle into the final cache, and removes the
  temporary entry.
- A real-Git profile of the downstream fixture measured approximately 1.47
  seconds for the workspace bundle, 2.52 seconds for workspace cache insertion,
  and 2.79 seconds for workspace cache removal. The temporary lifecycle alone
  added approximately 6.8 seconds.
- Removing the temporary root would restore speed by reintroducing the original
  reachability bug. Widening integration timeouts would hide the regression.
- Git cannot eliminate the micro-window between writing one loose object and
  publishing the ref generation that first reaches it. Supported maintenance
  must preserve Git's ordinary unreachable-object grace during that window.

## Problem

Low-level staging honesty and final retention are individually sound, but there
is no git-cas-owned lifetime spanning the build between them. Consumers either
leave early objects unreachable, misuse CacheSet as an expensive temporary
lease, or write their own refs. The first is unsafe, the second creates severe
latency and duplicate lifecycle work, and the third violates git-cas ownership
of CAS reachability.

## Scope

This cycle includes:

- a public `cas.workspaces` capability
- renewable workspace leases with strict namespace and identity validation
- workspace-scoped asset, page, and bundle staging capabilities
- direct RootSet-backed retention of every successfully staged result
- exact checkpoint replacement for root-set compaction
- cache and publication promotion helpers
- explicit, idempotent, generation-checked release
- bounded workspace inspection and expiry sweep
- repository-doctor counts, logical bytes, age, expiry, and posture
- typed errors, declarations, docs, changelog, tests, and release evidence
- downstream performance evidence from git-warp's unchanged integration hook

## Non-Goals

This cycle does not include:

- changing low-level staging methods into durable writes
- application-owned refs, RootSets, or cache entries
- automatic deletion at the instant a TTL expires
- treating wall-clock age as proof that an active process is dead
- surviving unsafe concurrent `git prune --expire=now` inside the irreducible
  object-write-to-ref-update micro-window
- replacing final CacheSet or publication policy
- retaining every abandoned workspace forever
- solving git-warp's remaining full-state materialization work

## Runtime / API Contract

The ordinary application shape is:

```javascript
const workspace = await cas.workspaces.open({
  namespace: 'git-warp/materializations',
  ttlMs: 2 * 60 * 60 * 1000,
});

try {
  const page = await workspace.pages.put({
    source: encodedShard,
    maxBytes: 16 * 1024 * 1024,
  });
  const bundle = await workspace.bundles.putOrdered({
    members: [['props/example.cbor', page.handle]],
  });

  const result = await workspace.promoteToCache({
    cache,
    key: materializationKey,
    handle: bundle.handle,
    options: { retention: 'evictable' },
  });
  return result;
} finally {
  await workspace.release();
}
```

`workspaces.open({ namespace, ttlMs })` creates an in-memory lease identity but
does not write a ref until the first successful stage or checkpoint. `ttlMs`
must be a positive safe integer within the documented maximum.

Workspace staging capabilities mirror the corresponding top-level methods:

```javascript
workspace.assets.put(options);
workspace.assets.adopt(options);
workspace.pages.put(options);
workspace.bundles.put(options);
workspace.bundles.putOrdered(options);
```

Each method performs the ordinary staging operation, advances the workspace
RootSet to include the returned handle, and returns only after retention
evidence exists. If retention fails, the method rejects and includes staging
evidence where the underlying service provides it. It never returns a handle
while claiming that the failed workspace generation retained it.

`checkpoint({ handles })` replaces the active target set with the supplied
unique handles. It is the compaction operation after an aggregate bundle makes
its component roots transitively reachable. An empty checkpoint releases all
targets but keeps the lease identity available for later staging; no empty
RootSet ref is created for a never-used workspace.

`renew()` advances the lease descriptor and generation. Ordinary successful
stage, checkpoint, and promotion preparation also renew activity. Expiry is an
operator posture, not automatic revocation: an expired workspace remains
reachable until an explicit bounded sweep deletes its exact observed
generation.

Promotion helpers establish the destination before releasing the workspace:

```javascript
await workspace.promoteToCache({ cache, key, handle, options });
await workspace.promoteToPublication({ handle, commit, ref });
```

The promoted handle must be present in the active workspace. A destination
must return anchored retention evidence for the exact handle, ref, and
generation before the workspace can be released. Rejection, malformed
evidence, or destination failure leaves the workspace intact. A successful
destination write followed by release failure returns or throws structured
evidence that destination retention succeeded and temporary cleanup remains
due; it never rolls back the destination.

`release()` is idempotent on one workspace object. It generation-checks the
managed workspace ref before deletion. A generation mismatch or unprovable
symbolic-ref posture fails closed and does not delete another writer's root.

Bounded operator surfaces are:

```javascript
await cas.workspaces.inspect({ namespace, limit });
await cas.workspaces.sweep({ namespace, limit });
```

Inspection returns workspace ID, namespace, generation, root count, validated
logical content bytes, unique direct-root object bytes, created time, observed
age, expiry, and `active`, `expired`, or `invalid` posture. Direct-root bytes do
not claim transitive, packed, deduplicated, or filesystem residency. Sweep only
deletes expired direct refs whose generation still matches the inspection.
Results report changed, conflicted, and truncated counts.

## User Experience / Product Shape

Application code sees a resource scope with familiar asset, page, and bundle
capabilities. It does not see refs, object IDs, RootSet entries, or cache-index
implementation details. Operators see bounded structured diagnostics and
explicit cleanup receipts.

## Data / State Model

| State | Source of truth | Derived state | Invalid states | Reset behavior | Serialization | Determinism assumptions |
| --- | --- | --- | --- | --- | --- | --- |
| Uninstalled | workspace value only | ID and created time | malformed options | release is no-op | none | nonce uniqueness |
| Active | workspace RootSet generation | witnesses and age | missing descriptor or target mismatch | checkpoint or release | root metadata plus lease page | handle ordering is canonical |
| Expired | same retained generation | sweep eligibility | malformed/future descriptor | renew or sweep | same format | expiry comparison uses injected clock |
| Promoted | destination retention plus optional workspace ref | promotion receipt | destination mismatch | retry cleanup | destination-native | destination operation linearizes first |
| Released | absence of exact workspace ref | release receipt | ref points elsewhere | fail closed | none | repeated release is no-op |

The managed ref namespace is
`refs/cas/workspaces/<encoded-namespace>/<workspace-id>`. The opaque ID contains
a version, canonical creation epoch, and random nonce. Each generation contains
one bounded lease descriptor page plus RootSet entries whose names encode the
canonical application handles and whose Git tree edges reach their target
objects. The descriptor records version, workspace ID, namespace, creation,
expiry, and target count.

## Architecture / Anti-SLUDGE Posture

| Concern | Decision |
| --- | --- |
| Domain changes | Add workspace ref, descriptor, lease, registry, inspection, and release receipts |
| Port changes | Reuse semantic ref iteration and checked deletion; no Git command leaks |
| Adapter changes | Wire existing persistence/ref adapters through a workspace registry |
| Boundary validation | Validate namespace, TTL, timestamps, nonce, handles, descriptor, direct refs, and generation |
| Runtime-backed nouns introduced | Workspace means one real managed reachability ref, not an in-memory bag |
| Expected failure representation | Typed invalid, expired, conflict, retention, promotion, and release errors |
| Banned shortcuts avoided | No CacheSet shadow lease, raw OID API, timeout widening, or application refs |

The workspace service composes existing `AssetService`, `PageService`,
`BundleService`, `RootSet`, and destination capabilities. It does not duplicate
their codecs or storage logic. RootSet owns reachability; workspace owns lease
identity, expiry semantics, scoped staging, promotion order, and cleanup.

## Cost / Residency Posture

| Surface | Current cost | Target cost | Limit/budget | Failure mode |
| --- | --- | --- | --- | --- |
| first stage | unanchored write | stage plus one RootSet generation | service limits and root cap | typed stage/retain error |
| later stage | CacheSet misuse or unanchored | stage plus bounded root replacement | max workspace roots | typed capacity error |
| checkpoint | bundle plus CacheSet mutation | one lease page plus one RootSet generation | max workspace roots | typed conflict |
| renew | CacheSet rewrite | one lease page plus one RootSet generation | TTL bounds | typed conflict |
| release | CacheSet index rewrite | one checked ref deletion | one ref | mismatch fails closed |
| inspect/sweep | absent | bounded ref page and selected descriptor reads | `limit + 1` | truncated or typed corruption |

The implementation must benchmark checkpoint plus release against the existing
one-entry CacheSet workaround. The git-warp QueryBuilder integration must pass
its unchanged 10-second hook on the same host where the workaround timed out.
No test timeout may be increased to claim success.

## Determinism / Replay / Causality

Workspace IDs are intentionally nondeterministic because they identify live
resource scopes. Within one generation, target ordering and descriptor encoding
are canonical. Witnesses name the exact generation and path, so replay can
distinguish staging identity from final cache or publication identity.

## Git Substrate Impact

| Substrate area | Impact |
| --- | --- |
| refs | New managed workspace namespace with checked create, update, and delete |
| commits | Parentless RootSet generations; no workspace history retention |
| trees/blobs | Existing RootSet tree plus one bounded lease descriptor page |
| object IDs | Remain internal evidence; ordinary callers use handles and workspace IDs |
| pruning | Active and expired unswept refs retain targets |
| tag/release behavior | Additive v6.4.0 package API |
| migration compatibility | No migration; old repositories have no workspace refs |

There remains an irreducible micro-window after an object write and before the
first ref generation reaches it. Supported concurrent maintenance must retain
ordinary Git unreachable-object grace. `git prune --expire=now` concurrent with
staging is explicitly unsupported. Once a workspace method returns, its witness
must name a real direct Git edge.

## Compatibility / Migration Posture

| Concern | Decision |
| --- | --- |
| Public API compatibility | Additive; low-level staging behavior is unchanged |
| Package export changes | Export workspace values and capability declarations |
| Storage/read compatibility | Existing assets, pages, bundles, caches, and refs remain valid |
| Legacy behavior retained | Applications may continue explicit final retention |
| Deprecation behavior | None in this cycle |
| Migration path | None required |
| Release note impact | Document staging honesty, supported grace, and cleanup |

## Error Contract

| Failure | Error/result | Caller recovery | Test |
| --- | --- | --- | --- |
| invalid namespace or TTL | typed invalid options | correct request | unit |
| staged object fails | existing stage error with evidence | retry or release | injection |
| workspace retention fails | typed workspace retention error | release and retry | unit |
| workspace root cap exceeded | typed capacity error | checkpoint compact roots | unit |
| renew races release/sweep | typed generation conflict | inspect current posture | race test |
| promotion handle is absent | typed promotion error | checkpoint the handle | unit |
| destination promotion fails | destination error, workspace remains active | retry or release | injection |
| release after promotion fails | destination receipt plus cleanup error | inspect and release | injection |
| repeated release | cached receipt with `changed: false` | none | unit |
| expired workspace | inspectable posture, still anchored | renew or sweep | integration |
| malformed/symbolic managed ref | doctor issue and fail closed | repair explicitly | security test |

## Security / Trust / Redaction Posture

- Trust boundary: direct Git refs and immutable tree edges are authoritative.
- Authority checked: workspace methods operate only on their exact managed ref;
  sweep requires an observed generation and expiry proof.
- Secret-bearing values: none. Workspace nonce is uniqueness, not authority.
- Redaction: inspection reports handles only when explicitly requested; default
  doctor output reports counts and bytes without payloads or application keys.
- Clock posture: expiry enables cleanup but never proves liveness by itself.
- Ref posture: symbolic managed refs are invalid and never followed for update
  or deletion.
- Abuse concern: unswept expired workspaces retain storage. Bounded diagnostics
  make this debt visible and explicit sweep releases it.

## Lower Modes

The primary surface is machine-readable JavaScript values and structured
doctor JSON. Documentation presents a linear `try/finally` path. No visual-only
state is introduced.

## Accessibility Posture

Not a rendered feature. API documentation, errors, inspection records, and
witnesses use stable labels in linear reading order.

## User-Facing Text / Directionality

New public prose and errors use concise ASCII English. Structured fields carry
canonical meaning. No left/right or layout-dependent language is introduced.

## Agent Inspectability / Explainability Posture

Agents can distinguish staged, anchored, expired, promoted, and released
postures through immutable receipts. They do not need to inspect reflogs,
guess from object timestamps, or scrape human logs.

## Linked Invariants

- A staged handle is not a durability claim.
- git-cas owns all CAS reachability and temporary lease refs.
- Reachability requires an actual Git edge, not an OID string in metadata.
- TTL never silently revokes a possibly active workspace.
- Promotion establishes destination retention before temporary release.
- Cleanup never deletes a generation that differs from the observation.
- Bounded staging surfaces preserve service byte, member, and root limits.
- Ordinary supported GC grace covers the object-write-to-ref-update window.

## Design Alternatives Considered

### Continue using CacheSet as a workspace

Pros:

- Already implemented and TTL-aware.

Cons:

- Builds cache entry, state, and index bundles for one temporary root.
- Profiled at approximately 6.8 seconds of avoidable downstream latency.
- Confuses reusable derived cache policy with in-progress build lifetime.

### Remove temporary retention and trust object age

Pros:

- Fastest implementation.

Cons:

- Reintroduces the original correctness bug.
- Cannot produce retention evidence or survive supported maintenance.

### One shared workspace CacheSet namespace

Pros:

- Centralized TTL and inspection.

Cons:

- Retains CacheSet index rewrite cost and contention.
- One busy workspace increases mutation cost for every other workspace.

### One direct RootSet per workspace with automatic TTL deletion

Pros:

- Cheap direct reachability and isolated contention.

Cons:

- Automatic timeout can revoke a valid long-running build.
- Timer authority is not proof that the owner is dead.

### Renewable RootSet workspace with explicit expiry sweep

Pros:

- Direct bounded reachability, isolated generations, explicit cleanup, and
  observable abandoned debt.
- Renewal/sweep races are containable through generation checks.
- Clear distinction between staging lifetime and final retention policy.

Cons:

- One temporary ref per active workspace.
- Crashed callers require operator sweep after expiry.
- Scoped staging adds one RootSet mutation per returned staged result unless
  the caller compacts roots through checkpoint.

## Decision

Use one renewable RootSet workspace per active build. Expiry makes the exact
generation eligible for explicit sweep but does not revoke it automatically.
Mirror staging capabilities so safe composition is the easy path, provide
checkpoint compaction for aggregate roots, and make promotion ordering part of
the workspace contract.

## Proof Surface

The implementation must be proven through:

- actual surface under test: public `cas.workspaces` API with memory and real
  Git adapters
- first RED test: a workspace page write returns only after a direct workspace
  ref reaches its page
- required witness: staged dependency survival through bundle construction,
  promotion, aggressive prune after each returned operation, expiry, renewal,
  sweep, and release
- performance witness: direct RootSet checkpoint/release versus the CacheSet
  workaround plus the unchanged downstream 10-second integration hook
- non-acceptable proof: documentation claims, timeout changes, OID presence
  without reachability, or mocks without real Git refs

## Implementation Slices

- Add failing workspace ref, descriptor, lease, and release tests.
- Add RootSet-backed workspace registry and scoped staging wrappers.
- Add cache/publication promotion and failure-order tests.
- Add bounded inspection, expiry sweep, and repository doctor inventory.
- Wire facade, declarations, errors, docs, changelog, and release evidence.
- Publish v6.4.0 before git-warp consumes the API.

## Tests To Write First

Behavior tests required:

- [x] A workspace page write returns anchored evidence.
- [x] Multiple staged handles remain reachable until checkpoint compaction.
- [x] Bundle construction survives supported concurrent aggressive GC checks.
- [x] Checkpoint retains exactly the supplied roots.
- [x] Renewal defeats a stale sweep through generation conflict.
- [x] Expiry alone never removes reachability.
- [x] Sweep removes only expired exact generations.
- [x] Promotion establishes cache/publication retention before release.
- [x] Promotion failure leaves workspace roots reachable.
- [x] Release is idempotent and symbolic/generation races fail closed.
- [x] Doctor reports count, roots, bytes, age, expiry, and posture.
- [ ] git-warp's unchanged QueryBuilder integration passes its 10-second hook.

Rule: documentation tests cannot be the only proof for implementation work.

## Acceptance Criteria

The work is done when:

- [x] Public workspace staging, checkpoint, renewal, promotion, and release are
  behaviorally proven.
- [x] Real-Git reachability and prune tests prove the lifetime boundary.
- [x] Bounded diagnostics and checked sweep prove abandoned roots are
  manageable.
- [ ] Performance evidence proves the workspace is materially cheaper than the
  CacheSet workaround.
- [x] Existing asset, page, bundle, RootSet, CacheSet, doctor, and facade tests
  remain green.
- [x] Public declarations and docs match runtime behavior.
- [x] README, changelog, release notes, and witness are updated.
- [ ] Issue and PR are linked correctly.
- [ ] CI, Code Rabbit, self-review, and independent Code Lawyer review are clean.
- [ ] v6.4.0 is published before git-warp consumes the API.

## Validation Plan

Commands expected before PR:

```bash
npx eslint .
npm test
npm run test:integration:node
npm run release:verify -- --skip-jsr
```

Focused domain, facade, declaration, doctor, and real-Git integration tests run
before the full suite. Downstream git-warp verification runs against the packed
release candidate and again against the published npm package.

## Playback / Witness

The witness records:

- workspace ref topology after each staged result
- target reachability before and after checkpoint compaction
- promotion and release ordering under injected failures
- expiry, renewal, stale sweep, and checked deletion receipts
- doctor JSON for active and expired workspaces
- direct-workspace versus CacheSet timings on the same repository
- downstream git-warp QueryBuilder timing with no timeout change
- full validation command results and release publication evidence

Human playback question: can an application build a large object graph safely
without paying general cache-index costs or learning Git?

Agent playback question: can an agent prove which staging generation retains
each handle, renew it, promote it, and clean it up from structured evidence
alone?

## Risks

Known risks:

- one ref per active workspace can create ref inventory pressure
- crashed workspaces remain anchored until explicit sweep
- a very large active root set can make every stage mutation expensive
- promotion cleanup can partially succeed after destination retention
- unsafe immediate-expiry prune can hit the irreducible staging micro-window

Mitigations:

- inspection is bounded and doctor reports count, age, roots, and bytes
- expiry plus checked sweep exposes and removes abandoned debt
- workspace root count has a hard cap and checkpoint compacts components
- promotion receipts distinguish durable destination success from cleanup debt
- docs state the required ordinary Git grace invariant explicitly

## Follow-On Debt

A future batch-staging protocol may amortize one ref update across multiple
known staged results while preserving backpressure. It must not defer all
reachability until the final aggregate. Physical-byte attribution across
deduplicated workspace graphs also remains repository-diagnostics work.

## Tracker Disposition

| Issue | Role | Expected disposition |
| --- | --- | --- |
| https://github.com/git-stunts/git-cas/issues/75 | primary goalpost | close after v6.4.0 release evidence |
| https://github.com/git-stunts/git-warp/issues/738 | downstream blocked-by | leave open; update after package publication |

## Done Does Not Mean

When this lands, it does not prove:

- that all low-level staging callers use workspaces
- that immediate-expiry concurrent prune is safe during object writes
- that physical storage can be attributed uniquely across deduplicated roots
- that git-warp no longer materializes complete state on every cold path
- that every expired workspace should be swept without operator policy

## Retrospective

Fill this in after implementation.

PR:

- https://github.com/git-stunts/git-cas/pull/76
