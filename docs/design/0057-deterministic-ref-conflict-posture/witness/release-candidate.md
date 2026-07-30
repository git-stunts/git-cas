# TRUST-0057 v6.5.6 Release Candidate Witness

Date: 2026-07-30

Issue: #111

Implementation reviews: #109 and #112

Release review: #113

## Scope

This witness records the pre-publication candidate for the Bijou 7 hosted
cockpit and deterministic checked-ref conflict classification. It does not
claim that a `v6.5.6` tag, npm artifact, or GitHub Release exists. This is an
explicitly unpublished candidate.

The candidate:

- sets npm, JSR, and runtime package metadata to `6.5.6`;
- moves the framed cockpit and deterministic conflict repair from `Unreleased`
  to `6.5.6`;
- packages and links `docs/releases/v6.5.6.md`;
- records v6.5.5 publication evidence as immutable history;
- marks designs 0056 and 0057 landed after implementation merges; and
- leaves v6.5.6 tag and registry claims deliberately absent.

## Implementation Provenance

| Capability | Review anchor | Commit |
| --- | --- | --- |
| Bijou 7.2 hosted framed cockpit | #109 | `e802269ab6035eae75c2d61a8e8a898800cffbb8` |
| Deterministic checked-ref conflicts | #112 | `4327effd31c6d8ff00980512d6c59fc5064432d7` |

The cockpit change moves outer-shell authority into Bijou without changing
machine output or storage data. The ref adapter change classifies failed
checked mutations from structured post-failure posture without changing public
method signatures.

## Failure Witness

The prior adapter searched English Git diagnostics after failed atomic anchors
and checked deletes, while checked updates had no equivalent normalization.
Diagnostic-free RED tests leaked the original plumbing error for contradicted
update, anchor, and delete preconditions. The GREEN implementation observes
direct, symbolic, or absent posture and preserves the original failure whenever
that posture still satisfies the attempted precondition.

## Verification

The synced implementation merge and the versioned candidate each ran the
complete `pnpm run release:verify` method. The final versioned counts are
recorded after the candidate rerun:

| Gate | Result | Observed tests |
| --- | --- | ---: |
| Lint | PASS | - |
| Unit tests (Node) | PASS | 2,104 |
| Unit tests (Bun) | PASS | 2,103 |
| Unit tests (Deno) | PASS | 2,094 |
| Public type compatibility | PASS | - |
| Integration tests (Node) | PASS | 199 |
| Integration tests (Bun) | PASS | 199 |
| Integration tests (Deno) | PASS | 199 |
| Examples and build stamp | PASS | - |
| npm and JSR dry-runs | PASS | - |
| **Release method summary** | **PASS: 14/14 gates** | **6,898** |

Tag and publication evidence remain deliberately absent from this candidate
witness.

## Publication Gate

Publication remains blocked until the versioned candidate passes every
release-verifier step, the release PR passes GitHub CI and review, the PR is
merged, a signed annotated `v6.5.6` tag points at that reviewed merge, and the
release workflow publishes npm plus the final GitHub Release.
