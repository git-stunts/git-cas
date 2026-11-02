# Public reservation surface checkpoint

Issue157 remains in draft PR158. The public namespace now composes the private
ledger/custody protocol; this checkpoint does not authorize merge or release.

## Behavior

Opening persists a zero-charge ledger and immutable record-slot policy before
returning a namespace. Competing policy values choose one authority; mismatched
reopen refuses. Positive matching evidence can recover a lost open response.
All lifecycle operations preserve exact caller identity and the original
custody protocol. Only fresh arming grants effect permission.

Point inspection returns ledger metadata and separately observed custody.
Evidence reads require the acknowledged phase and valid custody, and return
copy-owned original/final bytes. Reconciliation finishes a valid installed
preparation or settlement, or cleans cancelled residue. It never arms, executes
application work, substitutes evidence or releases an armed charge.

Listing traverses one immutable index. Cursors bind namespace, revision, route
and phase filter. Every index tree/record read, including seek, spends the
129–8192 node budget. Each page returns at most 100 records; filtered empty pages
still advance. The fixed ledger/header validation cost is additional. The
traversal stack is at most 64 bounded nodes. Cursors do not pin old snapshots;
missing or corrupt evidence returns unavailable without partial records or a
silent restart. The listing is not a full audit or a live pin check.

## Executed evidence

`public-native-green-02` passed 183 focused and 64 native cases. Eight native
cases exercise the public facade: empty policy through reopen/GC, original and
final pages/support/history after source-ref removal, 72-record cursor walks,
collected snapshot refusal and terminal cancellation in SHA-1/SHA-256. The other
56 cases retain the previous private fault/race/GC coverage; they are not
relabeled as public acceptance.

That phase passed 2405 unit cases with 3 existing conditional skips and failed
one package-documentation case: ARCHITECTURE linked locally to a design file
excluded from npm. The link now points to the GitHub draft. The focused
`public-closeout-green-01` rerun passed all 4 package-documentation cases and
lint. The other runtime/test inputs are byte-identical to the full suite.
This is an explicit repaired-check chain, not a claim that the original full
unit invocation was all green.

Deno checked both the source declarations and a fixture importing declarations
from the freshly installed npm pack. Negative assertions reject byte quotas,
commit-valued supports and fresh arming from inspect/reconcile. The first check
correctly failed because Deno had not selected the new sidecar declarations;
self-type directives fixed that real loss of type information. A Node consumer
using only the installed package root completes lifecycle, exact readback,
close/reopen, GC and capacity refusal in both object formats. The tarball still
has the draft branch's 7.0.0 package metadata; it is not the published registry
artifact or the future 7.1.0 release.

The initial RED executed one facade-capability assertion against bdc4d62 and
failed on the absent reservations group. The first 14-case GREEN passed behavior
but failed lint on method sizes/complexity. Those methods were simplified and
all later lint checks passed. The [machine receipt](public-surface.json) binds
runtime/test bytes, exact phase/log hashes and resource measurements.

## Bounds and remaining work

The existing COPY-only worker/image, canonical workstation lock and guarded
runner were reused. Readonly root, bounded 3 GiB runtime tmpfs, three 16 MiB scratch
filesystems, 4 CPU/8 GiB/512 PID limits, rotated logs, host evidence/log caps and
host/VM 50 GiB floors remained enforced. The runner stopped the worker and its
children after each phase. End measurements in the receipt are not peaks.

Manual SSJS review: new concepts are validated frozen runtime values; external
capabilities are injected; encoding remains in codecs; lifecycle decisions
remain on the ledger; no ambient clock/entropy or message-parsed decisions were
added. Declaration rejection tests verify meaningful boundaries, not only a
positive compile. No full coverage or independent-review claim is made.

Remaining acceptance: public API before/after faults at every durable boundary,
independent-process public races/recovery, native operation-count and measured
residency witnesses, full supported-runtime/release checks, current-head
independent review, publication and fresh downstream installation. Issue159
owns the existing Deno dependency-install failure. No requirement is deferred
from issue157, and WARP1067 still requires the published capability.
