# Persistent Git Object Sessions Verification Witness

Generated: 2026-07-19 03:46:01 PDT

Issue: [#90](https://github.com/git-stunts/git-cas/issues/90)

Implementation commit: `27831926327afc7522b39ab435d29b46b7ac428e`

Compatibility repair commit: `a2ce917fb629f63db643de7cf72035386f48345e`

Session recovery repair commit: `76e0cf57dfe8a1d0a0af49fb1c8a5ef1915fafb5`

Session retirement repair commit: `6f29be5a8637b6010ca9497924695ec49c28d1f8`

## Contract

`GitPersistenceAdapter` feature-detects typed plumbing sessions, keeps metadata
and parsed tree residency bounded, and preserves command-per-operation fallback
for injected plumbing implementations without those capabilities.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#41-81@27831926327afc7522b39ab435d29b46b7ac428e`]

The session pool lazily coalesces one process per protocol, invalidates only the
exact poisoned session generation, retries one typed protocol failure through
a fresh process, retires idle sessions, and aggregates explicit close failures.
A late failure from an old process cannot evict its replacement. Graceful close
or retirement failure force-terminates the affected process before surfacing.

[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#16-59@27831926327afc7522b39ab435d29b46b7ac428e`]
[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#62-145@27831926327afc7522b39ab435d29b46b7ac428e`]
[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#196-226@27831926327afc7522b39ab435d29b46b7ac428e`]
[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#69-153@76e0cf57dfe8a1d0a0af49fb1c8a5ef1915fafb5`]
[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#89-113@6f29be5a8637b6010ca9497924695ec49c28d1f8`]

The low-level persistence-port declarations keep batch write and lifecycle
capabilities optional for existing structural adapters. The concrete Git
adapter and root facade expose them as required capabilities.

[cite: `index.d.ts#513-581@a2ce917fb629f63db643de7cf72035386f48345e`]

A Deno type-check fixture assigns a legacy structural persistence adapter that
does not implement any new optional capability, proving patch-release source
compatibility.

[cite: `test/types/public-api-compatibility.ts#1-47@a2ce917fb629f63db643de7cf72035386f48345e`]

Raw Git tree decoding supports SHA-1 and SHA-256 object identifiers, validates
modes and names, freezes decoded entries, and computes an estimated residency
weight for the byte-bounded cache.

[cite: `src/infrastructure/codecs/GitTreeObjectCodec.js#15-61@27831926327afc7522b39ab435d29b46b7ac428e`]

## Write Correctness Boundary

Individual `writeBlob()` calls remain one-shot `hash-object` operations.
Bounded `writeBlobs()` calls materialize their iterable once, write through one
scoped fast-import process, checkpoint it, and retire it before exposing OIDs.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#89-134@27831926327afc7522b39ab435d29b46b7ac428e`]

The one-shot boundary is required. The real-Git regression aggressively prunes
an individually written unreachable blob, proves the object is absent, writes
the same bytes again, and proves the same OID exists and remains readable.

[cite: `test/integration/bundle-reference-performance.test.js#242-269@27831926327afc7522b39ab435d29b46b7ac428e`]

`pages.putBatch()` validates page count and aggregate bytes, collects the whole
explicitly bounded batch before persistence starts, and preserves input order
in its immutable staged results.

[cite: `src/domain/services/PageService.js#69-118@27831926327afc7522b39ab435d29b46b7ac428e`]

## Lifecycle

Every adapter operation registers before asynchronous work starts. `close()`
blocks new operations, drains started commands, destroys abandoned Git output
streams, waits for the corresponding processes, closes typed sessions, and
releases bounded cache residency.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#497-552@27831926327afc7522b39ab435d29b46b7ac428e`]
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#642-671@27831926327afc7522b39ab435d29b46b7ac428e`]

Unit tests prove idempotent closure, post-close rejection, active one-shot
draining, abandoned-stream destruction, and idle retirement when explicit
close is omitted. Concurrency coverage proves that a late old-session failure
cannot invalidate its replacement. Shutdown coverage proves that graceful
close and scoped retirement failures force termination before rejection.

[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#315-354@27831926327afc7522b39ab435d29b46b7ac428e`]
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#357-437@27831926327afc7522b39ab435d29b46b7ac428e`]
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#121-148@76e0cf57dfe8a1d0a0af49fb1c8a5ef1915fafb5`]
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#447-463@76e0cf57dfe8a1d0a0af49fb1c8a5ef1915fafb5`]
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#261-305@6f29be5a8637b6010ca9497924695ec49c28d1f8`]

## Stable Performance Gates

The real-Git integration test requires the session path to return the same
selected reference while opening exactly one cat-file session and fewer total
Git processes than fallback. A separate gate requires batch and individual page
writes to return the same ordered handles while batch opens exactly one
fast-import session and fewer total processes.

[cite: `test/integration/bundle-reference-performance.test.js#190-239@27831926327afc7522b39ab435d29b46b7ac428e`]

## Verification Results

| Command                                           | Result                                 |
| ------------------------------------------------- | -------------------------------------- |
| Focused lifecycle, session, codec, and page units | 4 files; 50 tests passed               |
| `pnpm test`                                       | 223 files; 2,070 passed, 2 skipped     |
| `pnpm test:integration:node`                      | 12 files; 196 tests passed in Docker   |
| `bats test/platform/runtimes.bats`                | Node, Bun, and Deno full suites passed |
| Deno public type compatibility check              | Passed with legacy structural adapter  |
| `pnpm lint`                                       | Passed                                 |
| `git diff --check`                                | Passed                                 |

The direct host `pnpm test:integration` invocation was intentionally rejected
by all 12 integration files because this repository requires
`GIT_STUNTS_DOCKER=1`. The required Docker invocation above passed; no host
result is counted as integration evidence.

## Measurement Method

The committed diagnostic creates isolated repositories and forked workers,
alternates comparison order across three samples, verifies equal semantic
digests, counts every one-shot command and typed session opening, and reports
median wall time, process CPU, and peak RSS.

```sh
docker compose run --build --rm test-node \
  node scripts/diagnostics/measure-git-object-sessions.js 32 4096 3
```

The environment was Linux arm64 with Node `v22.23.1` and Git `2.43.0`. The raw
machine-readable result is
[`git-object-sessions.json`](./git-object-sessions.json).

## Measurement Results

| Path                            | Baseline processes | Candidate processes | Process reduction | Baseline wall | Candidate wall | Observed wall reduction |
| ------------------------------- | -----------------: | ------------------: | ----------------: | ------------: | -------------: | ----------------------: |
| Selected bundle reference reads |                225 |                   1 |             99.6% |    343.911 ms |      54.038 ms |                   84.3% |
| Bounded page writes             |                 32 |                   1 |             96.9% |     76.503 ms |      35.000 ms |                   54.3% |

Selected reads had equal semantic digests and returned 32 results in both
modes. The session path opened one cat-file process; fallback opened 64
batch-check, 128 ls-tree, and 33 cat-file processes. Median process CPU fell
from 277.441 ms to 61.958 ms. Peak RSS was 79,433,728 bytes for fallback and
73,871,360 bytes for the session path.

Page writes had equal semantic digests and returned 32 handles in both modes.
Individual writes opened 32 hash-object processes; the batch opened one scoped
fast-import process. Median process CPU fell from 71.906 ms to 19.785 ms. Peak
RSS was 73,334,784 bytes for individual writes and 72,331,264 bytes for batch.

Timing and RSS are environment observations, not portable guarantees. Semantic
digest equality and process counts are the stable regression contracts.

## Residual Scope

This witness does not prove graph-wide memory boundedness, git-warp application
latency, or elimination of all subprocess cost. Payload streams remain
one-shot and streaming by design. Git-warp must adopt the published git-cas
release, hold cache acquisitions at the correct runtime lifetime, and prove its
own large-graph memory and latency benchmarks before the v19 performance
campaign can close.
