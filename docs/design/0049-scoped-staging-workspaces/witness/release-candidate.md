# PERF-0049 v6.4.0 Release Candidate Witness

Date: 2026-07-17

Issues: #75, #77

## Scope

This witness records the pre-publication release candidate for scoped staging
workspaces. It does not claim that a `v6.4.0` tag, npm artifact, or GitHub
Release exists yet. This is an explicitly unpublished candidate.

The candidate:

- sets npm, JSR, and the runtime `PACKAGE_VERSION` export to `6.4.0`;
- moves scoped staging workspaces from `Unreleased` to `6.4.0`;
- packages and links `docs/releases/v6.4.0.md`;
- adds v6.3.0-to-v6.4.0 adoption guidance to `UPGRADING.md`;
- records an honest release-candidate posture in `STATUS.md`;
- preserves the v6.3.0 publication witness as immutable history; and
- aligns repository roadmap links with the explicitly retargeted GitHub
  milestones.

## Implementation Provenance

| Capability | Review anchor | Commit |
| --- | --- | --- |
| Scoped staging workspaces | #76 | `1ac2fc85be857ca769c459b89c29bf4483b3f304` |
| Structured RootSet lock retry | #77 | `8185dfb9819909d9fbe0f0394de6ae31fc0a94a3` |
| Exact lock command validation | #78 | `d1e126952d70007313a2ecd39bc7cffda06a9edd` |

The retry correction recognizes a structured Git lock only when the captured
argument vector proves an exact `update-ref --no-deref` operation against the
managed RootSet ref. Locks for other refs remain non-conflict failures.
[cite: `src/domain/services/RootSetPersistence.js#13-36@d1e126952d70007313a2ecd39bc7cffda06a9edd`]
[cite: `src/domain/services/RootSetPersistence.js#275-295@d1e126952d70007313a2ecd39bc7cffda06a9edd`]
[cite: `test/unit/domain/services/RootSetPersistence.test.js#150-193@d1e126952d70007313a2ecd39bc7cffda06a9edd`]

## Verification

The release candidate passed the complete verifier:

```bash
pnpm run release:verify
```

| Step | Result | Tests |
| --- | --- | ---: |
| Lint | PASS | - |
| Unit Tests (Node) | PASS | 1,993 |
| Example: store-and-restore | PASS | - |
| Example: encrypted-workflow | PASS | - |
| Example: progress-tracking | PASS | - |
| Unit Tests (Bun) | PASS | 1,992 |
| Unit Tests (Deno) | PASS | 1,983 |
| Public type compatibility | PASS | - |
| Integration Tests (Node) | PASS | 190 |
| Integration Tests (Bun) | PASS | 190 |
| Integration Tests (Deno) | PASS | 190 |
| Build metadata stamp | PASS | - |
| npm pack dry-run | PASS | - |
| JSR publish dry-run | PASS | - |

The verifier passed 14/14 steps with 6,538 observed tests. A final npm dry-run
after the release prose was frozen produced `git-stunts-git-cas-6.4.0.tgz`
with 247 files, 763,925 packed bytes, and 2,129,717 unpacked bytes.

An initial candidate run stopped during Node integration when a structured Git
lock escaped RootSet conflict normalization. Issue #77 converted that
nondeterministic observation into direct positive and negative unit coverage.
After correction, the focused RootSet suite passed 16/16, lint passed, twenty
repeated real-Git ExpiringSet concurrency runs passed, and the complete
verifier passed as recorded above.

## Publication Gate

Publication remains blocked until all of the following are true:

1. the release PR passes GitHub CI, self-review, Code Lawyer review, and the
   agreed CodeRabbit posture;
2. the release PR is merged without unresolved findings;
3. a signed annotated `v6.4.0` tag points at the reviewed merge commit;
4. the release workflow passes version validation and runtime tests;
5. npm reports `@git-stunts/git-cas@6.4.0` with provenance; and
6. GitHub reports the final non-draft `v6.4.0` Release.

Issue #75 stays open until publication evidence is attached. The downstream
git-warp registry upgrade and unchanged performance gate remain separate
adoption evidence after publication.
