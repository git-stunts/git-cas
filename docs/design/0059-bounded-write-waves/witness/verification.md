# Bounded Write-Wave Verification

Status: implementation-complete local evidence and current-dependency runtime
matrices; dependency publication and pinning, released-dependency verification,
downstream git-warp adoption, review, and release remain open.

## Exact Inputs

| Input                                  | Exact source                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| git-cas implementation and public docs | `59c9d1a00ccb5be3de974c8c23c825cbe43ac666`                                             |
| canonical default-concurrency witness  | [`bounded-write-waves.json`](./bounded-write-waves.json)                               |
| caller-tuned concurrency witness       | [`bounded-write-waves-concurrency-16.json`](./bounded-write-waves-concurrency-16.json) |
| Plumbing implementation                | `eee0dfd8d42ccd635b7027d2921b34ece8901455` from `plumbing#16`                          |
| object formats                         | SHA-1 and SHA-256 temporary bare repositories                                          |
| host                                   | Node v26.0.0, Git 2.50.1 (Apple Git-155), macOS arm64                                  |

Both committed measurements report `gitCasDirty: false` and
`plumbingDirty: false`. They identify Plumbing as a workspace source without
recording a machine-local path. The canonical run used 16 items, five
counterbalanced samples, four active asset pipelines, 2 KiB assets split into
1 KiB chunks, and three inline members per bundle. Medians are reported for
wall time, worker CPU, and worker peak RSS; process and protocol topology had to
match across every sample.

The canonical git-cas commit includes the implementation, real-Git prune
regression, cooperative source-cancellation behavior, and failure calibrations.
It predates only this refreshed readable evidence.

## Semantic Gate

The comparison digest is the SHA-256 digest of the complete input-ordered
handle array returned by each scenario. Individual and batch modes produced
the same digest in every sample:

| Format  | Asset digest                                                       | Workspace-bundle digest                                            |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| SHA-1   | `bb4a4204b9fc1e1639e03414682f5d87c36444f3ad9ae11148a0f59602e79f79` | `dc75736f497fc932d846dc368a0ee59ab9439e258e79abc3c86dcbf84dfa266a` |
| SHA-256 | `1c302cde909ad0d44f3c757ec0532c2d9d6e52133c3d2c553e65273670ceee4f` | `5261e344aeacebd73f2b6b51abb94e4400244e49098fc58da06b433d33909d65` |

For content-addressed handles, equality covers the complete canonical bundle
or asset root identity. Unit calibration separately compares batch and single
bundle metadata and exercises a mixed flat/Merkle asset group. Reversing an
OID mapping, changing descriptor bytes, or splitting the final manifest-tree
wave makes those tests fail.

