---
title: 'TRUST-0063 - Durable Retention Reservations'
cycle: '0063'
task_id: 'durable-reservations'
legend: 'TRUST'
release_home: 'v7.1.0'
issue: 'https://github.com/git-stunts/git-cas/issues/157'
goalpost_issue: 'none'
tracker_source: 'github'
status: 'active'
base_commit: 'ae3a81cddf5f45a54a676c62bdb0335db77da5a0'
owners: ['@git-stunts']
sponsors:
  human: 'James'
  agent: 'Codex'
blocking_issues: []
supersedes: []
superseded_by: null
created: '2026-11-02'
updated: '2026-11-02'
---

# TRUST-0063 - Durable Retention Reservations

## Linked Issue

[#157](https://github.com/git-stunts/git-cas/issues/157) owns this complete
capability. This design does not establish its implementation or release.

## Linked Tracker

The [v7.1.0 milestone](https://github.com/git-stunts/git-cas/milestone/25)
records the release thesis and exit gates. The downstream integration is
[git-warp#1067](https://github.com/git-stunts/git-warp/issues/1067).

## Design Type

Runtime/API, storage/substrate, operator inspection and native proof. No TUI.
The agent-readable library contract is implemented first.

## Decision Summary

Add one hard record-slot admission authority per namespace. Admission charges
a durable attempt before an application may publish. Evidence is pinned before
the attempt becomes prepared. An explicit arming transition then makes its
charge irreversible. Settlement pins the final record before reporting settled.
Cancellation can release only an unarmed attempt. A single indexed ledger ref
serializes capacity and lifecycle decisions; separate per-attempt custody refs
preserve content through ordered, recoverable steps. No cross-ref atomicity is
claimed, and no storage result claims that an application operation occurred.

## Sponsored Human

James needs git-warp to preserve issued observations and reject new work at a
declared capacity, without evicting old observations or maintaining another
storage policy in WARP. An operator must be able to identify unresolved charges.

## Sponsored Agent

Codex needs stable attempt identity and explicit phase evidence. A timeout,
missing process, remembered promise or cached result must not become permission
to release a charge or repeat application publication.

## Hill

Two processes competing for one record slot cannot both obtain admission.
After restart, an attempt can recover its exact original state. A settled
record and its required Git roots survive ordinary GC. A refused attempt never
weakens previous custody. Native races, injected failures and GC witnesses must
prove this through the public package API before the feature ships.

## Current Truth

At the base commit, v7.0.0 is published and its release/registry retrospective is
recorded in [#154](https://github.com/git-stunts/git-cas/issues/154#issuecomment-6565496116).
`BEARING.md` still reports v6.5.11; that prose is not the release authority.

- `RootSet.read/list/mutate` materializes its complete entry set; it cannot be
  the bounded per-attempt index for this feature.
- `CacheSet` intentionally preserves pinned entries beyond its configured cap.
  `accepted` is not hard admission; this behavior remains unchanged.
- `PublicationService` and `GitRefAdapter` provide checked single-ref updates,
  commit creation and explicit parent edges. Existing publications accept at
  most 64 parents. `GitRefPort.anchorRef` verifies a source and creates a pin,
  but is not an application publication/ledger transaction.
- `GitPersistencePort` exposes bounded blob reads, object metadata and tree
  operations. They can support a private fixed-fanout ledger without a new
  storage dependency or the general bundle-derivation API in #86.
- Generic asset/bundle `resolveRoot` validates the complete support graph. Do
  not call it repeatedly to admit one record and claim path-local work.
- [git-warp#1068](https://github.com/git-stunts/git-warp/pull/1068), at
  `2a88ee6625d498b0057e3ba1c0cafd9786a22099`, supplies six native published-
  dependency cases. CAS publication preserves 129 writer commits in both
  object formats after source-ref removal and GC. Metadata-only OIDs do not.
  Those cases do not implement reservations or prove concurrency/recovery.

## Problem

An application can publish successfully and lose its response, or fail while
retaining the observation that justified its publication. Storage cannot infer
which occurred. A cache, process lease or temporary handle cannot safely decide
when such an attempt stops consuming permanent retention capacity.

## Scope

Namespace policy, immutable attempt records, a bounded persistent index,
checked admission, prepared custody, arming, settled custody, cancellation,
restart reconciliation, paginated inspection and a public facade/declarations.
The complete outcome remains one coherent PR for #157. Internal commits are
implementation steps, not separate independently releasable features.

## Non-Goals

Physical-byte quotas, expiry, automatic intent retry, WARP receipt semantics or
authorization, the v8 package split, complete bundle derivation, a new GC engine,
an armed-charge release operation, or detection of an adversary rewriting Git
refs outside the protocol. No compatibility cache can stand in for this API.

## Runtime / API Contract

`cas.reservations.open({ namespace, capacity: { unit: 'record-slot', limit } })`
creates or verifies the durable namespace configuration. Limit is a positive
safe integer. Reopening with a different unit, limit or format refuses. The
initial release does not silently resize a namespace.

The implemented open result is either a frozen `ReservationNamespace` with
`status: 'opened'`, a `refused` policy/contention result or an `indeterminate`
result retaining its cause. The empty index and zero-charge header are installed
before returning the namespace. `openedRevision` records that observation;
subsequent operations reread the current authority.

The service operations are `reserve`, `prepare`, `arm`, `settle`, `cancel`,
`inspect` and `reconcile`. Each names one bounded attempt key and its exact
caller-supplied SHA-256 request binding. Reusing a key with a different binding
refuses. The caller owns the meaning and canonical computation of that binding;
CAS checks exact identity, not application semantics. Keys are printable ASCII,
1–128 bytes, and are hashed with domain separation before becoming storage paths.

Preparation/settlement contain a bounded record page, explicit immutable
support targets and bounded commit parents. CAS validates canonical OIDs,
actual object types and the declared limits before anchoring any claim. These
are transport inputs at the storage boundary, analogous to existing RootSet
targets. WARP's adapter supplies its original basis tree; its public Coordinate
never exposes these fields. CAS owns the tree layout, refs and reachability.
Existence/type validation does not claim full application-format validation.

Each record page is at most 16 MiB. One preparation or settlement has at most
64 blob/tree support targets and 63 commit parents. The previous custody commit
occupies the remaining parent position on settlement. Larger history frontiers
must first be represented by a CAS publication carrier through the existing
bounded publication API; never collect them into an oversized parent array.
The larger WARP custody integration must prove that construction separately.

Result families distinguish admitted/recovered, refused, freshly armed,
already armed, settled, cancelled and indeterminate. Failed observation of a
durable operation yields indeterminate with stable attempt identity. Expected
capacity, phase and binding failures are explicit values. Operational failures
retain their cause. Inspect/reconcile never rerun the application operation.

**Only a successful fresh arming acknowledgement permits an external effect.**
An already-armed inspection/retry grants no second execution permission. A lost
arming response can strand a charge even if no effect ran; it cannot justify a
new effect or cancellation. The application must report/reconcile that
uncertainty from its own publication evidence. No lease or timeout resolves it.

Read-only work can prepare evidence, produce a result and settle directly from
prepared. It need not arm an external publication. Its cancellation competes
with settlement at the same ledger authority. A settled acknowledgement is the
point at which the caller may issue a durable locator.

## Data / State Model

| Phase | Charge | Required custody | Allowed next phase |
| --- | --- | --- | --- |
| reserved | 1 | None claimed yet | prepared, cancelled |
| prepared | 1 | Original input record/support pinned | armed, settled, cancelled |
| armed | 1 | Prepared evidence remains pinned | settled |
| settled | 1 | Original and final records/support pinned | Exact idempotent resolution only |
| cancelled | 0 | No surviving custody promise | Terminal tombstone only |

Uncertainty is an observation result, not a sixth fabricated durable phase.
Preparation and settlement are bound to their original custody commit OIDs.
Conflicting evidence for the same phase refuses; a later retry cannot recapture
a newer basis. Cancelled keys remain tombstones and can never be readmitted.

The namespace header contains format, immutable policy and charged count.
The counter and changed attempt path publish under one expected ledger head.
Only cancelled records reduce the charge. Checked arithmetic refuses overflow.
An exact retry looks up the record before evaluating free capacity.

## Git Substrate Impact

`refs/cas/reservations/<namespace>` names a parentless current ledger commit.
Its tree contains the header and a private 16-way index of attempt records.
Index paths use a domain-separated SHA-256 digest, at most 64 digits. Collision
with a different stored key refuses. Only the selected path is copied; cancelled
tombstones remain indexed. Ledger ancestry must not accidentally retain every
cancelled preparation forever.

`refs/cas/reservation-custody/<namespace>/<attempt-digest>` names the attempt's
custody commit. Preparation creates it with checked absence. Settlement uses
the preparation commit as a parent and a checked update, retaining its original
evidence. Trees carry real blob/tree edges; commit parents carry history edges.
OID text and gitlink entries never count as history retention.

All updates/deletes use expected OIDs and no-dereference behavior. Observed
symbolic refs refuse. No public operation rewrites an armed/settled custody ref
to a generation that drops its prior roots. Ordinary cache cleanup, close and
access revocation have no deletion authority over this namespace.

### Durable ordering and races

1. Reserve: publish the charged attempt and counter in the ledger. A lost
   response is resolved by exact-key inspection; no new key is minted.
2. Prepare: create the custody pin, then CAS reserved to prepared in the ledger.
   If cancellation wins the ledger race, prepare cannot arm. Delete only an
   exactly observed cancelled-attempt pin, after verifying its binding.
3. Arm: verify prepared custody, then CAS prepared to armed. A candidate domain
   object is not permission: only the persisted winning transition can produce
   the fresh-arming acknowledgement. Cancel and arm cannot both win.
4. Settle: pin the final record as a descendant of preparation, then CAS the
   ledger to settled. No durable locator is returned before both steps succeed.
5. Cancel: CAS reserved/prepared to cancelled and decrement the charge, then
   remove only that cancelled attempt's expected custody generation. If arm or
   settlement won first, cancellation refuses and performs no deletion.

A delayed prepare/settle writer can create a pin after cancellation cleanup.
It still cannot obtain an armed/settled ledger acknowledgement. It must recheck
the terminal state and clean its exact pin. A crash at that point leaves
inspectable cancelled-attempt residue for bounded reconciliation; it does not
restore admission or release an armed charge. The count cap is not a bound on
temporary orphan bytes. Whole-store reset/deletion remains outside this API.

A settlement retry first examines existing custody. An exact final descriptor
can complete the ledger transition; conflicting final evidence refuses. Missing
or corrupt custody for prepared/armed/settled records is unavailable evidence,
never permission to fabricate a record, refund a charge or remint a locator.

These steps use individual checked ref operations. Git documents that a reader
can observe only part of a multi-ref transaction; the design therefore has no
multi-ref snapshot assumption. See [git-update-ref](https://git-scm.com/docs/git-update-ref).

## Architecture / Anti-SLUDGE Posture

Runtime-backed frozen attempt, policy, custody descriptor and result concepts
own validation and state transitions. Core performs no ambient time/entropy or
host I/O. Inject Git persistence/ref/crypto ports. Encoding and bounded parsing
belong in explicit codecs/adapters. Storage must validate evidence before
constructing successful results. No callbacks can replace the capacity policy.
Never branch on exception message text to decide custody or publication truth.

## Cost / Residency Posture

Admission, lookup and lifecycle changes read/copy at most one 64-level 16-way
path plus bounded header/record/custody data per attempt. Index tree objects are
limited to 2 KiB before materialization; metadata/record descriptors to 16 KiB.
Leaf payload pages have their separate 16 MiB bound. Working state is bounded
by depth, fanout and these page limits, not total observations.

Operator listing uses a snapshot-bound cursor, at most 100 records and an
explicit visited-node budget per call. It returns a continuation even when a
filter yields fewer matches; no hidden scan-to-fill. Interrupted/missing snapshot
evidence returns an unavailable cursor result. Admission never uses listing.

The concrete `list({ cursor, phase, limit, nodeBudget })` surface allows 1–100
records (default 100) and 129–8192 visited index objects (default 1024). Tree and
record reads, including cursor seeking, spend this budget. Ledger/header reads
are fixed additional bounded work. The minimum covers seeking past one
64-level path and reaching the next record. Empty non-root branches refuse as
corruption. A cursor contains namespace, ledger revision, last visited route and
phase filter; it can be serialized, but it is neither a pin nor authorization.
Traversal state is at most 64 bounded nodes plus100 output records. Listing
reports ledger claims; `inspect` separately verifies current required custody.

`readEvidence({ key, binding, stage })` returns a copy-owned original or final
page only after the corresponding ledger acknowledgement and custody checks.
`reconcile({ key, binding })` may finish prepared/settled publication from an
existing valid pin, or remove cancelled residue. It never arms an attempt,
replaces evidence, releases an armed charge or retries application work. A
point inspection reports both observations without claiming cross-ref atomicity.

Validate header counters, local shape, bounds and the traversed path before
mutation. This does not constitute a full audit of unvisited, maliciously
rewritten subtrees. A separate bounded diagnostic traversal can verify counts
and pin consistency over a declared snapshot. Normal operation assumes managed
refs are mutated through this protocol; raw-ref tampering is outside admission
authority. Ordinary detected corruption fails closed.

Metadata, cancelled tombstones, charged records and Git objects grow with work.
There is no constant-disk claim. Native call-count and peak-residency evidence
must accompany the final implementation; the bounds above are design targets.

## Determinism / Replay / Causality

Canonical descriptors and route hashing are versioned/domain-separated. Exact
attempt, preparation and settlement identities survive restart. CAS does not
decide whether a WARP intent was admitted or published, and never retries that
intent. Commit identity timestamps do not authorize a transition or reclamation.

## Compatibility / Migration Posture

Additive v7.1.0 facade/declarations and a new managed format. Existing caches,
root sets, publications and stored payload formats keep their contracts. Older
versions cannot operate this new namespace; no downgrade deletion or automatic
format repair exists. WARP consumes the registry release only after verification.

## Error Contract

Capacity-full, policy mismatch, key-binding conflict, wrong phase, evidence
conflict, unsupported capability, contention exhaustion and unavailable evidence
are distinct outcomes. Invalid boundary input is a typed CAS error. A failed
write followed by failed inspection is indeterminate, never known-unpublished.
Arming retry returns already-armed rather than a new execution permit.

## Security / Trust / Redaction Posture

Namespace access is storage authority, not WARP disclosure authority. Possessing
an attempt key or record handle grants no application rights. Diagnostics emit
phase, count, stable identities and structured failure codes; they do not dump
record payloads. Callers must avoid secrets in keys. The binding is not a MAC or
proof of authorship. Raw Git writers can bypass the protocol and are excluded
from its cooperative admission guarantee.

## Lower Modes

Every result is inspectable without color or a diagram. No new CLI/TUI is
required; structured library inspection and JSON witness output are the surface.

## Accessibility Posture

The phase table and ordered transition list are the complete linear reading
model. Diagrams may illustrate them but contain no exclusive information.

## User-Facing Text / Directionality

Stable codes identify failures; English descriptions explain the next safe
operation. No spatial directions, localization system or visual-only status.

## Agent Inspectability / Explainability Posture

Report the exact namespace, key binding, observed phase and custody generations.
Separate freshly won permission from recovered state. An agent must be able to
say why capacity remains charged without interpreting a human prose message.

## Linked Invariants

[I-001](../../invariants/I-001-determinism-trust-and-explicit-surfaces.md) and
[I-002](../../invariants/I-002-application-storage-ownership.md).

## Design Alternatives Considered

CacheSet soft policy cannot enforce admission. RootSet callbacks materialize the
full index and transfer policy into consumers. A WARP-owned counter duplicates
the storage authority. An expiring lease cannot fence a delayed publisher.
One ancestry-preserving ledger commit would permanently retain cancelled
preparations. A multi-ref publication transaction would require a larger
application-effect protocol and still would not supply atomic reader snapshots.
General bundle derivation (#86) is adjacent work, not a necessary dependency of
this small fixed-format index.

## Decision

Use a checked indexed ledger plus separately pinned attempt evidence, ordered
so a completed promise always follows its durable prerequisites. Keep the
arming boundary explicit and conservative about lost acknowledgements. Preserve
the original application evidence instead of inventing an automatic recovery.

## Proof Surface

Private transition tests establish only local lifecycle laws. Final acceptance
must exercise `cas.reservations` with real Git in SHA-1/SHA-256, multiple store
instances, faults around every checked write, reopen and GC. A diagram, type
declaration, synthetic counter or always-refused facade is insufficient.

## Implementation Slices

Within this one draft PR: validated transition records; bounded index and codecs;
ordered custody/ref persistence; facade/declarations/inspection; native races,
faults, resource witnesses and release-facing documentation. No internal slice
is advertised as the complete public contract.

## Tests To Write First

Cancellation versus arming in both orders; no second arm grant; immutable exact
preparation/settlement; malformed state reconstruction; capacity-one races;
same-key retry at full capacity; conflicting key reuse; cancelled tombstone
reuse; missing pin; pin-write/ledger-write response loss; late pin after cancel;
settlement versus cancel; >64 retained records with oldest evidence after GC;
symbolic-ref rejection; bounded deep-path and filtered-page inspection.

## Acceptance Criteria

All #157 checks must pass on the actual public surface. Required native fault
points are before/after charge, pin creation, preparation publication, arm CAS,
final pin, settlement CAS, cancel CAS and pin deletion. Assert roots, counts,
fresh-permission count and unchanged earlier receipts after each outcome.
Unknown and armed attempts are never reclaimed by time or process death.

## Validation Plan

Use the existing guarded COPY-only git-cas worker and canonical workstation lock.
Run focused checks while editing, then the required lint/unit/integration and
Node/Bun/Deno chain on the stable candidate. Run declaration/package/consumer
checks and the release method before publishing. Record exact source hashes,
RED/GREEN boundaries, resource limits and independent current-head review.

## Playback / Witness

Retain the final commands, source identities, per-format race/fault results,
GC survival evidence, original record digests and bounded-work measurements in
this cycle's witness directory. Current artifacts must label model-only evidence
as such. A release requires a fresh installed downstream consumer.

The [private transition-core checkpoint](witness/README.md) records the first
local lifecycle tests and their exact source hashes. It supplies no persistence,
concurrency, restart or public API evidence.

The subsequent [point-index checkpoint](witness/point-index.md) verifies bounded
immutable lookup/update, canonical record parsing and native tree persistence
in both Git object formats. The test harness supplies its roots; it does not
establish the reservation ledger, admission, custody or a public API. Bounded
operator pagination remains work to implement.

The [private admission checkpoint](witness/ledger-admission.md) subsequently
implements the policy/header, atomic record-and-count publication and exact-key
recovery. Independent native processes race at capacity one in both object
formats; response-loss, symbolic-ref, restart and ledger GC cases pass. These
tests exercise private services, not the public facade or prepared/settled
custody. Namespace initialization without a first admission, lifecycle
publication, evidence pins and operator pagination remain ahead.

The [ordered custody checkpoint](witness/ordered-custody.md) subsequently
implements private preparation, fresh arming, settlement, cancellation and
point inspection. Actual page/support/history edges are pinned and verified;
cancelled tombstones permit only checked pin cleanup. Native two-process races,
maximum root counts and before/after ref fault cases pass in both formats.
Public namespace open, operator pagination/reconciliation, facade/declarations
and installed-package acceptance remain ahead. Private evidence is not promoted
to a released public capability.

## Risks

An armed charge can remain unresolved forever; that is deliberate when no safe
reclamation proof exists. Cancelled pin residue needs bounded reconciliation.
High contention needs a finite retry budget. Caller binding mistakes are not
detectable application-semantic errors. Arbitrary raw-ref tampering is outside
the guarantee. Never hide any of these behind a success receipt.

The [public recovery checkpoint](witness/public-recovery.md) adds 32 native
public write-fault cases and 22 independent-process cases across both formats,
including process-group death around arming. Node and Deno run the new cases;
complete native cost/residency, supported-runtime, review and release gates
remain open.

## Follow-On Debt

The [public surface checkpoint](witness/public-surface.md) now records durable
open, bounded listing, point inspection, reconciliation, exact page retrieval
and the facade/declarations. It distinguishes public native/packed-consumer
evidence from the remaining full fault/race/runtime/release contract.

No acceptance requirement is deferred. General derivation remains #86; WARP
meaning and historical authorization remain git-warp#1067/#1053. Any new omitted
requirement needs an issue and explicit disposition before closeout.

## Tracker Disposition

#157 remains open until the complete capability and witnesses land; release and
registry verification are milestone exit gates. Downstream git-warp#1067 stays
blocked until a verified release is consumed. Draft/model commits close neither.

## Done Does Not Mean

No physical-byte quota, external-effect atomicity, automatic intent recovery,
WARP authorization, complete Optics API, or finished v8 package split is implied.

## Retrospective

Fill after implementation, merge and publication. No completion is asserted here.
