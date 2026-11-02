# Ordered reservation custody checkpoint

This implements the private custody/lifecycle portion of [#157](https://github.com/git-stunts/git-cas/issues/157)
inside [draft PR #158](https://github.com/git-stunts/git-cas/pull/158). It does not
complete the public reservation API or authorize a release.

## Runtime behavior

Preparation owns a copied page (at most 16 MiB), at most 64 blob/tree support
edges and 63 external commit parents. Canonical, immutable descriptors bind
namespace, exact key/binding, stage, page OID and roots. Supports and external
parents are canonical sorted sets with duplicates rejected. Actual object
types are checked. Roots are actual tree edges and commit parents, not OID text
or gitlinks. Descriptor decoding is bounded to 16 KiB and checks canonical bytes.

Preparation creates an attempt custody ref before the ledger becomes prepared.
Settlement advances that pin with a commit whose first parent is the original
preparation, leaving up to 63 external parent positions. The final and original
pages, support roots and history remain reachable. Equal descriptors recover
across commits with different timestamps; conflicting evidence refuses.

The ledger verifies required custody before recovering a prepared/armed/settled
record or publishing a dependent transition. Only a successful fresh prepared
to armed ledger update returns `armed`. A lost arming acknowledgement observes
the durable armed state but returns `already-armed`, granting no second effect.
Point inspection and exact reserve retry return `recovered`, never fresh arming.

Cancellation competes at that same ledger ref. Only reserved/prepared attempts
can become a terminal cancelled tombstone and reduce the count. Pin deletion
follows that publication and uses the exact observed generation. Armed/settled
attempts refuse cancellation without deleting custody. An unavailable deletion
leaves a zero-charge cancelled record and inspectable pin residue; retrying
cancellation cleans it without another refund. A late preparation cannot revive
the tombstone and cleans its pin after observing cancellation. No expiry,
process-death reclamation, application retry or multi-ref atomicity is claimed.

Custody readers bound commit metadata to 16 KiB, root trees to 2 KiB, support
trees to 8 KiB and descriptor blobs to 16 KiB before reading their contents.
They validate exact names, modes, page/support edges, parent lists, identity and
the original preparation. Each pin inspection validates its current generation
and, for settlement, the original preparation. A protocol operation can perform
several such bounded inspections; this is not a two-read-per-operation claim.
External history is type-checked without traversing its ancestry.
This is bounded declared-root validation, not an audit of application semantics
or every descendant of an arbitrary support tree.

## Validation

The final guarded COPY-only phase `custody-native-green-03` passed:

- 167 focused cases across lifecycle, index, ledger, custody and codecs.
- 56 native cases: two point-index, eight admission, 14 custody/race/boundary
  cases and 32 before/after durable-ref fault cases.
- Repository lint and 2,390 Node unit cases; three existing conditional skips.
  244 unit files passed and one was skipped.

The native matrix injects an error immediately before or after actual charge,
preparation pin, preparation ledger, arm, final pin, settlement ledger,
cancellation ledger and cancelled-pin deletion operations. Each case confirms
that the targeted boundary was reached, inspects the count/phase, closes
adapters, runs real GC, reopens and retries the original identity. In particular,
post-arm response loss never returns a fresh arm permission.

Independent processes share a first-read barrier for arm/arm, arm/cancel and
settle/cancel races. One fresh arm wins; cancellation and irreversible outcomes
cannot both win. Model tests force both possible winners of cancel races, cover
a pin arriving after cancellation has returned, and test equal/conflicting
concurrent final descriptors.

Native lifetime cases remove a source ref before GC, then read original/final
pages, support content and history through the custody roots. Cancelled custody
is absent after GC despite its OID remaining as tombstone text. Maximum-root
cases retain 64 support objects and 63 external parents, with preparation as
settlement parent 64. Every native case runs in SHA-1 and SHA-256.

The behavioral RED overlays the prior `1dbc48b` ledger/admission implementations
inside the disposable Docker copy and runs the new missing-custody regression.
It fails with `recovered` where `indeterminate` is required. The candidate checks
the pin before recovery. This is an executed behavioral failure, unlike the
earlier admission checkpoint's missing-module RED.

Intermediate failures are retained: the first new tests incorrectly tried to
spy on a frozen service instead of its injected ref port; those harnesses were
corrected. Lint required simplifying transition preconditions and moving a
nested test callback. The complete final chain then passed. The [receipt](ordered-custody.json)
binds exact source hashes, phase/log hashes, the baseline override and limits.

## Resource and evidence boundaries

The existing `git-cas-tests` worker/image and canonical workstation lock were
reused. All generated dependency, source, store and cache files stayed in its
3 GiB tmpfs, with 16 MiB bounds on other temporary filesystems, a readonly root,
4 CPU/8 GiB/512 PID limits, rotated Docker logs and monitored host evidence/free
space. Child processes have 30-second group deadlines; cases have 90-second
deadlines. The outer guard stops the entire worker on timeout or monitoring
failure. Final end usage was 118,732 KiB in `/data` and 832 KiB in home; these
are end measurements, not peaks. Shutdown clears those generated files.

The tests use private services and explicit adapter faults. They do not prove
the public facade, an arbitrary crash schedule, another machine's coordination
or an application's external effect. Public namespace creation, bounded
operator listing/reconciliation, facade/declarations, >64 retained-record
inspection, complete installed-package acceptance, all runtime gates and fresh
independent review remain. The Deno install failure is still tracked in [#159](https://github.com/git-stunts/git-cas/issues/159).
Publish and verify the release before WARP consumes the capability.

Manual SSJS review on new core concepts: validated frozen runtime forms,
constructor-injected ports, boundary-only encoding, owning-type behavior, no
ambient clock/entropy and no error-message-based decisions. No full coverage or
independent-review claim is made by this checkpoint.
