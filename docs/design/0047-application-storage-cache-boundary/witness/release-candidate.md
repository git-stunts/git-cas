# API-0047 v6.2.0 Release Candidate Witness

Date: 2026-07-13

Issues: #50, #60

## Scope

This witness records the pre-publication release candidate for the application
storage and cache ownership boundary. It does not claim that a tag, npm
artifact, or GitHub Release exists yet.

The candidate:

- sets npm, JSR, and the runtime `PACKAGE_VERSION` export to `6.2.0`
- moves the completed feature record from `Unreleased` to `6.2.0`
- ships and links `docs/releases/v6.2.0.md`
- adds the v6.1.0-to-v6.2.0 adoption guidance to `UPGRADING.md`
- updates `ARCHITECTURE.md` for opaque handles, managed lifecycles, retention
  evidence, and repository diagnostics
- marks API-0047 landed and links every implementation witness
- verifies that the npm package includes all public release documentation

## Implementation Provenance

| Capability | Pull request | Merge commit |
| --- | --- | --- |
| Ownership design | #61 | `ee1be5d494196a31f2ccfbf526da266fee58e83a` |
| Opaque assets, retention, publication | #62 | `863c692e9992686b1f74a48ea075f40b35f9cb2e` |
| Structured bundles and pages | #63 | `cf7685b3d25d7c2e4f58fd869c76360dc355797a` |
| Managed CacheSet lifecycle | #64 | `dbf7424eec3c8079fb73eb7106b47cc344e01170` |
| Expiry-safe replay sets | #65 | `1f10e5c7a551b3a7185019a3637700f4eaef6bdc` |
| Repository diagnostics | #66 | `6d222dd133b767c443b99dc55944ed4ded56e2eb` |

## Verification

The authoritative local command was:

```bash
pnpm run release:verify
```

It passed 13/13 steps and observed 6,124 tests:

| Step | Result | Tests |
| --- | --- | ---: |
| ESLint | pass | - |
| Node unit | pass | 1,871 |
| Bun unit | pass | 1,870 |
| Deno unit | pass | 1,861 |
| Node integration | pass | 174 |
| Bun integration | pass | 174 |
| Deno integration | pass | 174 |
| Example: store-and-restore | pass | - |
| Example: encrypted-workflow | pass | - |
| Example: progress-tracking | pass | - |
| Build metadata stamp | pass | - |
| npm pack dry-run | pass | - |
| JSR publish dry-run | pass | - |

The first release-prep pass correctly failed because the CLI package-version
export still reported 6.1.0. A later successful pass exposed that the JSR
dry-run still simulated 6.0.0. Both distribution-version paths are now pinned
by `test/unit/cli/version.test.js`, and the table above comes from a complete
rerun after both repairs.

## Publication Gate

Publication remains blocked until all of the following are true:

1. the release PR passes GitHub CI, self-review, Code Lawyer review, and
   CodeRabbit review;
2. the release PR is merged without bypassing unresolved findings;
3. a signed `v6.2.0` tag points at the reviewed merge commit;
4. the release workflow passes its version check and runtime test jobs;
5. npm reports `@git-stunts/git-cas@6.2.0` with provenance; and
6. GitHub reports the final non-draft `v6.2.0` Release.

Issue #60 stays open until publication evidence is attached. Downstream
git-warp work must consume the registry artifact, not a local path override.
