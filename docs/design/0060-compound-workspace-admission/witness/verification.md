# Compound Workspace Admission Verification

## Exact Source and Environment

- git-cas commit: `2a1b1eb177ba5dddd6c7c9e29044317a7384cd75`
- git-cas worktree: clean (`gitCasDirty: false`)
- installed Plumbing: `@git-stunts/plumbing@3.3.0`
- Node.js: `v26.0.0`
- Git: `2.50.1 (Apple Git-155)`
- host: macOS arm64
- witness: [`compound-workspace-admission.json`](./compound-workspace-admission.json)

The benchmark was run from the exact implementation and benchmark-harness
commit. The JSON witness was written outside the repository, so its clean-tree
claim does not exclude an in-progress output file.

## Command

```bash
GIT_CAS_BENCHMARK_OUTPUT=/tmp/git-cas-compound-workspace-admission-clean.json \
  node scripts/diagnostics/measure-bounded-write-waves.js 16 5 4
```

Each mode ran five isolated worker samples. Mode order alternated by sample.
Every worker created a fresh bare repository, performed only the measured
operation, closed git-cas and its Git sessions, and was then discarded. The
reported wall and Node-worker CPU values are medians. Worker CPU excludes Git
subprocess CPU.

## Workload

The compound scenario constructs the same deterministic graph in both modes:

- 16 page groups;
- four 64-byte pages per group, for 64 pages total;
- one dependent bundle per page group, for 16 leaf bundles;
- one root bundle over the 16 leaves;
- 81 returned application handles;
- 33 ordered write operations: 16 page waves, 16 leaf waves, and one root wave.

The `perWave` mode invokes the existing independently retained workspace batch
methods 33 times. The `compound` mode invokes the same bounded page and bundle
services inside one `workspace.batch()` admission and installs one exact final
workspace generation.

## Results

| Object format | Mode     | Git children | Git interactions | Wall ms | Worker CPU ms |
| ------------- | -------- | -----------: | ---------------: | ------: | ------------: |
| SHA-1         | per-wave |          200 |              380 | 3763.82 |       370.336 |
| SHA-1         | compound |           23 |              238 | 733.116 |       113.672 |
| SHA-256       | per-wave |          200 |              380 | 3709.93 |       373.898 |
| SHA-256       | compound |           23 |              238 | 726.976 |       114.407 |

| Object format | Process reduction | Interaction reduction | Wall reduction | Worker CPU reduction |
| ------------- | ----------------: | --------------------: | -------------: | -------------------: |
| SHA-1         |             88.5% |               37.368% |        80.522% |              69.306% |
| SHA-256       |             88.5% |               37.368% |        80.405% |              69.402% |

The semantic digests were equal within each object format:

- SHA-1: `191507709b1c0ec4027e14d87d7a6096c3dc900a4d1ab7c3b9a253729124c544`
- SHA-256: `f544138550771bb30f3340098d4913e1731807aa6a988e7906e1a1df56f5b785`

The digest covers every returned handle in construction order. Equality proves
that the batching change did not change page or bundle identity.

## Child-Process Census

Both object formats produced the same process topology:

| Process/session      | Per-wave | Compound |
| -------------------- | -------: | -------: |
| `fast-import`        |       33 |        1 |
| `hash-object`        |       66 |        0 |
| `cat-file`           |        1 |        1 |
| `mktree`             |       33 |       18 |
| `commit-tree`        |       33 |        1 |
| `symbolic-ref`       |       33 |        1 |
| `update-ref --stdin` |        1 |        1 |

The single update-ref session performs 33 checked updates in per-wave mode and
one checked update in compound mode. Compound admission also keeps one scoped
fast-import process for every blob phase and writes the final workspace lease
blob through that same scope.

The remaining 18 `mktree` processes are not repeated workspace publications.
They arise where interdependent descriptor packs must become visible before
the next Git tree wave. Removing them would require a safe typed tree-writing
protocol or equivalent deterministic object construction; it is a separate
optimization target and must preserve SHA-1/SHA-256 identity and Git's object
validation behavior.

## Safety and Compatibility Gates

```bash
npm test
npx eslint .
docker compose run --build --rm test-node \
  npx vitest run test/integration/compound-workspace-admission.test.js \
  --no-file-parallelism
```

- 2,172 unit tests passed and two were skipped at the exact implementation
  checkpoint.
- The focused Docker integration passed for SHA-1 and SHA-256.
- Each integration case observed one checked ref publication, closed the
  scoped fast-import session, ran `git prune --expire=now`, and read the
  retained dependent graph successfully.
- Invalid bounds, empty operations, operation overflow, callback failure,
  staged failure, distinct concurrent failures, checked-ref failure, escaped
  scope use, prior-generation preservation, and queued-work poisoning have
  deterministic regression coverage.

This change is additive and migration-free. It changes neither application
handles nor stored object bytes, descriptor schemas, ref namespaces, existing
workspace methods, or read paths. Existing repositories and active v6.5.8
workspace refs remain readable without rewriting or cutover.

## Review and Release Boundary

Implementation PR [#124](https://github.com/git-stunts/git-cas/pull/124)
merged normally as `eb8d617620fa8f401fb887f5b1bbc341d4746b0a`. Its exact
reviewed head `29ba6e88c787a5e54c95a554e9166fd21aae31c0` passed the full
14-stage release verifier with 7,141 observed tests. The versioned v6.5.9
candidate `5512acd477bc5e5a11339d6027a03631d1a3544a` then passed the same
14-stage method with 7,147 observed tests. The reviewed merge, signed tag,
registry artifact, and GitHub Release remain separate gates recorded by the
[release-candidate witness](./release-candidate.md) and release PR
[#125](https://github.com/git-stunts/git-cas/pull/125).
