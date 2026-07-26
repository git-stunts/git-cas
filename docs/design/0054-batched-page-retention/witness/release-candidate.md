# PERF-0054 v6.5.4 Release Candidate Witness

Date: 2026-07-26

Issue: #99

Implementation review: #100

Release review: pending

## Scope

This witness records the pre-publication release candidate for batched
staging-workspace page retention. It does not claim that a `v6.5.4` tag, npm
artifact, or GitHub Release exists. This is an explicitly unpublished
candidate.

The candidate:

- sets npm, JSR, and the runtime `PACKAGE_VERSION` export to `6.5.4`;
- moves batched workspace page retention from `Unreleased` to `6.5.4`;
- packages and links `docs/releases/v6.5.4.md`;
- adds v6.5.3-to-v6.5.4 compatibility guidance to `UPGRADING.md`;
- marks design 0054 landed and records its release-candidate posture;
- preserves all v6.5.3 publication evidence as immutable history; and
- leaves tag and registry publication claims deliberately absent.

## Implementation Provenance

| Capability                         | Review anchor | Commit                                     |
| ---------------------------------- | ------------- | ------------------------------------------ |
| Batched workspace page retention   | #100          | `6dba2bab22241276a316d2af12f06704f7582eee` |
| Independent ordered-result proof   | #100          | `18d3c9e66b4c1cef6c6c148dd6d21eeb544d5b5d` |
| Reviewed feature merge             | #100          | `e6c58f10bf5244d0ee815a60636dec3c896ef38f` |

The staging workspace delegates one bounded page batch, resolves every page,
deduplicates only the installed target map, installs one generation, and maps
the exact witness back to every ordered result.

[cite: `src/domain/services/StagingWorkspace.js#209-269@e6c58f10bf5244d0ee815a60636dec3c896ef38f`]

Unit coverage derives expected handles independently and proves input order,
duplicate-result preservation, a shared generation, one ref update, bounded
failure, and failure containment. Real-Git integration proves reachability
through prune and exact release cleanup.

[cite: `test/unit/domain/services/StagingWorkspace.test.js#87-185@e6c58f10bf5244d0ee815a60636dec3c896ef38f`]
[cite: `test/integration/staging-workspace.test.js#117-154@e6c58f10bf5244d0ee815a60636dec3c896ef38f`]

The change adds one public method and changes no stored format, handle identity,
existing staging behavior, retention policy, ref authority, or release
lifecycle.

## Scale Witness

A disposable bare repository staged 8,188 deterministic tiny pages in 32
batches of at most 256 pages. It completed in 15.546 seconds, the final
generation matched the workspace ref, 8,188 page objects were reachable, and
Git reported no garbage.

The pre-change downstream rehearsal had retained only 5,213 pages after 75
minutes and produced about 1.16 GiB of loose scratch objects. The scale witness
contained no Think data and no large benchmark repository or fixture is part of
this release candidate.

## Verification

The versioned candidate passed the complete `pnpm run release:verify` method:

| Gate                       | Result           | Observed tests |
| -------------------------- | ---------------- | -------------: |
| Lint                       | PASS             |              - |
| Unit tests (Node)          | PASS             |          2,086 |
| Unit tests (Bun)           | PASS             |          2,085 |
| Unit tests (Deno)          | PASS             |          2,076 |
| Public type compatibility  | PASS             |              - |
| Integration tests (Node)   | PASS             |            199 |
| Integration tests (Bun)    | PASS             |            199 |
| Integration tests (Deno)   | PASS             |            199 |
| Examples and build stamp   | PASS             |              - |
| npm and JSR dry-runs       | PASS             |              - |
| **Release method summary** | **PASS (14/14)** |      **6,844** |

The implementation PR merged only after GitHub lint and all Node/Bun/Deno jobs
passed, CodeRabbit approved the exact head commit, and its only review thread
was resolved against the independently derived order proof. Tag and publication
evidence remain deliberately absent from this candidate witness.

## Publication Gate

Publication remains blocked until all of the following are true:

1. the versioned candidate passes every release-verifier step;
2. the release PR passes GitHub CI and review without unresolved findings;
3. the release PR is merged;
4. a signed annotated `v6.5.4` tag points at the reviewed merge commit;
5. the release workflow passes version validation and runtime tests;
6. npm reports `@git-stunts/git-cas@6.5.4` with provenance; and
7. GitHub reports the final non-draft `v6.5.4` Release.

Downstream git-warp adoption and its full disposable v18-to-v19 migration
rehearsal remain separate post-publication obligations.