[cite: `test/unit/domain/services/AssetService.batch.test.js#108-146@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
[cite: `test/unit/domain/services/BundleService.batch.test.js#58-87@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]

## Canonical Measurement

The deterministic gates are process count, typed interaction count, topology,
and semantic identity. Wall time and worker CPU are supporting measurements,
not universal speed promises.

| Format / operation                    | Git children | Git interactions |  Median wall | Worker CPU | Semantic digest |
| ------------------------------------- | -----------: | ---------------: | -----------: | ---------: | --------------- |
| SHA-1 assets, individual              |           49 |               64 |   997.094 ms | 112.897 ms | baseline        |
| SHA-1 assets, batch                   |            2 |               19 |   126.157 ms |  47.316 ms | equal           |
| SHA-256 assets, individual            |           49 |               64 |   903.447 ms | 110.638 ms | baseline        |
| SHA-256 assets, batch                 |            2 |               19 |   121.215 ms |  44.957 ms | equal           |
| SHA-1 workspace bundles, individual   |          147 |              224 | 2,896.449 ms | 266.952 ms | baseline        |
| SHA-1 workspace bundles, batch        |            8 |               13 |   262.229 ms |  59.232 ms | equal           |
| SHA-256 workspace bundles, individual |          147 |              224 | 2,789.445 ms | 263.362 ms | baseline        |
| SHA-256 workspace bundles, batch      |            8 |               13 |   254.603 ms |  58.755 ms | equal           |

This is a 95.918% child-process reduction for assets and 94.558% for workspace
bundles in both formats. Median wall time fell 86.583-87.348% for assets and
90.873-90.947% for workspace bundles. Node-worker CPU fell 58.089-59.366% and
77.690-77.812% respectively. Worker peak RSS stayed within the same narrow
process high-water band for asset batches and fell by roughly 4-4.5 MiB for bundle
batches; it does not include child-process RSS and is not a heap-residency
proof.

## Caller-Selected Asset Concurrency

The second clean five-sample run changes only `maxBatchAssets` from the default
four to 16:

| Format  | Active assets | Git children | Git interactions | Median wall | Worker CPU | Worker peak RSS |
| ------- | ------------: | -----------: | ---------------: | ----------: | ---------: | --------------: |
| SHA-1   |             4 |            2 |               19 |  126.157 ms |  47.316 ms |    80,953,344 B |
| SHA-1   |            16 |            2 |                7 |   98.218 ms |  43.084 ms |    81,051,648 B |
| SHA-256 |             4 |            2 |               19 |  121.215 ms |  44.957 ms |    80,986,112 B |
| SHA-256 |            16 |            2 |                7 |   99.558 ms |  42.070 ms |    81,199,104 B |

Sixteen active pipelines reduced typed interactions by 63.158%, trimmed a
further 17.867-22.146% from median batch wall time, and reduced worker CPU by
6.422-8.944% on this fixture. The worker RSS high-water rose only 0.121-0.263%
here, but that does not justify silently
multiplying arbitrary caller stream residency. Four remains the conservative
default; callers that own the source-memory budget may opt into a higher value.

## What Changed

- Asset batches run a bounded number of store pipelines, then emit flat and
  Merkle manifest blobs in dependency phases and every complete manifest tree
  in one final `writeTrees()` wave.
  [cite: `src/domain/services/AssetService.js#42-85@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
  [cite: `src/domain/services/ManifestRepository.js#73-95@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- Bundle batches admit one explicit array, share inline-page and handle
  validation, preplan deterministic descriptors, write descriptor blobs
  together, and write tree depths bottom-up.
  [cite: `src/domain/services/BundleService.js#101-124@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
  [cite: `src/domain/services/BundleService.js#375-427@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- Workspace batch mirrors retain all results through one exact RootSet
  installation and use construction-owned target evidence to avoid rereading a
  graph that the same operation just produced.
  [cite: `src/domain/services/StagingWorkspace.js#59-77@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
  [cite: `src/domain/services/StagingWorkspace.js#216-282@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- Exact RootSet replacement skips the old-generation read and delegates the
  authority decision to the checked, no-dereference ref write.
  [cite: `src/domain/services/RootSet.js#111-133@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- One operation-owned fast-import process survives dependent blob phases. A
  blob above 64 MiB deliberately bypasses it and uses the real one-shot writer.
  [cite: `src/infrastructure/adapters/GitPersistenceWriteScope.js#8-76@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- Successful checked ref writes reuse one typed update-ref child. A failed
  transaction is never replayed, and adapter close drains and closes the child.
  [cite: `src/infrastructure/adapters/GitUpdateRefSessionPool.js#6-96@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]

## Measured Floor

The default 16-asset batch opens exactly two Git children:

1. one fast-import session for chunk and manifest blob phases;
2. one mktree session for the final manifest-tree wave.

The trees depend on manifest blob OIDs, so combining these children would mean
manually encoding Git trees or weakening object-existence checks. Neither is a
justified stock-Git optimization.

The 16-bundle workspace batch opens exactly eight children:

| Child               | Count | Why it remains                                                            |
| ------------------- | ----: | ------------------------------------------------------------------------- |
| fast-import session |     1 | Inline pages and bundle descriptor blobs                                  |
| mktree session      |     1 | Bundle depths and RootSet trees                                           |
| hash-object         |     2 | Workspace lease descriptor, then RootSet metadata that depends on its OID |
| cat-file session    |     1 | Batched direct target-type assertion                                      |
| commit-tree         |     1 | Git-authored parentless RootSet generation                                |
| symbolic-ref        |     1 | Direct-ref containment preflight                                          |
| update-ref session  |     1 | Checked no-dereference publication                                        |

The two sequential loose blobs cannot be submitted together without deriving a
Git object ID outside Git or introducing a cross-layer preplanning contract.
Keeping fast-import alive across the intervening tree phase would also require
retiring and reopening mktree after the new pack. The theoretical gain is one
child, while the change would broaden object-format authority and operation
lifetime substantially.

Git 2.50.1's newer `symref-verify` protocol does not remove the preflight: Git
rejects two commands naming the same ref in one transaction, while
`update-ref --no-deref` can replace a symref whose referent has the expected
OID. The independent type probe is therefore retained. Manually encoding
commits could remove `commit-tree`, but would create a second authority for
commit identity, timestamps, timezones, and future signing behavior.

## Failure, Lifecycle, and Reachability Proof

- Exact replacement performs no old-generation read and never retries an
  ambiguous checked write.
  [cite: `test/unit/domain/services/RootSet.test.js#128-171@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- Two successful updates share one update-ref child; a failed transaction is
  discarded without replay and a later semantic operation may open a new one.
  [cite: `test/unit/infrastructure/adapters/GitRefAdapter.test.js#145-222@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- The first failed asset records its input index and bounded staging evidence,
  closes sibling iterators at their next chunk boundary, and never starts a
  later queued source.
  [cite: `test/unit/domain/services/AssetService.batch.test.js#191-239@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- Wrong write-wave cardinality rejects every waiter with one poisoned error;
  bundle tree-wave and workspace-install failures return bounded staged counts
  rather than a partial success array.
  [cite: `test/unit/domain/services/BoundedWriteWavePersistence.test.js#110-130@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
  [cite: `test/unit/domain/services/BundleService.batch.test.js#133-156@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
  [cite: `test/unit/domain/services/StagingWorkspace.bundle-batch.test.js#66-86@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- The 64 MiB + 1 byte calibration proves that an oversized write calls
  `hash-object -w --stdin` and never opens fast-import.
  [cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js#493-515@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]
- A real-Git Docker test stages asset and bundle batches, prunes immediately,
  reads retained content, releases the workspace, prunes again, and observes
  the released bundle roots disappear.
  [cite: `test/integration/staging-workspace.test.js#156-193@59c9d1a00ccb5be3de974c8c23c825cbe43ac666`]

## Commands Executed

```sh
npm test
npx eslint .
npx vitest run \
  test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js \
  test/unit/domain/services/BoundedWriteWavePersistence.test.js
docker compose run --build --rm test-node \
  npx vitest run test/integration/staging-workspace.test.js \
  --no-file-parallelism
npm run release:verify
GIT_CAS_PLUMBING_REPO=<clean-plumbing-16-worktree> \
GIT_CAS_BENCHMARK_OUTPUT=docs/design/0059-bounded-write-waves/witness/bounded-write-waves.json \
node scripts/diagnostics/measure-bounded-write-waves.js 16 5 4
GIT_CAS_PLUMBING_REPO=<clean-plumbing-16-worktree> \
GIT_CAS_BENCHMARK_OUTPUT=docs/design/0059-bounded-write-waves/witness/bounded-write-waves-concurrency-16.json \
node scripts/diagnostics/measure-bounded-write-waves.js 16 5 16
```

The targeted Node Docker integration passed all eight staging-workspace tests.
The complete current-dependency Node, Bun, and Deno integration matrices each
passed 203 tests. Declaration and package tests passed inside the 2,144-test
Node unit suite. The current-dependency release verifier passed all 14 steps
with 7,030 observed unit and integration tests: 2,144 Node, 2,143 Bun, 2,134
Deno, and 203 integrations on each runtime. Lint, examples, public type
compatibility, build-metadata stamping, npm package dry-run, and JSR publication
dry-run also passed. This is pre-pin validation, not a release-candidate claim;
the same verifier must run again after a released Plumbing version replaces the
published fallback dependency.

## Nonclaims

- Plumbing PR #16 is not yet merged or released.
- git-cas does not yet pin a released Plumbing version containing these typed
  batch/session capabilities.
- No git-cas PR, merge, tag, npm publication, or GitHub release is claimed.
- The downstream 641-cold / 349-incremental git-warp reference run has not yet
  been repeated with these bundle-wave APIs.
- The measurements do not prove a universal wall-clock ratio, child-process
  RSS, or safety under concurrent destructive pruning inside an object-to-ref
  publication interval.
