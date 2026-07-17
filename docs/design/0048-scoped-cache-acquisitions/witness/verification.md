# PERF-0048 Verification Witness

Date: 2026-07-17

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

An independent Code Lawyer pass then found five additional contract failures:
symbolic-ref authority escape, mandatory acquisition methods breaking legacy
structural adapters, inspection work that scaled with skipped refs, concurrent
release disappearance reported as conflict, and a constructible runtime export
whose nominally private TypeScript constructor was forgeable in JavaScript.
Adversarial tests produced 19 focused failures plus the expected `TS2739`
compatibility failure before remediation.

A second independent Code Lawyer pass then found three narrower contract gaps:
Git 2.43 cannot atomically assert direct-ref type together with an OID mutation,
doctor treated missing ref-type evidence as healthy, and adding a member to the
closed public `RetentionRootKind` union broke exhaustive TypeScript consumers.
The final remediation states the achievable authority invariant precisely,
marks unknown ref type unhealthy, keeps the original root-kind union unchanged,
and makes the new doctor report group declaration-optional.

A final independent Code Lawyer pass found two additional authority gaps. The
ordinary managed-ref update path still followed symbolic refs, and a checked
deletion conflict could classify an enumerator-invisible dangling symbolic ref
as an idempotent miss. The production adapter now preflights every managed ref
mutation, uses no-dereference updates throughout, and re-probes symbolic-ref type
after checked-delete conflicts. Deterministic real-Git tests exercise both
pre-existing and post-probe ordinary-update races plus the dangling-release race.

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
  test/unit/infrastructure/adapters/GitRepositoryInspectionAdapter.test.js \
  test/unit/types/declaration-accuracy.test.js \
  test/unit/scripts/release-verify.test.js

deno check --config test/types/deno.json \
  test/types/public-api-compatibility.ts
```

Observed result:

```text
Test Files  9 passed (9)
Tests       122 passed (122)
Type check  PASS
```

This covers reference-only acquisition, miss and expiry behavior, generation
race retry, idempotent release, checked cleanup, opaque inspection, malformed
and future-dated refs, doctor aggregation, Git transaction failure boundaries,
stream fragmentation, legacy-adapter compatibility, declaration accuracy, and
the release gate. The real TypeScript consumer fixture proves that a legacy ref
adapter remains assignable to `GitRefPortBase` without implementing
acquisition-only methods, the original retention-kind switch remains exhaustive,
and the new doctor acquisition group remains structurally additive.

## Real Git Lifetime Proof

The targeted Docker-backed Node run observes fifteen passing CacheSet integration
tests. The full Node, Bun, and Deno integration suites each observe 184 passing
tests in the post-remediation release verifier.

The aggressive-prune proof performed this state transition in a synthetic bare
repository:

```text
put target -> cache.put -> cache.acquire -> cache.replace
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
targeting a two-level structured bundle containing eight child bundles of eight
pages each.

Observed replay:

```text
one-page target:      N Git plumbing commands
nested 64-page graph: N Git plumbing commands
terminal mutation:    update-ref --no-deref --stdin
```

The equal counts include bounded cache-index traversal plus the symbolic-ref
guard and atomic acquisition transaction. The trace never traverses the selected
target's member graph. The claim is equal command count with respect to target
support size, not that the current command count is an optimal implementation
floor.

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

The final npm dry-run receipt contains `docs/releases/v6.3.0.md` and reports:

```text
files:         242
packed size:   746,100 bytes
unpacked size: 2,051,091 bytes
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

Post-remediation result:

```text
Version: 6.2.0
Steps passed: 13/13
Total tests observed: 6310
Skipped steps: JSR publish dry-run

Unit Tests (Node)        PASS  1923
Unit Tests (Bun)         PASS  1922
Unit Tests (Deno)        PASS  1913
Public type compatibility PASS    -
Integration Tests (Node) PASS   184
Integration Tests (Bun)  PASS   184
Integration Tests (Deno) PASS   184
```

These are the final local pre-review totals. The package remains `6.2.0` in the
implementation PR; the release workflow creates v6.3.0 after merge. JSR remains
the only deliberately skipped step locally because registry publication is a
post-merge release action.

A direct host integration invocation was also attempted and correctly refused
because this repository requires `GIT_STUNTS_DOCKER=1` for integration tests.
The supported Docker-backed Node, Bun, and Deno commands all passed; the host
refusal is an environment guard, not a hidden test failure.

## Proof Stories

| Story | Result | Evidence |
| --- | --- | --- |
| A hit does not recursively resolve its target | PASS | Resolver spy remains untouched; 1-page and nested 64-page traces have equal command counts |
| A returned hit has a scoped lifetime claim | PASS | Atomic generation verification and acquisition-ref creation precede return |
| Cache mutation cannot collect an active target | PASS | Removal plus immediate reflog expiry and destructive prune preserves it |
| Managed ref mutation remains inside authority | PASS | Ordinary updates and acquisition release use preflight rejection, `--no-deref`, post-conflict ref-type checks, and deterministic post-probe races |
| Released history becomes collectible | PASS | Second destructive prune removes the target after release |
| Abandoned anchors are observable | PASS | Work-bounded exact-namespace inspection and doctor count/age/health fields |
| Public artifact documents the contract | PASS | v6.3.0 package docs and 242-file npm pack receipt pass |

## Pending Repository Gates

- [ ] Implementation commit and non-draft pull request linked to issue #69.
- [x] Self-review has no unresolved findings after final authority remediation.
- [ ] Independent Code Lawyer review has no unresolved findings.
- [ ] GitHub Actions CI is green.
- [ ] Code Rabbit is clean, rate limited, or out of credits.
- [ ] Pull request is merged normally without amend, rebase, or force.
- [ ] v6.3.0 is published and verified from the npm registry.

## Bounded Claims

- An acquisition retains the entire selected cache generation. It does not
  synthesize a second target-only tree.
- `release()` proves an explicit caller action, not that all possible consumers
  are dead. Sharing one acquisition beyond its owner is outside the contract.
- Age is diagnostic evidence only. There is intentionally no implicit TTL or
  lease timeout.
- `CacheSet.get()` keeps its existing complete target-validation semantics.
  Callers choose `acquire()` for the lifetime-safe bounded path.
- The current command count is bounded by cache-index shape, but is not claimed
  as optimal. Further index-path optimization remains possible.
- Git's `for-each-ref` omits dangling symbolic refs. Bounded inventory and doctor
  therefore report symbolic acquisition refs that Git enumerates, while missing
  ref-type evidence is unhealthy. This API does not claim exhaustive inventory
  of dangling symbolic refs.
- Supported Git 2.43 cannot atomically assert direct-ref type and OID in one
  update. Direct operations reject symbolic refs observed at preflight and use
  `--no-deref`; a same-OID symbolic ref installed after the probe may cause the
  managed ref name itself to be created or deleted, but its referent cannot be
  mutated through this API.
- Git refs provide reachability while present. This API does not create pack
  `.keep` files and does not claim immunity independent of references.
- git-warp adoption is downstream evidence and is not supplied by this cycle.
