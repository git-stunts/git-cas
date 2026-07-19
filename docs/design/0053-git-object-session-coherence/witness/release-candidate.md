# PERF-0053 v6.5.3 Release Candidate Witness

Date: 2026-07-19

Issue: #94

Implementation review: #95

Release review: pending

## Scope

This witness records the pre-publication release candidate for coherent Git
object session reuse. It does not claim that a `v6.5.3` tag, npm artifact, or
GitHub Release exists. This is an explicitly unpublished candidate.

The candidate:

- sets npm, JSR, and the runtime `PACKAGE_VERSION` export to `6.5.3`;
- moves the single session-coherence correction from `Unreleased` to `6.5.3`;
- packages and links `docs/releases/v6.5.3.md`;
- adds v6.5.2-to-v6.5.3 compatibility guidance to `UPGRADING.md`;
- marks design 0053 landed and records its release-candidate posture;
- preserves all v6.5.2 publication evidence as immutable history; and
- leaves tag and registry publication claims deliberately absent.

## Implementation Provenance

| Capability                         | Review anchor | Commit                                     |
| ---------------------------------- | ------------- | ------------------------------------------ |
| Selective object-session retention | #95           | `9208871802a596cbc508be725353532110d40198` |
| Audited witness and measurements   | #95           | `df05c4e40915fc510797e96c793f0e5f32889972` |
| Final review repair                | #95           | `7adeabe950a3c841caffd1a3a4f82a696df86e71` |
| Reviewed feature merge             | #95           | `7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98` |

The adapter preserves `cat-file` across successful immutable writes, preserves
`mktree` across loose writes, and retains the mandatory `mktree` retirement
barrier after a bounded `fast-import` batch.

[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#93-175@7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98`]

The unit retirement matrix and real-Git integration prove coherent reuse and
mandatory refresh behavior in SHA-1 and SHA-256 repositories.

[cite: `test/unit/infrastructure/adapters/GitPersistenceAdapter.sessionCoherence.test.js#6-45@7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98`]
[cite: `test/integration/git-object-session-coherence.test.js#24-60@7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98`]

No public export, declaration, stored format, object identity, retention
policy, ref authority, idle bound, or explicit-close behavior changed.

## Verification

The versioned candidate passed the complete `pnpm run release:verify` method:

| Gate                       | Result           | Observed tests |
| -------------------------- | ---------------- | -------------: |
| Lint                       | PASS             |              - |
| Unit tests (Node)          | PASS             |          2,082 |
| Unit tests (Bun)           | PASS             |          2,081 |
| Unit tests (Deno)          | PASS             |          2,072 |
| Public type compatibility  | PASS             |              - |
| Integration tests (Node)   | PASS             |            198 |
| Integration tests (Bun)    | PASS             |            198 |
| Integration tests (Deno)   | PASS             |            198 |
| Examples and build stamp   | PASS             |              - |
| npm and JSR dry-runs       | PASS             |              - |
| **Release method summary** | **PASS (14/14)** |      **6,829** |

The implementation PR merged only after GitHub lint and all Node/Bun/Deno jobs
passed, CodeRabbit approved the exact head commit, thread-aware review found no
review threads, and the complete diff received a clean self-review. Tag and
publication evidence remain deliberately absent from this candidate witness.

## Publication Gate

Publication remains blocked until all of the following are true:

1. the versioned candidate passes every release-verifier step;
2. the release PR passes GitHub CI, self-review, Code Lawyer review, and the
   agreed CodeRabbit posture;
3. the release PR is merged without unresolved findings;
4. a signed annotated `v6.5.3` tag points at the reviewed merge commit;
5. the release workflow passes version validation and runtime tests;
6. npm reports `@git-stunts/git-cas@6.5.3` with provenance; and
7. GitHub reports the final non-draft `v6.5.3` Release.

Downstream git-warp adoption and its process-tree CPU, wall-clock,
Git-command, and bounded-memory evidence remain separate post-publication
obligations.
