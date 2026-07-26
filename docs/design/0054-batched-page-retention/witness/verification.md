# PERF-0054 verification

Date: 2026-07-26

Issue: https://github.com/git-stunts/git-cas/issues/99

## Playback answers

### Does one page batch install one exact workspace generation?

Yes. Unit coverage observes one `updateRef()` call for a three-input batch,
including duplicate content. All ordered results carry retained witnesses for
the same generation. The Git-backed integration confirms every page remains
reachable through that generation across immediate prune and becomes
unreachable after exact workspace release.

### Does batching remove the measured scale failure?

Yes. A disposable bare repository staged 8,188 deterministic tiny pages in 32
bounded batches of at most 256 pages:

```json
{
  "pageCount": 8188,
  "batches": 32,
  "elapsedMs": 15546,
  "generationMatchesHead": true,
  "reachableEntries": 8190,
  "looseObjectCount": 128,
  "looseObjectSize": "8.27 MiB",
  "packedObjectCount": 8188,
  "packCount": 32,
  "garbage": 0
}
```

The pre-change git-warp rehearsal retained only 5,213 of the same 8,188-page
cardinality after 75 minutes and had produced about 1.16 GiB of loose scratch
objects. The witness uses synthetic tiny pages and contains no Think data.

## Commands

```text
pnpm vitest run test/unit/domain/services/StagingWorkspace.test.js
  22 passed

docker compose run --build --rm test-node \
  npx vitest run test/integration/staging-workspace.test.js \
  --no-file-parallelism
  7 passed

pnpm lint
  passed

pnpm test
  2,085 passed, 2 skipped
```

The final `release:verify -- --skip-jsr` run passed all 13 executed gates:
6,841 tests across Node, Bun, and Deno unit/integration suites, public type
compatibility, examples, lint, build stamping, and the npm pack dry-run.
