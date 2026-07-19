# PERF-0052 v6.5.2 Release Candidate Witness

Date: 2026-07-19

Issue: #90

Implementation review: #91

Release review: pending

## Scope

This witness records the pre-publication release candidate for persistent
bounded Git object sessions, bounded page batches, and deterministic local
resource closure. It does not claim that a `v6.5.2` tag, npm artifact, or GitHub
Release exists. This is an explicitly unpublished candidate.

The candidate:

- sets npm, JSR, and the runtime `PACKAGE_VERSION` export to `6.5.2`;
- moves the persistent-session and page-batch changes from `Unreleased` to
  `6.5.2`;
- packages and links `docs/releases/v6.5.2.md`;
- adds v6.5.1-to-v6.5.2 adoption guidance to `UPGRADING.md`;
- marks design 0052 landed and records its release-candidate posture;
- preserves all v6.5.1 publication evidence as immutable history; and
- leaves tag and registry publication claims deliberately absent.

## Implementation Provenance

| Capability                                   | Review anchor | Commit                                     |
| -------------------------------------------- | ------------- | ------------------------------------------ |
| Persistent typed Git object sessions         | #91           | `27831926327afc7522b39ab435d29b46b7ac428e` |
| Bounded page batching and facade closure     | #91           | `27831926327afc7522b39ab435d29b46b7ac428e` |
| Lifecycle, teardown, and boundedness repairs | #91           | `1819d8572707d8846ffa7ace9847f490cdb6438b` |
| Final review repairs                         | #91           | `efce7879348072a25759996dd159e35b638c4035` |
| Reviewed feature merge                       | #91           | `4ce37adc57d49d2633507c3fbdc46e98617b26d6` |

The public page capability exposes bounded ordered batches, and the root facade
exposes explicit close and async disposal without making the optional
persistence-port capabilities mandatory for legacy structural adapters.

[cite: `index.d.ts#1466-1474@4ce37adc57d49d2633507c3fbdc46e98617b26d6`]
[cite: `index.d.ts#1723-1742@4ce37adc57d49d2633507c3fbdc46e98617b26d6`]

The Git adapter feature-detects typed sessions, bounds parsed-tree residency,
keeps individual writes one-shot, and scopes bulk writes to one completed and
closed `fast-import` process.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#41-180@4ce37adc57d49d2633507c3fbdc46e98617b26d6`]
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#499-570@4ce37adc57d49d2633507c3fbdc46e98617b26d6`]

The real-Git regression contract proves semantic identity, one-session reads,
one-process bounded batch writes, assertion-safe cleanup, and correct rewrite
after aggressive external pruning.

[cite: `test/integration/bundle-reference-performance.test.js#165-246@4ce37adc57d49d2633507c3fbdc46e98617b26d6`]

## Verification

The versioned candidate passed the complete `pnpm run release:verify` method:

| Gate                       | Result           | Observed tests |
| -------------------------- | ---------------- | -------------: |
| Lint                       | PASS             |              - |
| Unit tests (Node)          | PASS             |          2,080 |
| Unit tests (Bun)           | PASS             |          2,079 |
| Unit tests (Deno)          | PASS             |          2,070 |
| Public type compatibility  | PASS             |              - |
| Integration tests (Node)   | PASS             |            196 |
| Integration tests (Bun)    | PASS             |            196 |
| Integration tests (Deno)   | PASS             |            196 |
| Examples and build stamp   | PASS             |              - |
| npm and JSR dry-runs       | PASS             |              - |
| **Release method summary** | **PASS (14/14)** |      **6,817** |

The implementation PR merged only after GitHub lint and all Node/Bun/Deno jobs
passed, CodeRabbit approved, every review thread was resolved, and the complete
diff received a clean self-review. Tag and publication evidence remain
deliberately absent from this candidate witness.

## Publication Gate

Publication remains blocked until all of the following are true:

1. the versioned candidate passes every release-verifier step;
2. the release PR passes GitHub CI, self-review, Code Lawyer review, and the
   agreed CodeRabbit posture;
3. the release PR is merged without unresolved findings;
4. a signed annotated `v6.5.2` tag points at the reviewed merge commit;
5. the release workflow passes version validation and runtime tests;
6. npm reports `@git-stunts/git-cas@6.5.2` with provenance; and
7. GitHub reports the final non-draft `v6.5.2` Release.

Downstream git-warp adoption and its process-tree CPU, wall-clock,
Git-command, and bounded-memory evidence remain separate post-publication
obligations.
