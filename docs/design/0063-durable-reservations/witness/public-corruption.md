# Public malformed-authority acceptance

Fourteen additional native cases cover SHA-1 and SHA-256 through the public
package API. A malformed ledger header, missing header, or parented ledger
commit makes namespace open indeterminate without replacing the installed
revision, before and after close/GC/reopen. A dangling symbolic ledger refuses
without creating its target.

For prepared attempts, a missing, symbolic or malformed custody pin makes public
inspection, reconciliation and arming indeterminate. The ledger still reports
one charged prepared record; no ref changes and no fresh permission result
occur. The fixture deliberately changes raw refs to exercise detection. It does
not claim authority over arbitrary external writers or audit unvisited data.

`public-corruption-01` passes all 14 cases under Node and again under Deno, plus
lint. `public-corruption-unit-01` passes the full Node unit suite: 2,406 passed,
three existing conditional skips, plus lint. [Receipt](public-corruption.json)
binds both complete copied snapshots and raw evidence hashes. These phases add
test evidence without changing production code.

Both phases reuse the existing guarded COPY-only worker under its canonical
workstation lock, readonly root and bounded tmpfs/CPU/memory/log/deadline limits.
Workers stop after each phase. Recorded filesystem usage is final usage, not
peak residency. Native cost/peak-residency evidence, complete stable-candidate
runtime/package checks, current-head review and publication remain gates.
