# INFRA-0055 v6.5.5 Release Candidate Witness

Date: 2026-07-26

Issue: #102

Implementation review: #103

Release review: #104

## Scope

This witness records the pre-publication candidate for identity-independent
git-cas-owned commits. It does not claim that a `v6.5.5` tag, npm artifact, or
GitHub Release exists. This is an explicitly unpublished candidate.

The candidate:

- sets npm, JSR, and runtime package metadata to `6.5.5`;
- moves the internal-identity repair from `Unreleased` to `6.5.5`;
- packages and links `docs/releases/v6.5.5.md`;
- records v6.5.4 publication evidence as immutable history;
- marks design 0055 landed after implementation PR #103; and
- leaves v6.5.5 tag and registry claims deliberately absent.

## Implementation Provenance

| Capability                            | Review anchor | Commit                                     |
| ------------------------------------- | ------------- | ------------------------------------------ |
| Identity-independent internal commits | #103          | `6b7f0a60d2ab9a6f776d63d50b6c4e995cffb239` |
| Reviewed implementation merge         | #103          | `fa3d5f6479b66bc09578487b33d1a55dec9e02b4` |

The adapter supplies a stable author and committer only to internal
`commit-tree` operations. It does not mutate Git configuration or extend the
public API.

## Failure Witness

A clean Linux WARP migration rehearsal promoted retained state into an
authoritative bare repository with no ambient Git identity. The subsequent
root-set write failed at `git commit-tree` with `Author identity unknown`.

The RED adapter test observed no command environment. The GREEN test observes
all four identity values, and native Git integration verifies both resulting
commit headers.

## Verification

The versioned candidate passed the complete `pnpm run release:verify` method:

| Gate                       | Result           | Observed tests |
| -------------------------- | ---------------- | -------------: |
| Lint                       | PASS             |              - |
| Unit tests (Node)          | PASS             |          2,088 |
| Unit tests (Bun)           | PASS             |          2,087 |
| Unit tests (Deno)          | PASS             |          2,078 |
| Public type compatibility  | PASS             |              - |
| Integration tests (Node)   | PASS             |            199 |
| Integration tests (Bun)    | PASS             |            199 |
| Integration tests (Deno)   | PASS             |            199 |
| Examples and build stamp   | PASS             |              - |
| npm and JSR dry-runs       | PASS             |              - |
| **Release method summary** | **PASS (14/14)** |      **6,850** |

Tag and publication evidence remain deliberately absent from this candidate
witness.

## Publication Gate

Publication remains blocked until the versioned candidate passes every local
and GitHub gate, the release PR is merged, a signed annotated `v6.5.5` tag
points at that reviewed merge, and the release workflow publishes npm and the
final GitHub Release.

After publication, git-warp must consume `6.5.5` and rerun the exact
clean-Linux retained-substrate migration proof. That downstream result is a
git-warp v19 release gate.
