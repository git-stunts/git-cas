# Retro — 0063 Durable reservation admission

PR #158 integrated at `4782052214269c72acc95f63191e89897059bb56` on 2026-11-02. Its exact head `d920ee0bec0b7c2fcf3e3dc4c47b17c0a5bf82e3` passed all five hosted validation jobs. The maintainer then explicitly instructed an admin merge after being told that independent review was unavailable. CodeRabbit skipped 109 changed files because of its 100-file cap; Agy attempts returned terminal quota errors. Neither event counts as independent approval. The merge instruction overrode that session gate, not the recorded test outcomes.

## What the implementation established

One checked ledger ref owns namespace policy, charge and attempt state. Custody refs retain original and final pages through real Git edges. Ordering those writes makes interruption recoverable without inventing multi-ref atomicity. Fresh arming is a one-time acknowledgement, and reconciliation never becomes another effect permit. Cancelled keys remain tombstones, preventing a late preparer from resurrecting an old identity after its slot is reused.

The useful proof crossed the public boundary: separate processes, actual process death, write-boundary faults, selected storage corruption, close/reopen, refusal and real Git GC. Private helper tests established narrower facts and remained separately labelled. The integrated source at `7fad342` passed Node 2,407/3 skipped and Deno 2,398/12 skipped unit cases, 351 integration cases per runtime, declaration checks and a fresh locally packed consumer. Later evidence-only changes and hosted head validation are identified in the [integrated witness](../../../design/0063-durable-reservations/witness/integrated-runtime.md).

The fixed-depth index bounded history-dependent lookup work, but native process and memory measurements still mattered. The 60-sample diagnostic found 9–33 native Git starts across its ten measured operations. Fresh Node worker peak RSS was 73.47–77.07 MiB, excluding Git children; whole-phase cgroup memory was reported separately. Those are finite observations, not maximum-page or arbitrary-history guarantees.

## Drift and remaining work

README, API, architecture and status now distinguish merged implementation from published v7.0.0 and the v7.1.0 candidate. The older status header still named v6.5.11 and has been corrected during release preparation. Historical witness bytes remain unchanged. The Deno installer repair is integrated; #161 owns the independent Bun installer follow-up.

The prior packed consumer did not retain the tarball hash. #162 therefore requires exact release artifact identities and a fresh registry consumer, in addition to full release checks. Publication and downstream WARP adoption remain unfinished. No stored format migration, byte-quota guarantee, automatic expiry or application-effect executor was added.
