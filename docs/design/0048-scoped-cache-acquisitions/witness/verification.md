# PERF-0048 Verification Witness

Date: 2026-07-16

This witness covers bounded, lifetime-safe CacheSet acquisitions. It separates
evidence already observed in the local worktree from repository-hosted review
and publication gates that remain pending.

## RED

The first focused run was made after the acquisition contract tests were
written but before the runtime API existed. Three tests failed because
`CacheSet.acquire()` and its acquisition lifecycle were absent. Existing cache
expectations did not need to be weakened or rewritten to obtain RED.

The initial proof obligations were capability failures:

1. acquire one cache entry without recursively resolving its target;
2. anchor the observed cache generation before returning the handle; and
3. release that anchor explicitly and safely.

## Focused Contract Proof

Command:

```bash
pnpm exec vitest run \
  test/unit/domain/services/CacheSet.test.js \
  test/unit/domain/services/CacheAcquisitionInventory.test.js \
  test/unit/domain/services/RepositoryDoctor.test.js \
  test/unit/domain/value-objects/CacheCollectionValues.test.js \
  test/unit/infrastructure/adapters/GitRefAdapter.test.js \
  test/unit/infrastructure/adapters/GitRefAdapter.iterateRefs.test.js \
  test/unit/facade/ContentAddressableStore.application-storage.test.js \
  test/unit/facade/ContentAddressableStore.diagnostics.test.js \
  test/unit/types/declaration-accuracy.test.js
```

Observed result:

```text
Test Files  9 passed (9)
Tests       83 passed (83)
```

This covers reference-only acquisition, miss and expiry behavior, generation
race retry, idempotent release, checked cleanup, opaque inspection, malformed
and future-dated refs, doctor aggregation, Git transaction failure boundaries,
stream fragmentation, legacy-adapter compatibility, facade compatibility, and
declaration accuracy.

## Real Git Lifetime Proof

The release verifier ran `test/integration/cache-set.test.js` under Node, Bun,
and Deno. Each runtime observed seven passing CacheSet integration tests as part
of a 176-test real-Git integration suite.

The aggressive-prune proof performed this state transition in a synthetic bare
repository:

```text
put target -> cache.put -> cache.acquire -> cache.remove
git reflog expire --expire=now --all
git prune --expire=now
target exists; acquisition ref resolves to acquired generation

acquisition.release
git reflog expire --expire=now --all
git prune --expire=now
target no longer exists
```

This is destructive prune evidence inside the disposable integration
repository, not an object-count proxy and not a dry-run assumption.

## Bounded Lookup Proof

The integration test instruments every plumbing `execute` and `executeStream`
call. It compares acquisition of a cache entry targeting one page with an entry
targeting a structured bundle containing 64 pages.

Observed replay:

```text
one-page target:      33 Git plumbing commands
64-member bundle:     33 Git plumbing commands
terminal operation:   update-ref --stdin
```

The count includes bounded cache-index traversal plus the atomic acquisition
transaction. The trace never traverses the selected target's member graph. The
claim is constant cost with respect to target support size, not that 33 commands
is an optimal implementation floor.

## Package Surface Proof

Focused documentation and package checks:

```bash
pnpm exec vitest run \
  test/unit/docs/package-docs.test.js \
  test/unit/docs/release-truth.test.js \
  test/unit/docs/markdown-links.test.js
```

Observed result:

```text
Test Files  3 passed (3)
Tests       24 passed (24)
```

The npm dry-run receipt contains `docs/releases/v6.2.1.md` and reports:

```text
files:         242
unpacked size: 2,040,013 bytes
```

The first package-doc run correctly failed because the public release note
linked to an internal design document excluded from npm. The link was changed
to the canonical GitHub URL; no internal design directory was added to the
published artifact.

## Full Release Verification

Command:

```bash
pnpm run release:verify -- --skip-jsr
```

Observed result:

```text
Version: 6.2.0
Steps passed: 12/12
Total tests observed: 6211
Skipped steps: JSR publish dry-run

Unit Tests (Node)        PASS  1898
Unit Tests (Bun)         PASS  1897
Unit Tests (Deno)        PASS  1888
Integration Tests (Node) PASS   176
Integration Tests (Bun)  PASS   176
Integration Tests (Deno) PASS   176
```

Lint, the three executable examples, build metadata stamping, and the npm pack
dry-run also passed. The package still reports `6.2.0` because this witness is
for the implementation PR before the release workflow creates v6.2.1. JSR was
the only deliberately skipped release step.

A direct host integration invocation was also attempted and correctly refused
because this repository requires `GIT_STUNTS_DOCKER=1` for integration tests.
The supported Docker-backed Node, Bun, and Deno commands all passed; the host
refusal is an environment guard, not a hidden test failure.

## Proof Stories

| Story | Result | Evidence |
| --- | --- | --- |
| A hit does not recursively resolve its target | PASS | Resolver spy remains untouched; 1-page and 64-member traces are both 33 commands |
| A returned hit has a scoped lifetime claim | PASS | Atomic generation verification and acquisition-ref creation precede return |
| Cache mutation cannot collect an active target | PASS | Removal plus immediate reflog expiry and destructive prune preserves it |
| Release removes only inspected authority | PASS | Idempotent release and expected-generation mismatch tests |
| Released history becomes collectible | PASS | Second destructive prune removes the target after release |
| Abandoned anchors are observable | PASS | Paginated namespace inspection and doctor count/age/health fields |
| Public artifact documents the contract | PASS | Package docs 24/24 and v6.2.1 note present in npm pack receipt |

## Pending Repository Gates

- [ ] Implementation commit and non-draft pull request linked to issue #69.
- [x] Self-review has no unresolved findings.
- [ ] Independent Code Lawyer review has no unresolved findings.
- [ ] GitHub Actions CI is green.
- [ ] Code Rabbit is clean, rate limited, or out of credits.
- [ ] Pull request is merged normally without amend, rebase, or force.
- [ ] v6.2.1 is published and verified from the npm registry.

## Bounded Claims

- An acquisition retains the entire selected cache generation. It does not
  synthesize a second target-only tree.
- `release()` proves an explicit caller action, not that all possible consumers
  are dead. Sharing one acquisition beyond its owner is outside the contract.
- Age is diagnostic evidence only. There is intentionally no implicit TTL or
  lease timeout.
- `CacheSet.get()` keeps its existing complete target-validation semantics.
  Callers choose `acquire()` for the lifetime-safe bounded path.
- The current command count is bounded by cache-index shape, but 33 commands is
  not claimed as optimal. Further index-path optimization remains possible.
- Git refs provide reachability while present. This API does not create pack
  `.keep` files and does not claim immunity independent of references.
- git-warp adoption is downstream evidence and is not supplied by this cycle.
