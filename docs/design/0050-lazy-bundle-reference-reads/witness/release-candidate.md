# PERF-0050 v6.5.0 Release Candidate Witness

Date: 2026-07-18

Issue: #81

Review: #82

## Scope

This witness records the pre-publication release candidate for bounded lazy
bundle references and immutable metadata reads. It does not claim that a
`v6.5.0` tag, npm artifact, or GitHub Release exists. This is an explicitly
unpublished candidate.

The candidate:

- sets npm, JSR, and the runtime `PACKAGE_VERSION` export to `6.5.0`;
- moves the direct-reference API and bounded immutable reuse from `Unreleased`
  to `6.5.0`;
- packages and links `docs/releases/v6.5.0.md`;
- adds v6.4.0-to-v6.5.0 adoption guidance to `UPGRADING.md`;
- records an honest release-candidate posture in `STATUS.md`;
- preserves the v6.4.0 publication witness as immutable history; and
- records the emergency milestone resequencing without treating unfinished
  TUI, agent, or browser work as shipped.

## Implementation Provenance

| Capability                                            | Review anchor | Commit                                     |
| ----------------------------------------------------- | ------------- | ------------------------------------------ |
| Direct bundle references and immutable metadata reuse | #82           | `d5f770fb4589cd33d2244c83232ee7ede1df9ec1` |
| Empty-diagnostic RootSet conflict recovery            | #82           | `d7841acbaffbc4c5b14c78d31d3dc65ac4618cce` |
| Canonical OID and oversized-cache review repairs      | #82           | `b7695abc5d87038d9c79f42fc3c77c3580008a24` |
| Rejection settlement ordering                         | #82           | `f1d219973d40bfa8a728093d39f793c3486037ad` |

The public facade exposes direct lookup and reference iteration while preserving
the existing complete-validation APIs.

[cite: `index.js#216-224@d5f770fb4589cd33d2244c83232ee7ede1df9ec1`]
[cite: `index.d.ts#1460-1501@d5f770fb4589cd33d2244c83232ee7ede1df9ec1`]

Selected traversal validates descriptor summaries, bounded descriptor bytes,
traversed tree edges, and the direct target type without recursively resolving
the selected member's support graph.

[cite: `src/domain/services/BundleService.js#111-152@d5f770fb4589cd33d2244c83232ee7ede1df9ec1`]
[cite: `src/domain/services/BundleService.js#612-623@d5f770fb4589cd33d2244c83232ee7ede1df9ec1`]

The bounded cache removes rejected and individually oversized work before
settlement can evict valid residents. RootSet recovery compares canonical OIDs
and requires the exact failed CAS command plus an observed head advance.

[cite: `src/helpers/boundedPromiseCache.js#51-78@d5f770fb4589cd33d2244c83232ee7ede1df9ec1`]
[cite: `src/domain/services/RootSetPersistence.js#49-65@d5f770fb4589cd33d2244c83232ee7ede1df9ec1`]

## Verification

The final versioned candidate passed the complete verifier under the supported
Node.js 22 runtime:

```bash
mise exec node@22.23.0 -- pnpm run release:verify
```

| Step                        | Result | Tests |
| --------------------------- | ------ | ----: |
| Lint                        | PASS   |     - |
| Unit Tests (Node)           | PASS   | 2,020 |
| Example: store-and-restore  | PASS   |     - |
| Example: encrypted-workflow | PASS   |     - |
| Example: progress-tracking  | PASS   |     - |
| Unit Tests (Bun)            | PASS   | 2,019 |
| Unit Tests (Deno)           | PASS   | 2,010 |
| Public type compatibility   | PASS   |     - |
| Integration Tests (Node)    | PASS   |   192 |
| Integration Tests (Bun)     | PASS   |   192 |
| Integration Tests (Deno)    | PASS   |   192 |
| Build metadata stamp        | PASS   |     - |
| npm pack dry-run            | PASS   |     - |
| JSR publish dry-run         | PASS   |     - |

The verifier passed 14/14 steps with 6,625 observed tests. That verifier run's
npm dry-run contained 249 files totaling 769,785 packed bytes and 2,149,364
unpacked bytes. Supporting evidence also includes changed unit coverage at
87/87 tests, the guarded RootSet replacement stress at 500/500 two-writer
races, and GitHub CI plus CodeRabbit review with zero unresolved threads.

The command-count integration test requires an identical warm direct read to
issue zero additional Git metadata commands and requires reference iteration to
beat complete recursive validation.

[cite: `test/integration/bundle-reference-performance.test.js#111-151@d5f770fb4589cd33d2244c83232ee7ede1df9ec1`]
[cite: `scripts/diagnostics/stress-root-set-replacement.js#1-54@d5f770fb4589cd33d2244c83232ee7ede1df9ec1`]

## Publication Gate

Publication remains blocked until all of the following are true:

1. the release PR passes GitHub CI, self-review, Code Lawyer review, and the
   agreed CodeRabbit posture;
2. the release PR is merged without unresolved findings;
3. a signed annotated `v6.5.0` tag points at the reviewed merge commit;
4. the release workflow passes version validation and runtime tests;
5. npm reports `@git-stunts/git-cas@6.5.0` with provenance; and
6. GitHub reports the final non-draft `v6.5.0` Release.

Downstream git-warp adoption, runtime-scoped acquisition reuse, and its CPU and
bounded-memory performance gates remain separate post-publication evidence.
