# Git Object Session Coherence Verification Witness

Issue: [#94](https://github.com/git-stunts/git-cas/issues/94)

Milestone: [`v6.5.3`](https://github.com/git-stunts/git-cas/milestone/13)

Implementation: `9208871802a596cbc508be725353532110d40198`

## Decision Boundary

This release makes one internal correction: immutable writes no longer retire
Git object sessions that can lawfully observe the new object. `cat-file` is
preserved across loose blob, tree, and checkpointed bulk writes. `mktree` is
preserved across loose writes and retired after a bulk write that may create a
new pack. Scoped `fast-import` still checkpoints and closes before OIDs escape.

The implementation keeps individual blob writes on one-shot `hash-object`,
retires only `mktree` after a scoped bulk write, and leaves typed and fallback
tree writes coherent with the existing reader.
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#93-175@9208871802a596cbc508be725353532110d40198`]

## Protocol Evidence

Raw protocol probes covered Git 2.50.1 and Git 2.39.5 in SHA-1 and SHA-256
repositories. The observed matrix was:

| Existing session           | Later write       | Result                     |
| -------------------------- | ----------------- | -------------------------- |
| `cat-file --batch-command` | loose blob        | preserved and readable     |
| `cat-file --batch-command` | loose tree        | preserved and readable     |
| `cat-file --batch-command` | checkpointed pack | preserved and readable     |
| `mktree --batch -z`        | loose blob        | preserved and writable     |
| `mktree --batch -z`        | checkpointed pack | stale; retirement required |

The committed real-Git test forces two 128-object packs above
`fastimport.unpackLimit`, opens the reader and tree writer before subsequent
writes, reads later blobs and trees, and asserts one reader but two `mktree`
sessions in both object formats.
[cite: `test/integration/git-object-session-coherence.test.js#24-60@9208871802a596cbc508be725353532110d40198`]

The unit matrix separately fixes the retirement policy as a direct contract:
loose writes preserve both persistent protocols; bulk writes preserve the
reader, retire `mktree`, and close `fast-import`.
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessionCoherence.test.js#6-45@9208871802a596cbc508be725353532110d40198`]

## Verification Results

| Gate                           | Result                                   |
| ------------------------------ | ---------------------------------------- |
| `pnpm lint`                    | PASS                                     |
| Node unit                      | PASS - 2,081 tests, 2 skipped            |
| Bun unit                       | PASS - 2,080 tests, 3 skipped            |
| Deno unit                      | PASS - 2,071 tests, 12 skipped           |
| Node integration               | PASS - 198 tests                         |
| Bun integration                | PASS - 198 tests                         |
| Deno integration               | PASS - 198 tests                         |
| Public Deno type compatibility | PASS                                     |
| Three executable examples      | PASS                                     |
| npm pack dry-run               | PASS                                     |
| JSR publish dry-run            | PASS                                     |
| `pnpm release:verify`          | PASS - 14/14 steps, 6,826 observed tests |
| Bats platform cases, serial    | PASS - 3/3 runtimes                      |
| Prettier check                 | PASS                                     |
| `git diff --check`             | PASS                                     |
| Graft exported API review      | PASS - semver impact `none`              |

`pnpm test:platforms` did not execute tests on this macOS host because Bats
resolved Homebrew `moreutils`' incompatible `parallel` executable. Running the
same `test/platform/runtimes.bats` cases serially passed Node, Bun, and Deno.
This is recorded as a harness limitation, not represented as a passing parallel
command.

Lifecycle and error-path coverage still proves independent retirement barriers,
combined `mktree`/`fast-import` close failures, idempotent adapter close, and
reader shutdown at the explicit lifecycle boundary.
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#358-550@9208871802a596cbc508be725353532110d40198`]

## Consumer A/B

A temporary 128-node retained-materialization diagnostic in git-warp compared
released git-cas 6.5.2 with the implementation commit:

| Metric                           |   6.5.2 | Candidate |  Delta |
| -------------------------------- | ------: | --------: | -----: |
| Git child processes              |     558 |       401 | -28.1% |
| `cat-file` processes             |      80 |         4 | -95.0% |
| `mktree` processes               |      82 |         1 | -98.8% |
| Median materialization test time | 14.24 s |   12.72 s | -10.7% |
| Median process CPU               | 15.74 s |   13.83 s | -12.1% |
| Median wall time                 | 17.39 s |   16.93 s |  -2.6% |

The process topology is the high-confidence result. Timing values are local
three-run medians and are not a cross-platform performance promise. The
consumer fixture was temporary, so these values remain exploratory; the
committed real-Git session-count test is the durable regression gate. Full
machine-readable values and caveats are in
[`measurements.json`](./measurements.json).

## Residual Scope

This release does not persist `fast-import`, replace one-shot `hash-object`,
coalesce git-warp RootSet generations, change refs or retention, or promise
coherence across arbitrary external Git maintenance. Those costs and contracts
remain separate work.
