# PERF-0051 v6.5.1 Release Candidate Witness

Date: 2026-07-18

Issue: #85

Implementation review: #87

Release review: #88

## Scope

This witness records the pre-publication release candidate for bounded immutable
page payload reuse. It does not claim that a `v6.5.1` tag, npm artifact, or
GitHub Release exists. This is an explicitly unpublished candidate.

The candidate:

- sets npm, JSR, and the runtime `PACKAGE_VERSION` export to `6.5.1`;
- moves bounded page payload reuse from `Unreleased` to `6.5.1`;
- packages and links `docs/releases/v6.5.1.md`;
- adds v6.5.0-to-v6.5.1 adoption guidance to `UPGRADING.md`;
- marks design 0051 landed and records the v6.5.1 milestone in `ROADMAP.md`;
- records an honest release-candidate posture in `STATUS.md`; and
- preserves the v6.5.0 publication witness as immutable history.

## Implementation Provenance

| Capability                                  | Review anchor | Commit                                     |
| ------------------------------------------- | ------------- | ------------------------------------------ |
| Bounded immutable page payload reuse        | #87           | `5495eefbc83a2dcc21366cf5e0ebd960998c3c48` |
| Internal-only cache defaults                | #87           | `4343163ed18a6e8f96ecb39f21daf4de8c55b9f7` |
| In-flight, metadata, and test review repairs | #87           | `3a5360d21656d62dc90c6632658cfefa0fbf3f36` |
| Reviewed feature merge                      | #87           | `ad5b91b2ff7c156526961a8d0575be1a250d92c6` |

The public constructor accepts independent entry and byte residency bounds.
`pages.get()` probes immutable OID payload state before Git metadata, validates
cold misses before materialization, checks every caller's limit after
resolution, and returns an independent byte copy.

[cite: `index.d.ts#709-712@ad5b91b2ff7c156526961a8d0575be1a250d92c6`]
[cite: `index.js#135-137@ad5b91b2ff7c156526961a8d0575be1a250d92c6`]
[cite: `src/domain/services/PageService.js#84-103@ad5b91b2ff7c156526961a8d0575be1a250d92c6`]

The shared cache keeps unresolved work separate from completed LRU residence.
Only completed entries participate in count and byte eviction, so capacity
pressure cannot break A/B/A coalescing or displace a resident before an
in-flight value's weight is known.

[cite: `src/helpers/boundedPromiseCache.js#44-85@ad5b91b2ff7c156526961a8d0575be1a250d92c6`]
[cite: `src/helpers/boundedPromiseCache.js#96-115@ad5b91b2ff7c156526961a8d0575be1a250d92c6`]

The real-Git regression contract requires an identical warm page read to issue
zero additional Git commands.

[cite: `test/integration/bundle-reference-performance.test.js#111-125@ad5b91b2ff7c156526961a8d0575be1a250d92c6`]

## Verification

The versioned candidate passed the complete `pnpm run release:verify` method:

| Gate                       | Result | Observed tests |
| -------------------------- | ------ | -------------: |
| Lint                       | PASS   |              - |
| Unit tests (Node)          | PASS   |          2,036 |
| Unit tests (Bun)           | PASS   |          2,035 |
| Unit tests (Deno)          | PASS   |          2,026 |
| Public type compatibility  | PASS   |              - |
| Integration tests (Node)   | PASS   |            193 |
| Integration tests (Bun)    | PASS   |            193 |
| Integration tests (Deno)   | PASS   |            193 |
| Examples and build stamp   | PASS   |              - |
| npm and JSR dry-runs       | PASS   |              - |
| **Release method summary** | **PASS (14/14)** |      **6,676** |

The feature PR also merged only after GitHub lint and all Node/Bun/Deno jobs
passed, CodeRabbit approved, and every review thread was resolved. Tag and
publication evidence remain deliberately absent from this candidate witness.

## Publication Gate

Publication remains blocked until all of the following are true:

1. the versioned candidate passes every release-verifier step;
2. the release PR passes GitHub CI, self-review, Code Lawyer review, and the
   agreed CodeRabbit posture;
3. the release PR is merged without unresolved findings;
4. a signed annotated `v6.5.1` tag points at the reviewed merge commit;
5. the release workflow passes version validation and runtime tests;
6. npm reports `@git-stunts/git-cas@6.5.1` with provenance; and
7. GitHub reports the final non-draft `v6.5.1` Release.

Downstream git-warp adoption and its CPU, wall-clock, Git-command, and
bounded-memory evidence remain separate post-publication obligations.
