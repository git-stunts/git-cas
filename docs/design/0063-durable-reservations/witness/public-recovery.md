# Public reservation recovery checkpoint

The public facade now has native failure and independent-process acceptance
coverage in SHA-1 and SHA-256 repositories. This adds evidence to the unreleased
capability in #157; it does not declare the complete feature ready to ship.

## Durable write failures through the public facade

`reservation-public-faults.test.js` runs 32 cases: eight durable boundaries,
before and after each operation, in both formats. The boundaries are charge,
original evidence pin, preparation ledger, arm CAS, final evidence pin,
settlement ledger, cancellation ledger and cancelled pin deletion. Injection
wraps the actual GitRefAdapter reached through `ContentAddressableStore.open()`;
it does not construct a private reservation ledger in place of the public API.

Every case checks the current attempt and an earlier settled receipt, closes
adapters, runs real Git GC, reopens, reconciles, retries and repeats GC/reopen.
The earlier original/final pages, support tree and history parent remain readable;
its captured receipt fields remain unchanged. Charged counts, terminal state,
capacity refusal and exact evidence readback are asserted throughout. Settlement
faults begin from an armed attempt. A lost arm response never creates another
fresh permission during recovery.

## Independent processes and actual process death

`reservation-public-processes.test.js` runs 22 cases across both formats. Workers
open the real public facade independently and synchronize their first ledger
read before either update. Cases cover capacity-one distinct-key admission,
exact retry and conflicting binding, lost admission acknowledgement, two fresh
arm callers, arm/cancel and settle/cancel with each winner order, and a stale
preparation resumed after cancellation and replacement-slot admission.

Two termination positions per format stop the owned worker process group with
SIGKILL immediately before or after the actual arm CAS. The parent requires the
SIGKILL close signal, then reopens through GC and checks retained preparation,
charged count and phase. Before the CAS, a retry can obtain the first arm. After
the CAS, the durable armed state refuses another arm. Reconciliation does not
execute application code or produce a new arm permission.

The 32 fault cases inject exceptions around completed or unstarted ref calls.
The four termination cases kill processes without their cleanup. Neither is a
physical power-loss or arbitrary-instruction crash campaign.

## Executed validation

The guarded `public-recovery-01` phase passed:

| Check | Result |
| --- | --- |
| Node reservation integration selection | 118 passed in 7 files |
| Full Node unit suite | 2,406 passed; 3 existing conditional skips |
| ESLint | passed |
| Deno public fault/process selection | 54 passed in 2 files |

The integration selection includes the existing private ledger/custody tests,
so the shared process-harness change has regression coverage. The preceding
`public-processes-01` phase passed its 76 selected tests, then failed lint because
an internal function had four parameters. The helper now receives a named
fixture descriptor; the final phase above checks those corrected bytes.

The complete copied-source identity and exact raw log/receipt hashes are in
[the machine receipt](public-recovery.json). The source identity is reconstructed
from its base commit plus every changed/added/removed file and compared with all
original receipt hashes. It is a content/path digest, not a Git tree hash.

## Resource and proof boundaries

The existing COPY-only worker and immutable image were reused under canonical
workstation admission. The root is readonly; generated files live within a
3 GiB runtime tmpfs and three 16 MiB filesystems. The worker has 4 CPU, 8 GiB RAM,
512 PIDs, rotated Docker logs and an 850-second inner/900-second outer deadline.
Host evidence and stdout caps plus host/VM free-space monitoring stop the worker
on refusal or monitoring failure. No new worker, image, volume or host test ran.

Final `/data` usage was 121,896 KiB plus 840 KiB in the bounded home filesystem;
these are final measurements, not peaks. Stopping the worker clears those tmpfs
outputs. Native operation counts and measured peak residency remain separate
acceptance work, as do complete supported-runtime gates, independent review,
release and a fresh downstream registry installation.

Manual structure review: test-only public adapter interception, explicit fixture
ownership and cleanup, bounded child stderr and deadlines, deterministic read
barriers, both checked-update winner orders, no application callback during
reconciliation, no production model change. The tests assert public outcomes
and real object retention rather than mirroring a private implementation.
