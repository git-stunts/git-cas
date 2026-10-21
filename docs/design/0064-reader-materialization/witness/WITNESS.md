---
frontmatter_schema_version: 1
document_revision: 1
title: "Optional file publication and runtime JSON decoding: implementation evidence"
author: Reader librarian
created: '2026-10-21'
updated: '2026-10-21'
---

# Implementation evidence

## What passed

The native decoder lives in `RuntimeJsonCodec`, selected by the default façade
and `createJson()`. The exported portable `JsonCodec` is unchanged. Core byte
streams and buffers remain available. The new filesystem helper is imported
explicitly through `@git-stunts/git-cas/files`.

| Check | Observed result |
| --- | --- |
| ESLint over the repository | Passed |
| Full Node unit suite | 2,252 passed; 3 skipped |
| Full Node integration suite | 227 passed |
| Bun focused unit and real-Git integration | 51 passed |
| Deno focused unit and real-Git integration | 51 passed |
| Deno public declarations, existing and new fixture | Passed |
| Packaged optional subpath in isolated Node consumer | Passed |

Bun and Deno coverage here is the focused change, not their full unit or
integration suites. The logs name the tested files. `deno-check.log` contains
passing runtime tests followed by a rejected CLI flag on the first type-check
invocation; `deno-types.log` is the corrected successful type check. No test
failure is reclassified as a passing command.

`files-red.log` records the missing public subpath before implementation.
`files-green.log` records the initial 42 passing focused tests. The final
focused runtime sets contain 51 tests, including the runtime-adapter
compatibility assertion and eight real-Git cases. Tests cover plain, whole,
framed and convergent sources, wrong keys, late source failure, optional digest,
cancellation, old destination preservation, path confinement and cleanup.
The integration suite also exercises the existing manifest buffer/stream APIs.

The package smoke test creates a real tarball with `npm pack --ignore-scripts`,
extracts it into an isolated consumer with no installed project dependencies,
imports the public optional subpath and publishes a small verified file. It
checks the helper's package inclusion and runtime imports. It does not run
release stamping, publish npm artifacts or constitute release verification.

## Exact validation commands inside the reused Docker worker

```sh
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run test/unit --no-file-parallelism --no-cache
node node_modules/vitest/vitest.mjs run test/integration --no-file-parallelism --no-cache
bun node_modules/vitest/vitest.mjs run test/unit/infrastructure/codecs/JsonCodec.test.js test/unit/infrastructure/adapters/materializeFile.test.js test/unit/infrastructure/adapters/FileIOHelper.test.js test/integration/file-materialization.test.js --no-file-parallelism --no-cache
deno run -A --cached-only node_modules/vitest/vitest.mjs run test/unit/infrastructure/codecs/JsonCodec.test.js test/unit/infrastructure/adapters/materializeFile.test.js test/unit/infrastructure/adapters/FileIOHelper.test.js test/integration/file-materialization.test.js --no-file-parallelism --no-cache
deno check --config test/types/deno.json test/types/public-api-compatibility.ts test/types/file-materialization.ts
```

These are the equivalent unit/integration commands behind the repository's
Docker scripts, executed in existing images with a fresh copied source tree.
No repository/Git directory was bind-mounted, and no new image was built.
Dependencies were reused read-only. Vitest's result cache was disabled because
that dependency tree is read-only. Temporary fixture storage permits executable
stub scripts; a no-exec mount initially caused the hook tests to fall through
to real commands. Correcting that test filesystem made the existing hook tests
pass without changing the hook or weakening the physical Docker guard.

## Full retained-corpus timings

All 8,536 files, including hidden files and duplicates, were restored in each
case. Three repetitions alternate mode order. Each case checks size, SHA-256
and exact output count after timing: 102,432 file checks. Ready-pool time
includes member resolution, streaming, writes, closes and reader exit. The
second time column also includes reader startup. Neither includes final
verification/deletion, outer launcher imports or fsync.

| Mode | Median seconds | Including reader startup |
| --- | ---: | ---: |
| Byte-stream path with ordinary output writes | 2.460 | 2.620 |
| Optional sibling-file publication | 3.295 | 3.453 |
| Optional publication plus plaintext SHA-256 | 3.316 | 3.479 |
| Native Git archive/extraction | 1.490 | 1.490 |

CAS cases use 18 reader processes with two files in flight each; the allowance
is 18 CPUs. Git uses its archive/extraction pipeline. Both read committed
objects and write fresh files on the same host bind mount. The raw comparator
also materializes output; these are not in-memory-only timings. The extra
publication cost is explicit, and callers retain the lower-level byte path.

The corpus is private and is not redistributed here. These are local,
cache-influenced observations on a shared Mac/Docker host, not a latency
promise, a cold-storage benchmark, a release claim, or proof of the speed
ceiling. The previous 2.75-second experimental full-corpus result had one
trial; differences from that figure cannot all be attributed to code changes.
The final runtime-adapter implementation is tested here in three repetitions.

## Resource and custody boundary

The same `git-cas-reader-study` worker and existing Node/Bun/Deno images were
reused serially under `host/docker/git-cas-reader-study/` in the workstation
Git-locks store. Runs use read-only roots, no network, bounded temporary mounts,
bounded Docker logs, fail-closed data/free-space monitoring and a 15-minute
per-phase deadline. Failure/timeout stops the owned container and descendants.
The shared runtime-data accounting stays below 4 GiB, including the intentionally
retained study and Reader scratch data, generated output, and temporary-mount
reserves. No generated build cache or new image was created.

All eleven prior experimental Git repositories remain intact. All workers
were stopped after each phase; original two-CPU/3-GiB/PID-256 settings were
restored. The Node worker/image remains reusable. The raw aggregate resource
receipts are in `resource-status.json`. Private keys are not included here.

## Remaining boundaries

Atomic visibility is separate from durable flush. Sources retain their existing
authentication and buffering behavior. Trusted local directories, caller-owned
cache quotas, last-rename-wins concurrency and crash orphan cleanup are explicit
in the API reference. This is local implementation evidence, not a GitHub PR,
review, merge, release or Reader migration.
