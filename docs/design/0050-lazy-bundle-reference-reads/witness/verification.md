# Lazy Bundle Reference Reads Verification Witness

Generated: 2026-07-18 01:26:08 PDT

Issue: [#81](https://github.com/git-stunts/git-cas/issues/81)

Feature commit: `7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`

Concurrency repair commit: `d7841acbaffbc4c5b14c78d31d3dc65ac4618cce`

Cache settlement repair commit: `f1d219973d40bfa8a728093d39f793c3486037ad`

## Public Contract

The frozen `bundles` facade exposes direct lookup and streaming reference
iteration without exposing `BundleService` itself.

[cite: `index.js#215-224@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]

The declarations distinguish `BundleMemberReference` from a fully resolved
`BundleMember` and preserve the existing complete-validation methods.

[cite: `index.d.ts#1463-1499@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]

## Integrity Boundary

Targeted lookup validates the root and selected child summaries, charges every
descriptor on the selected path against the persisted descriptor-byte budget,
and follows only the selected fanout edge.

[cite: `src/domain/services/BundleService.js#114-155@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]

Reference iteration remains streaming while preserving descriptor, member,
root-summary, and fanout-summary checks. Existing `iterateMembers()` selects
the same traversal with recursive target validation enabled.

[cite: `src/domain/services/BundleService.js#229-275@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]

Tests prove that a corrupt root summary fails closed, a direct reference can be
read without recursively resolving missing nested support, and reference
iteration does not invoke target resolvers.

[cite: `test/unit/domain/services/BundleService.test.js#282-335@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]

## Bounded Residency

Structural bundle descriptor blobs use a 1,024-entry, 16 MiB cache. Every hit
returns a fresh byte array, so a decoder or caller cannot mutate cached bytes.

[cite: `src/domain/services/BundleService.js#15-29@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]
[cite: `src/domain/services/BundleService.js#613-622@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]

The shared helper enforces positive entry bounds, optional aggregate weight,
least-recently-used eviction, in-flight coalescing, and rejection eviction.
Bookkeeping now settles before the shared promise becomes observable, so an
immediate retry cannot recover a stale rejected promise. Resolved weights must
also be non-negative safe integers or the entry is rejected and evicted.

[cite: `src/helpers/boundedPromiseCache.js#35-101@f1d219973d40bfa8a728093d39f793c3486037ad`]

The Git adapter uses one bounded cache for exact immutable tree-entry and
object-info reads. Tree-entry records are frozen internally and cloned before
return; failed reads are not retained. The adapter contract explicitly
requires retained roots and prohibits destructive pruning races during active
operations.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#27-50@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#150-166@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#215-269@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]

Unit coverage proves concurrent and sequential coalescing, immediate
transient-failure retry, resolved-weight validation, configurable residency
validation, and least-recently-used eviction.

[cite: `test/unit/helpers/boundedPromiseCache.test.js#42-60@f1d219973d40bfa8a728093d39f793c3486037ad`]
[cite: `test/unit/helpers/boundedPromiseCache.test.js#63-123@f1d219973d40bfa8a728093d39f793c3486037ad`]

[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.readTree.test.js#92-114@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]
[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.readTree.test.js#147-213@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]

A code-lawyer probe retried immediately after directly awaiting a rejected
cache promise. Before the settlement repair, all 10,000 iterations recovered
the stale rejection. The same probe completed with zero stale rejections after
the repair.

## Concurrent Root-Set Safety

The release gate exposed a second-order failure under repeated concurrent
cache replacement. Git occasionally returned exit code 128 with empty output
for the exact guarded `update-ref` command. An independent ref read showed
that the competing writer had advanced the head, but the missing text prevented
the plumbing classifier from identifying the compare-and-swap race.

Root-set persistence now accepts that narrow evidence bundle as a conflict:
fatal exit 128, exact managed command operands, a valid observed head, and an
observed head different from the caller's expectation. It does not normalize
same-head failures, other-ref commands, or nonfatal exits.

[cite: `src/domain/services/RootSetPersistence.js#17-70@d7841acbaffbc4c5b14c78d31d3dc65ac4618cce`]
[cite: `src/domain/services/RootSetPersistence.js#267-337@d7841acbaffbc4c5b14c78d31d3dc65ac4618cce`]

The regression suite preserves both sides of that boundary. It proves the
empty-diagnostic advanced-head case is retryable and proves three nearby error
shapes remain terminal.

[cite: `test/unit/domain/services/RootSetPersistence.test.js#71-125@d7841acbaffbc4c5b14c78d31d3dc65ac4618cce`]
[cite: `test/unit/domain/services/RootSetPersistence.test.js#217-245@d7841acbaffbc4c5b14c78d31d3dc65ac4618cce`]

A pre-fix Docker stress run reproduced the terminal failure at iteration 149.
The repaired implementation completed 500 consecutive two-writer guarded
replacements with exactly one accepted winner per iteration. The underlying
Node stderr-drain defect is tracked as
[git-stunts/plumbing#9](https://github.com/git-stunts/plumbing/issues/9).

## Verification Results

| Command                                                 | Result                                    |
| ------------------------------------------------------- | ----------------------------------------- |
| `pnpm exec vitest run` over the five focused unit files | 5 files, 61 tests passed                  |
| `pnpm test`                                             | 220 files passed; 2,013 passed, 2 skipped |
| `pnpm run lint`                                         | passed                                    |
| `pnpm run test:integration:node`                        | 12 files, 192 tests passed in Docker      |
| guarded-replacement Docker stress                       | 500 consecutive races passed              |
| `git diff --check`                                      | passed                                    |

The real-Git proof requires a cold read to issue Git metadata commands, then
requires an identical warm read to issue zero additional commands. A separate
comparison requires direct reference iteration to issue fewer total and fewer
object-inspection commands than complete recursive validation.

[cite: `test/integration/bundle-reference-performance.test.js#111-151@7ddbda5d369b4c0694b1bbf337834a7fc6e776cb`]

## Same-Fixture Performance Evidence

These exploratory measurements use the same four-node git-warp retained
property fixture. They are diagnostic evidence, not portable latency promises;
the command-count integration test above is the stable regression contract.

| Posture                                             | Reads | Git commands |           Wall time |   Node CPU |
| --------------------------------------------------- | ----: | -----------: | ------------------: | ---------: |
| git-cas 6.4.0, complete recursive validation        |     1 |          192 | approximately 3-5 s | 210-234 ms |
| Internal direct-reference A/B                       |     1 |           92 |             1.443 s |      89 ms |
| Public references plus immutable Git metadata cache |     1 |           71 |             1.215 s |  80.947 ms |
| Public references plus descriptor cache             |     1 |           69 |             1.291 s |  92.065 ms |
| Before descriptor cache                             |    16 |          521 |             8.943 s | 626.554 ms |
| After descriptor cache                              |    16 |          309 |             5.173 s |   397.1 ms |

The one-read command count fell from 192 to 69, a 64.1% reduction. The
16-read descriptor-cache comparison cut 212 commands and 42.2% wall time.
Peak RSS for the final 16-read diagnostic was 117,129,216 bytes. The run
performed zero causal replay and did not materialize or cache whole graph
state.

## Residual Cost

This cycle does not establish that git-warp is fast. The final 16-read command
histogram still contains 48 `rev-parse`, 16 `for-each-ref`, 16 `rev-list`, 48
`symbolic-ref`, and 32 `update-ref` invocations. That is ten acquisition/ref
commands per read before selected payload access.

The next optimization belongs in git-warp: hold one explicit materialization
acquisition for a runtime or coordinate lifetime, release it through runtime
resource closure, and reacquire only when the selected generation changes.
That design must preserve git-cas as the sole owner of cache objects and
retention refs.
