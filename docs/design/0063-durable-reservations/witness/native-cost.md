# Native reservation work and residency

The public facade passes 60 finite native measurements: ten operations against
1, 17 and 129 already-settled records, in both SHA-1 and SHA-256. Every operation
runs in a fresh Node process. Fixture creation runs in a separate process;
seeding allocations cannot contaminate the measured process high-water mark.
No production code changes in this checkpoint.

Sources: [controller](../../../../scripts/diagnostics/measure-reservations.js),
[scenario](../../../../scripts/diagnostics/ReservationMeasurementScenario.js),
[raw structured results](native-cost-results.json), and
[complete copied-source identities and phase receipts](native-cost-receipt.json).
The snapshot identity covers every copied regular file, including both added
scripts; it is not a claim that the unchanged base commit alone was tested.

## What was exercised

Each seed uses public `ContentAddressableStore.open`, then reserve, prepare, arm
and settle with distinct 4 KiB original/final pages. After closing and GC,
measurement workers use the public constructor with the existing counting
wrapper around native Plumbing, and open the same reservation namespace.
No private ledger/index substitute is injected.

The sequence inspects the oldest record, reads its original page, performs a
filtered bounded list, reserves/prepares/arms/settles one additional attempt,
checks the arm retry refuses, and checks capacity refusal. After another
close/GC, a new process retrieves the oldest final page byte-for-byte. Thus the
129-record case also checks old custody survives subsequent settlement,
capacity refusal and collection. It does not add a new maximum-parent witness;
that evidence remains in the existing custody tests.

## Counts

These native starts include namespace initialization/open and close as well as
the selected operation. Git's TRACE2 start events agree exactly with the
counting wrapper's total process-opening calls for every sample. Session
requests below cover only the operation, after namespace open. Reusing a
process does not make its requests free.

| Operation | Native Git starts, all six scenarios | Session content reads at 1 / 17 / 129 records | Session tree writes |
| --- | ---: | ---: | ---: |
| Inspect oldest | 15 | 71 / 71 / 71 | 0 |
| Read original | 23 | 75 / 75 / 75 | 0 |
| Filtered listing | 9 | 66 / 130 / 130 | 0 |
| Reserve | 15 | 2 / 3 / 3 | 65 |
| Prepare | 25 | 70 / 70 / 70 | 67 |
| Arm | 23 | 71 / 71 / 71 | 65 |
| Retry arm | 13 | 69 / 69 / 69 | 0 |
| Settle | 33 | 74 / 74 / 74 | 67 |
| Capacity refusal | 9 | 2 / 3 / 3 | 0 |
| Read oldest final after GC | 23 | 75 / 75 / 75 | 0 |

Both object formats produced these counts. The listing asks for reserved records
in a store containing only settled ones: it returns zero matches, visits 65
index objects at size one, and stops at the 129-node budget with a continuation
at sizes 17 and 129. The 130 session content reads include the bounded header
read in addition to index visits. It does not silently scan until a match.

The script asserts finite ceilings of 40 native starts, 132 session content
reads, 67 tree writes and 512 MiB fresh-worker RSS, and validates every semantic
result and trace/count agreement. Those are acceptance checks for this corpus,
not a proof for every possible key, contention schedule or payload size.

## Memory and disk are separate measurements

| Existing settled records | SHA-1 fresh Node peak RSS range | SHA-256 fresh Node peak RSS range |
| ---: | ---: | ---: |
| 1 | 73.97–76.95 MiB | 73.78–77.07 MiB |
| 17 | 73.69–76.96 MiB | 73.65–76.57 MiB |
| 129 | 73.47–76.84 MiB | 73.91–76.83 MiB |

Each entry is the range across ten separate process-lifetime kernel high-water
readings (`process.resourceUsage().maxRSS`), including imports, facade setup,
namespace open, operation and close. It excludes Git child RSS and the seeder.
There is one sample per operation/size/format; these are not distributions or
proof of a universal constant-memory bound. Maximum-sized pages, maximum
listing output and adversarial contention are outside this measurement.

The complete guarded phase's kernel cgroup memory peak was 888,233,984 bytes.
That includes dependency installation, fixture builders, controller, Node and
Git processes, tmpfs data and the subsequent unit suite. It must not be relabeled
as one operation's RSS or a simultaneous process-only RSS sum.

Final collected stores grew from 120 to 912 KiB (SHA-1), and from 124 to 1,160 KiB
(SHA-256). These are end-of-scenario disk readings, not peaks. History consumes
storage; bounded point work is not a constant-disk claim. The full phase ended
with 119,044 KiB under its data tmpfs and 840 KiB under its home tmpfs; stopping
the reused worker cleared them. No extra worker, image or volume was created.

## Execution and limitations

Run `node scripts/diagnostics/measure-reservations.js` inside the existing
COPY-based guarded Docker worker. `--pilot` selects one seed record per format.
The script requires a physical Docker marker and has bounded process groups,
output and deadlines. Outer execution used a read-only root, 3 GiB data tmpfs,
16 MiB each for temporary/home/shared-memory filesystems, 4 CPUs, 8 GiB memory,
512 PIDs, rotated Docker logs, capped host logs, host/VM free-space monitoring,
and whole-container termination on guard failure. No host tests were run.

The first pilot passed lint and its first semantic operation but failed because
Plumbing filters ambient `GIT_TRACE2_EVENT`; no trace existed. It supplies no
measurement approval. The corrected pilot uses a temporary configuration file
through Plumbing's supported inherited `GIT_CONFIG_GLOBAL` path, without
changing workstation configuration. Its 20 measurements pass. The final
60-measurement phase passes lint and the complete Node unit suite: 2,406 passed,
three existing conditional skips. Historical failed and successful receipts are
preserved separately. The diagnostics are Node/Linux measurements, not a new
Bun/Deno performance claim.

SSJS scope: diagnostics only; runtime core and validation boundaries unchanged;
real native I/O, explicit finite inputs, no substituted persisted truth, no
exception-message-driven behavior. Existing supported-runtime, installed-package,
current-head independent-review and release gates still apply to the complete
feature. WARP may consume the API only after its dependency release is verified.
