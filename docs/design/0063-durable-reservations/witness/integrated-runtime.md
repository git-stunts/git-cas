# Integrated reservation runtime and package checkpoint

The reservation branch includes merged installer repair #160 through normal
merge `55fac001ab48d212d68967e03fab1734677a734c`. Its only conflicts were
`CHANGELOG.md` and the design index; both branches' entries were preserved.
Commit `7fad342` adds the required installer retrospective and drift check.

The exact committed `7fad342` snapshot then passed this finite COPY-only Docker
phase, using the existing frozen pnpm graph and explicit Deno manual mode:

| Check | Passed | Existing conditional skips |
| --- | ---: | ---: |
| Node unit | 2,407 | 3 |
| Node integration | 351 | 0 |
| Deno unit | 2,398 | 12 |
| Deno integration | 351 | 0 |

Lint and both public declaration fixtures pass. A fresh `npm pack` candidate
was installed in a separate consumer directory. Its exported facade passes
reserve/prepare/arm/reconcile/settle, refusal of a second arm, close/GC/reopen,
exact original/final page reads, capacity refusal and listing in SHA-1 and
SHA-256. See `test/fixtures/reservation-package-consumer.js`.

[Machine receipt](integrated-runtime.json) binds the complete copied source,
runner, phase command and original output. The source had no uncommitted delta.
The candidate still uses package version 7.0.0; it was installed from a local
packed tarball, not downloaded as a published reservation release. No tarball
hash was captured in this phase, so this is execution/source evidence, not an
identity receipt for a retained release artifact. Release publication must
capture and verify its own exact artifacts and fresh registry consumer.

No Bun process ran in this local phase. The preceding `6755a53` hosted matrix
passed Node, Bun and Deno; fresh current-head hosted checks remain a gate after
integration. The source implementation of reservations was unchanged by the
installer merge. The earlier native cost corpus remains its own measured
snapshot, rather than being relabelled as a rerun on this head.

The guarded phase reuses the existing bounded worker, holds its canonical
workstation lock, and stops the whole container after completion. Build/test
outputs remain within the same hard tmpfs and monitored log budgets. End disk
usage and whole-phase cgroup peak are recorded separately in the receipt; they
are not operation memory measurements. No new worker, image or volume was made.

This closes another acceptance checkpoint, not #157 or the v7.1.0 release.
Current-head independent review, complete release verification, publication and
fresh downstream registry adoption still apply.
