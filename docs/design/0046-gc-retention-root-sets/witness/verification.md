# API-0046 Verification Witness

Date: 2026-07-11

This witness covers the mutable, ref-backed `RootSet` API. All Git reclamation
checks used `git prune -n --expire=now`; no test or verification command ran
`git gc` or a destructive `git prune`.

## RED

The first focused RootSet run was made before the public facade and domain
modules existed. It failed at module/export resolution for `RootSet`,
`RootSetPersistence`, `RootSetMetadataCodec`, and
`ContentAddressableStore.rootSets`. The failures were capability failures, not
changed expectations on an existing implementation.

The Git-backed proof was written around two required state transitions:

1. A newly written target tree is initially eligible for immediate pruning.
2. Adding it to a root set removes it from prune output; removing it makes it
   eligible again when no other ref reaches it.

## Focused Unit Proof

Command:

```bash
pnpm vitest run \
  test/unit/domain/services/RootSet.test.js \
  test/unit/domain/services/RootSetMetadataCodec.test.js \
  test/unit/domain/services/RootSetPersistence.test.js \
  test/unit/domain/value-objects/RootSetRef.test.js \
  test/unit/facade/ContentAddressableStore.root-sets.test.js
```

Observed result:

```text
Test Files  5 passed (5)
Tests       31 passed (31)
```

This includes canonical metadata, safe ref names, real tree-edge generation,
parentless commits, missing/type-mismatched target rejection, guarded
`expectedHeadOid` conflicts, bounded retry behavior, doctor output, repair,
and facade wiring.

## Real Git Reachability Proof

Command:

```bash
docker compose run --rm test-node \
  pnpm vitest run test/integration/root-set.test.js
```

Observed result:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

The test creates a synthetic bare repository and runs the equivalent of this
transcript against a target tree containing one payload blob:

```text
git prune -n --expire=now
<target-tree-oid> tree

rootSet.put({ oid: <target-tree-oid>, type: "tree", ... })
git prune -n --expire=now
# target tree and payload blob absent from prune output

git cat-file -p refs/cas/rootsets/integration/prune-proof
# no "parent" header

rootSet.remove({ name: "payload" })
git prune -n --expire=now
<target-tree-oid> tree
```

The same integration test proves that a missing target and a declared object
type mismatch fail before the root-set ref changes.

## Bun Release-Gate Stability

The first full release verification passed Node and then exposed Bun worker
starvation in four pre-existing CPU-heavy CDC/scrypt tests. The exact 51 tests
from the three affected files passed when isolated. The entire Bun unit suite
then passed with file parallelism disabled:

```text
Test Files  191 passed | 1 skipped (192)
Tests       1678 passed | 3 skipped (1681)
```

The release verifier now applies `--no-file-parallelism` to the Bun unit step.
The integration scripts and release workflows also run one integration file at
a time because the CLI-heavy suites otherwise compete for Git subprocesses.
No timeout was increased and no test was newly skipped. The final Bun unit
result was:

```text
Tests       1685 passed | 3 skipped (1688)
```

## Full Release Verification

Command:

```bash
npm run release:verify -- --skip-jsr
```

Observed result:

```text
Version: 6.1.0
Steps passed: 12/12
Total tests observed: 5521
Skipped steps: JSR publish dry-run

Unit Tests (Node)        PASS  1686
Unit Tests (Bun)         PASS  1685
Unit Tests (Deno)        PASS  1676
Integration Tests (Node) PASS   158
Integration Tests (Bun)  PASS   158
Integration Tests (Deno) PASS   158
```

Lint, all three examples, build metadata stamping, and the npm package dry-run
also passed. JSR remained intentionally skipped under the documented upstream
toolchain gate.

## Proof Stories

| Story | Result | Evidence |
| --- | --- | --- |
| A current root-set entry is GC-safe | PASS | Target absent from immediate prune dry-run while the ref reaches it |
| Removal releases root-set history | PASS | Parentless head plus target present in prune dry-run after removal |
| Ref updates are concurrency-safe | PASS | Stale expected head fails; unguarded mutation retries from fresh state |
| Invalid targets cannot publish state | PASS | Missing/type-mismatched targets leave the ref unchanged |
| Corrupt state is diagnosable and repairable | PASS | Doctor returns stable errors; repair writes authoritative entries |
| Retention policy is not reachability state | PASS | Doctor reports policy and reachability counts separately |

## Bounded Claims

- A single-set doctor can prove its current entries are anchored. It reports
  repository-wide `orphaned` and `volatile` counts as zero because classifying
  objects outside the set requires repository-wide reachability analysis.
- Reflogs, branches, tags, vaults, or other root sets can continue retaining a
  target after removal from one root set.
- Root sets cannot recover objects that Git already pruned.
- WARP adoption and its state-cache repair path are downstream work, not proof
  supplied by this repository.
