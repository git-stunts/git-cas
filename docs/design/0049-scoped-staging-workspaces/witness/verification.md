# Verification Witness: Scoped Staging Workspaces

## Identity

- Feature commit: `d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`
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

Workspace diagnostics validate typed targets and report semantic logical bytes
separately from unique direct root-object bytes.
[cite: `src/domain/services/StagingWorkspaceRegistry.js#171-255@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]
[cite: `src/domain/services/RepositoryDoctor.js#409-433@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

Repository doctor aggregates active and expired workspace posture while
preserving explicit truncation evidence.
[cite: `src/domain/services/RepositoryDoctor.js#479-488@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]
[cite: `src/domain/services/RepositoryDoctor.js#698-709@d358eae2a2cf7cf028084c4ff81e9cfc09cc4a1e`]

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

## Verification Results

The release verifier passed all 13 executed steps:

| Surface | Result |
| --- | ---: |
| Lint | PASS |
| Node unit tests | 1,967 passed; 2 skipped |
| Bun unit tests | 1,966 passed; 3 skipped |
| Deno unit tests | 1,957 passed; 12 skipped |
| Public type compatibility | PASS |
| Node integration tests | 188 passed |
| Bun integration tests | 188 passed |
| Deno integration tests | 188 passed |
| Examples | 3 passed |
| Build metadata stamp | PASS |
| npm pack dry-run | PASS |

The verifier reported 6,454 observed tests. The JSR publish dry-run was the only
skipped release step because `--skip-jsr` was explicit.

## Review Corrections

Pre-commit review corrected three contract defects before this witness:

1. Cache rejection or malformed destination evidence no longer releases the
   workspace.
2. Failed doctor inspection now preserves every required workspace report
   field with explicit unknown values.
3. Malformed refs inside descriptors now report the descriptor-level error.

## Remaining Gates

- GitHub review, CI, Code Rabbit, and independent Code Lawyer review are pending.
- The package version and release milestone require an explicit release decision.
- Downstream git-warp adoption and its unchanged ten-second integration hook
  remain the end-to-end performance and compatibility gate.
