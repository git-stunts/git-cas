# PERF-0048 v6.3.0 Release Candidate Witness

Date: 2026-07-17

Issues: #69, #70

## Scope

This witness records the pre-publication release candidate for bounded scoped
cache acquisitions. It does not claim that a `v6.3.0` tag, npm artifact, or
GitHub Release exists yet.

The candidate:

- sets npm, JSR, and the runtime `PACKAGE_VERSION` export to `6.3.0`;
- moves scoped cache acquisitions from `Unreleased` to `6.3.0`;
- ships and links `docs/releases/v6.3.0.md`;
- adds the v6.2.0-to-v6.3.0 adoption guidance to `UPGRADING.md`;
- records an honest release-candidate posture in `STATUS.md`;
- keeps the previous v6.2.0 publication witness immutable; and
- verifies that the npm package contains the public release documentation.

## Implementation Provenance

| Capability | Pull request | Merge commit |
| --- | --- | --- |
| Pre-push Git environment isolation | #71 | `eac13afe74f927c739c601b9f1c3688bf4022511` |
| Scoped cache acquisitions | #72 | `7b15ec1819a1c2500c459818785fcd7ec6cf7676` |

## Verification

The authoritative local command was:

```bash
pnpm run release:verify
```

It passed 14/14 steps and observed 6,325 tests:

| Step | Result | Tests |
| --- | --- | ---: |
| ESLint | pass | - |
| Node unit | pass | 1,928 |
| Bun unit | pass | 1,927 |
| Deno unit | pass | 1,918 |
| Public type compatibility | pass | - |
| Node integration | pass | 184 |
| Bun integration | pass | 184 |
| Deno integration | pass | 184 |
| Example: store-and-restore | pass | - |
| Example: encrypted-workflow | pass | - |
| Example: progress-tracking | pass | - |
| Build metadata stamp | pass | - |
| npm pack dry-run | pass | - |
| JSR publish dry-run | pass | - |

The final npm dry-run reported 242 files, 747,220 packed bytes, and 2,054,933
unpacked bytes. Exact compressed package identity is intentionally not embedded
in a packaged document because the build stamp is regenerated during pack and
publication.

The first release-prep verifier correctly stopped because a point-in-time
documentation test required `STATUS.md` to remain frozen at the v6.2.0
publication state. The test now enforces the actual invariant: v6.2.0 remains
the last tagged release with immutable publication evidence, while v6.3.0 is an
explicitly unpublished candidate. The complete 14-step result above comes from
a fresh rerun after that repair.

## Publication Gate

Publication remains blocked until all of the following are true:

1. the release PR passes GitHub CI, self-review, Code Lawyer review, and the
   agreed CodeRabbit posture;
2. the release PR is merged without unresolved findings;
3. a signed annotated `v6.3.0` tag points at the reviewed merge commit;
4. the release workflow passes version validation and runtime tests;
5. npm reports `@git-stunts/git-cas@6.3.0` with provenance; and
6. GitHub reports the final non-draft `v6.3.0` Release.

Issue #69 stays open until publication evidence and the downstream git-warp
registry handoff are attached. git-warp must consume the registry artifact, not
a local path override.
