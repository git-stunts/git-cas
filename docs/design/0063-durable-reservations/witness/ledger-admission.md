# Private durable reservation admission

This checkpoint implements record-slot admission within [#157](https://github.com/git-stunts/git-cas/issues/157)
and [draft PR #158](https://github.com/git-stunts/git-cas/pull/158). It is not the
complete reservation capability or a release candidate.

## Implemented behavior

`ReservationLedger.reserve` reads a direct namespace authority, its immutable
policy and charged count, then the bounded exact-key index. The same key and
binding recover their original record even at capacity. Conflicting bindings,
cancelled tombstones, policy changes and new keys at capacity refuse.

A new charge publishes a canonical header and changed index below one tree in
one parentless commit. Its checked ref update compares the previously observed
head, or requires absence for initial creation. Only that acknowledgement
returns `admitted`. At most four typed ref conflicts are retried. Other failures
inspect the same identity: installed evidence recovers; absence remains
indeterminate. If inspection also fails, both causes survive in the result.
Neither admitted nor recovered is permission for an application effect.

`GitRefPort.inspectRef` and the native adapter expose exact direct/symbolic
posture. A dangling symbolic ledger is not treated as an absent namespace.
Commit objects are type/size checked (16 KiB) before reading parents/tree. Root
trees are bounded to 2 KiB, have exactly the header and records entries, and
contain canonical same-format OIDs. The header is bounded to 16 KiB before its
canonical decoder reconstructs frozen policy/count objects. The ledger must
be parentless and name the requested namespace.

This is local/path validation, not a scan of every indexed record or proof
against arbitrary ref tampering. The counter is maintained by the protocol's
single checked publication. Existing charged records with a zero aggregate
are rejected. The private store is not an application API for arbitrary count
changes; manual test writes model later lifecycle publication only.

## Validation and limits

The guarded COPY-only `ledger-native-green-01` phase passed:

- 130 focused cases across lifecycle, index, admission, store and both codecs.
- Eight native admission cases (four each in SHA-1/SHA-256), plus the two
  earlier point-index persistence cases.
- Repository lint and the complete Node unit selection: 2,353 passed, three
  existing conditional skips; 241 files passed and one skipped.

The native race uses independent child processes with a barrier after both
have observed an absent authority. Two different keys yield exactly one
admitted and one capacity refusal. Concurrent identical keys yield one
admission and one recovery, with one charge. A separate injected failure after
a successful native ref write recovers; another fresh process recovers the same
revision after real GC. The dangling-symbolic case preserves the symbolic ref
and does not create its target. All native children close their adapters.

The initial RED was missing modules, with zero cases executed. The first
implemented run passed 33 focused cases but failed lint on the test helper's
unqualified `TextEncoder`; `globalThis.TextEncoder` fixed it before the complete
chain. No behavioral RED is claimed for admission. [Exact-source receipt](ledger-admission.json)
records the exercised source hashes and phase/log identities.

Resource enforcement reused the existing `git-cas-tests` worker and canonical
workstation lock. Readonly root; source/dependencies/stores/caches under 3 GiB
tmpfs; 16 MiB each for the other temporary filesystems; 4 CPU/8 GiB/512 PIDs;
rotated Docker logs; monitored host evidence, free-space floors and deadlines.
Each native child has a 30-second process-group deadline and 64 KiB stderr cap.
The final phase ended at 118,604 KiB `/data` plus 824 KiB home usage; these are
end measurements, not peaks. Worker shutdown clears the generated tmpfs data.

## Remaining work

Persist namespace policy on public open before the first reservation; prepare
and settle actual evidence custody; publish lifecycle transitions; implement
bounded inspection/reconciliation and the public facade/declarations. Prove
the complete native failure matrix, cancellation/arming races, late pins,
settlement and old evidence after GC through the public package API.

Current-head independent review, all runtime gates, release and fresh installed
downstream verification remain required. [#159](https://github.com/git-stunts/git-cas/issues/159)
tracks the existing Deno dependency-resolution failure. This checkpoint does
not repair or waive it.
