# Persistent Git Object Sessions Verification Witness

Generated: 2026-07-19 04:50:45 PDT

Issue: [#90](https://github.com/git-stunts/git-cas/issues/90)

Implementation commit: `27831926327afc7522b39ab435d29b46b7ac428e`

Final reviewed source commit: `efce7879348072a25759996dd159e35b638c4035`

Reviewed feature merge: `4ce37adc57d49d2633507c3fbdc46e98617b26d6`

## Contract

`GitPersistenceAdapter` feature-detects typed plumbing sessions, keeps metadata
and parsed tree residency bounded, and preserves command-per-operation fallback
for injected plumbing implementations without session capabilities.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#41-86@1819d8572707d8846ffa7ace9847f490cdb6438b`]

The session pool owns at most one live process per protocol during normal
operation. Opening is coalesced, and new sessions wait for explicit retirement,
idle retirement, or invalidation to finish. One typed protocol failure receives
one retry only after teardown succeeds. A late failure from an old generation
cannot evict its replacement.

[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#17-117@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#153-225@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#244-316@1819d8572707d8846ffa7ace9847f490cdb6438b`]

Graceful retirement failures force termination before surfacing. If an
operation and teardown both fail, both causes survive in an `AggregateError`;
the pool does not open a speculative replacement after failed teardown.

[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#163-180@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `src/infrastructure/adapters/GitObjectSessionPool.js#233-251@1819d8572707d8846ffa7ace9847f490cdb6438b`]

Low-level persistence-port declarations keep batch write and lifecycle
capabilities optional for existing structural adapters. The concrete Git
adapter and root facade expose deterministic close and async disposal.

[cite: `index.d.ts#513-581@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `index.d.ts#1723-1742@1819d8572707d8846ffa7ace9847f490cdb6438b`]

A Deno type-check fixture assigns a legacy structural persistence adapter that
does not implement any new optional capability, proving source compatibility.

[cite: `test/types/public-api-compatibility.ts#10-47@1819d8572707d8846ffa7ace9847f490cdb6438b`]

Raw Git tree decoding supports SHA-1 and SHA-256 object identifiers, validates
modes and names, freezes decoded entries, and computes an estimated residency
weight for the byte-bounded cache.

[cite: `src/infrastructure/codecs/GitTreeObjectCodec.js#21-92@1819d8572707d8846ffa7ace9847f490cdb6438b`]

## Write Correctness Boundary

Individual `writeBlob()` calls remain one-shot `hash-object` operations.
Bounded `writeBlobs()` calls materialize their iterable once, write through one
scoped `fast-import` process, checkpoint it, retire dependent readers, and
close it before exposing OIDs. Multiple retirement failures are preserved.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#89-158@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#545-570@1819d8572707d8846ffa7ace9847f490cdb6438b`]

The one-shot boundary is required. The real-Git regression aggressively prunes
an individually written unreachable blob, proves the object is absent, writes
the same bytes again, and proves the same OID exists and remains readable.

[cite: `test/integration/bundle-reference-performance.test.js#242-269@1819d8572707d8846ffa7ace9847f490cdb6438b`]

`pages.putBatch()` enforces page-count, per-page, and aggregate-byte bounds
while consuming each source. It stops an overflowing stream at the first chunk
that proves the bound, performs no persistence before the full bounded batch is
valid, and preserves input order in immutable staged results.

[cite: `src/domain/services/PageService.js#78-127@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `src/domain/services/PageService.js#236-264@1819d8572707d8846ffa7ace9847f490cdb6438b`]

## Lifecycle

Every adapter operation registers before asynchronous work starts. `close()`
blocks new work, drains started commands, destroys abandoned output streams,
waits for the corresponding Git children even when destruction fails, closes
typed sessions, and releases bounded cache residency. The fallback tree-write
path also retires a persistent reader after object-database mutation.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#160-180@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#499-558@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#649-694@1819d8572707d8846ffa7ace9847f490cdb6438b`]

Concurrency tests prove invalidation and explicit retirement barriers prevent a
replacement process from opening before the old process terminates. Failure
tests preserve operation, cache-retirement, bulk-retirement, and stream-cleanup
causes. Idle retirement is awaited by explicit close and its failures remain
visible after forced termination.

[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#151-203@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#356-445@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#597-767@1819d8572707d8846ffa7ace9847f490cdb6438b`]

The root facade closes lazily and idempotently without initializing an unused
store. Closing releases local resources only; stored objects, refs, retention,
and publication state remain unchanged.

[cite: `index.js#620-645@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `test/unit/facade/ContentAddressableStore.lifecycle.test.js#1-33@1819d8572707d8846ffa7ace9847f490cdb6438b`]

## Stable Performance Gates

The real-Git integration gate requires the persistent path to return the same
selected reference while opening exactly one `cat-file` session and fewer
total Git processes than fallback. A separate gate requires batch and
individual page writes to return the same ordered handles while batch opens
exactly one `fast-import` session and fewer total processes.

[cite: `test/integration/bundle-reference-performance.test.js#190-239@1819d8572707d8846ffa7ace9847f490cdb6438b`]

## Verification Results

| Command                                           | Result                                 |
| ------------------------------------------------- | -------------------------------------- |
| Focused lifecycle, session, codec, and page units | 4 files; 59 tests passed               |
| `pnpm test`                                       | 223 files; 2,079 passed, 2 skipped     |
| `pnpm test:integration:node`                      | 12 files; 196 tests passed in Docker   |
| `bats test/platform/runtimes.bats`                | Node, Bun, and Deno full suites passed |
| Deno public type compatibility check              | Passed with legacy structural adapter  |
| `pnpm lint`                                       | Passed                                 |
| `git diff --check`                                | Passed                                 |

All integration evidence came from the required Docker environment. Host-only
integration runs are not counted.

## Measurement Method

The committed diagnostic creates isolated repositories and forked workers,
alternates comparison order across three samples, verifies equal semantic
digests, and counts every one-shot command and typed session opening.

[cite: `scripts/diagnostics/measure-git-object-sessions.js#27-105@1819d8572707d8846ffa7ace9847f490cdb6438b`]
[cite: `scripts/diagnostics/measure-git-object-sessions.js#136-267@1819d8572707d8846ffa7ace9847f490cdb6438b`]

```sh
docker compose run --build --rm test-node \
  node scripts/diagnostics/measure-git-object-sessions.js 32 4096 3
```

The environment was Linux arm64 with Node `v22.23.1` and Git `2.43.0`. The raw
machine-readable result is
[`git-object-sessions.json`](./git-object-sessions.json).

Wall time includes awaited Git subprocesses. CPU and peak-RSS fields are
explicitly named `workerCpuMs` and `workerPeakRssBytes`: they measure the Node
worker only and exclude Git child CPU and RSS. They are diagnostic observations,
not end-to-end resource claims.

## Measurement Results

| Path                            | Baseline processes | Candidate processes | Process reduction | Baseline wall | Candidate wall | Observed wall reduction |
| ------------------------------- | -----------------: | ------------------: | ----------------: | ------------: | -------------: | ----------------------: |
| Selected bundle reference reads |                225 |                   1 |             99.6% |    288.647 ms |      50.366 ms |                   82.6% |
| Bounded page writes             |                 32 |                   1 |             96.9% |     68.658 ms |      33.490 ms |                   51.2% |

Selected reads had equal semantic digests and returned 32 results in both
modes. The session path opened one `cat-file` process; fallback opened 64
batch-check, 128 `ls-tree`, and 33 `cat-file` processes. Node-worker CPU was
234.386 ms for fallback and 59.110 ms for sessions. Node-worker peak RSS was
79,306,752 bytes and 74,203,136 bytes, respectively.

Page writes had equal semantic digests and returned 32 handles in both modes.
Individual writes opened 32 `hash-object` processes; the batch opened one
scoped `fast-import` process. Node-worker CPU was 64.342 ms for individual
writes and 18.473 ms for batch. Node-worker peak RSS was 73,883,648 bytes and
72,445,952 bytes, respectively.

Semantic digest equality and process counts are stable regression contracts.
Timing and worker-resource observations are environment-specific evidence.

## Residual Scope

This witness does not prove graph-wide memory boundedness, end-to-end
process-tree CPU, git-warp application latency, or elimination of every
subprocess. Payload streams remain one-shot and streaming by design. Git-warp
must adopt the published git-cas release, hold cache acquisitions at the
correct runtime lifetime, and pass its own large-graph memory, process-tree CPU,
and latency gates before the v19 performance campaign can close.
