# Verification Witness: Scoped Staging Workspaces

## Identity

- Feature commit: `d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`
- Review-hardening commit: `29bcf03e9e7289852812a956938e2f80bed7233a`
- Verified: 2026-07-17
- Issue: [#75](https://github.com/git-stunts/git-cas/issues/75)
- Verification command: `npm run release:verify -- --skip-jsr`

## Source Evidence

The facade exposes one bounded workspace capability with `open`, `inspect`, and
`sweep` operations. [cite: `index.js#197-200@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Every successful staged result is resolved, installed into the current
RootSet generation, matched to a retention witness, and only then returned as
retained. [cite: `src/domain/services/StagingWorkspace.js#163-235@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Cache and publication promotion renew source reachability, establish the
destination, require exact destination evidence, and release the workspace
only after that evidence succeeds.
[cite: `src/domain/services/StagingWorkspace.js#105-155@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]
[cite: `src/domain/services/StagingWorkspace.js#314-363@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Release is idempotent for one workspace object and deletes only the exact
observed ref generation. [cite: `src/domain/services/StagingWorkspace.js#365-395@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Inspection is namespace- and count-bounded. Sweep removes only valid expired
direct refs with an expected-generation compare-and-delete.
[cite: `src/domain/services/StagingWorkspaceRegistry.js#88-159@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Inspection and sweep now expose an exclusive, namespace-bound continuation so
cleanup can traverse inventories larger than one bounded page. The Git adapter
streams a deterministic ref-name ordering and bounds each emitted page.
[cite: `src/domain/services/StagingWorkspaceRegistry.js#88-165@29bcf03e9e7289852812a956938e2f80bed7233a`]
[cite: `src/infrastructure/adapters/GitRefAdapter.js#220-233@29bcf03e9e7289852812a956938e2f80bed7233a`]
[cite: `src/infrastructure/adapters/GitRefAdapter.js#291-373@29bcf03e9e7289852812a956938e2f80bed7233a`]

Checkpoint input consumption counts every item before deduplication, bounding
hostile or infinite iterables. A successful low-level write followed by failed
workspace retention returns typed staged evidence instead of hiding the new
unanchored object.
[cite: `src/domain/services/StagingWorkspace.js#163-205@29bcf03e9e7289852812a956938e2f80bed7233a`]
[cite: `src/domain/services/StagingWorkspace.js#282-309@29bcf03e9e7289852812a956938e2f80bed7233a`]

Workspace diagnostics validate typed targets and report semantic logical bytes
separately from unique direct root-object bytes.
[cite: `src/domain/services/StagingWorkspaceRegistry.js#171-255@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]
[cite: `src/domain/services/RepositoryDoctor.js#409-433@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Repository doctor aggregates active and expired workspace posture while
preserving explicit truncation evidence.
[cite: `src/domain/services/RepositoryDoctor.js#479-488@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]
[cite: `src/domain/services/RepositoryDoctor.js#698-709@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Doctor treats any workspace issue as unhealthy and preserves direct-constructor
compatibility by reporting unavailable workspace diagnostics as typed unhealthy
evidence.
[cite: `src/domain/services/RepositoryDoctor.js#184-198@29bcf03e9e7289852812a956938e2f80bed7233a`]
[cite: `src/domain/services/RepositoryDoctor.js#418-430@29bcf03e9e7289852812a956938e2f80bed7233a`]

## Behavioral Evidence

Real-Git integration proves that returned pages survive immediate prune while
anchored and become collectible after release.
[cite: `test/integration/staging-workspace.test.js#90-107@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

The composition path prunes after each page, after bundle construction, after
checkpoint compaction, and after cache promotion, then reads the promoted
bundle from the cache.
[cite: `test/integration/staging-workspace.test.js#110-146@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Expiry is proven to be posture rather than automatic revocation: the object
survives prune after expiry and becomes collectible only after checked sweep.
[cite: `test/integration/staging-workspace.test.js#204-227@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Unit coverage proves hostile checkpoint bounds, staged retention-failure
evidence, inspection-race conflict reporting, and traversal beyond the default
1,000-record page.
[cite: `test/unit/domain/services/StagingWorkspace.test.js#175-202@29bcf03e9e7289852812a956938e2f80bed7233a`]
[cite: `test/unit/domain/services/StagingWorkspace.test.js#234-274@29bcf03e9e7289852812a956938e2f80bed7233a`]
[cite: `test/unit/domain/services/StagingWorkspace.test.js#380-420@29bcf03e9e7289852812a956938e2f80bed7233a`]
[cite: `test/unit/domain/services/StagingWorkspace.test.js#445-478@29bcf03e9e7289852812a956938e2f80bed7233a`]

Real-Git integration proves continuation reaches a later expired workspace and
that neither exact release nor sweep follows or deletes symbolic workspace
refs. Publication tests prove the source remains retained through publication
and through rejected or incomplete destination evidence.
[cite: `test/integration/staging-workspace.test.js#230-299@29bcf03e9e7289852812a956938e2f80bed7233a`]
[cite: `test/unit/domain/services/StagingWorkspacePromotion.test.js#193-270@29bcf03e9e7289852812a956938e2f80bed7233a`]

## Verification Results

The release verifier passed all 13 executed steps:

| Surface | Result |
| --- | ---: |
| Lint | PASS |
| Node unit tests | 1,984 passed; 2 skipped |
| Bun unit tests | 1,983 passed; 3 skipped |
| Deno unit tests | 1,974 passed; 12 skipped |
| Public type compatibility | PASS |
| Node integration tests | 190 passed |
| Bun integration tests | 190 passed |
| Deno integration tests | 190 passed |
| Example: store-and-restore | PASS |
| Example: encrypted-workflow | PASS |
| Example: progress-tracking | PASS |
| Build metadata stamp | PASS |
| npm pack dry-run | PASS |

The verifier reported 6,511 observed Vitest tests. That total excludes the three
separately executed example-process checks listed above. The JSR publish dry-run
was the only skipped release step because `--skip-jsr` was explicit.

## Review Corrections

Review corrected eight contract defects before this witness:

1. Cache rejection or malformed destination evidence no longer releases the
   workspace.
2. Failed doctor inspection now preserves every required workspace report
   field with explicit unknown values.
3. Malformed refs inside descriptors now report the descriptor-level error.
4. Inspection and sweep continue beyond the first bounded page without
   materializing the full ref inventory.
5. Inspection-time generation races and active records carrying issues remain
   visibly unhealthy instead of disappearing from cleanup and doctor receipts.
6. Hostile duplicate checkpoint iterables cannot evade the input bound.
7. Staged objects whose retention write fails remain recoverable from typed
   error evidence.
8. Publication sequencing, incomplete destination evidence, and symbolic-ref
   containment have direct regression coverage.

## Remaining Gates

- The first Code Rabbit and independent Code Lawyer reviews completed. Their
  findings are addressed locally; GitHub thread resolution and post-push CI are
  pending.
- The fresh `v6.4.0` candidate verifier passed 14/14 steps with 6,520 observed
  tests, including npm and JSR dry-runs. Release-PR review and the tag-driven
  publication workflow remain pending.
- Downstream git-warp adoption and its unchanged ten-second integration hook
  remain the end-to-end performance and compatibility gate.
