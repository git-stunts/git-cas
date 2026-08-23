# PERF-0058 v6.5.7 Release Candidate Witness

Date: 2026-08-23

Issue: #115

Implementation review: #116

Release review: #117

## Scope

This witness records the pre-publication candidate for bounded session-backed
small stream reads. It does not claim that a `v6.5.7` tag, npm artifact, or
GitHub Release exists. This is an explicitly unpublished candidate.

The candidate:

- sets npm, JSR, and runtime package metadata to `6.5.7`;
- moves bounded stream-session reads from `Unreleased` to `6.5.7`;
- packages and links `docs/releases/v6.5.7.md`;
- records v6.5.6 publication evidence as immutable history;
- marks design 0058 landed after implementation merge #116; and
- leaves v6.5.7 tag and registry claims deliberately absent.

## Implementation Provenance

| Capability | Review anchor | Commit |
| --- | --- | --- |
| Bounded stream-session route | #116 | `135a8ff416b12e6abede0b0f78a3e6ba00ca1255` |
| Deterministic process witness | #116 | `a34762c9ef1cf0bf4f717d2892d1ca0744f7e762` |
| Failure-safe real-Git cleanup | #116 | `c344d119fd2afb5f7c024b4912714acbfd156768` |

Implementation review #116 merged normally as
`1e30740c8670bf42b8bb863f8feb99a5e0f0f29b`. Its second parent is the exact
reviewed head `c344d119fd2afb5f7c024b4912714acbfd156768`.

## Failure Witness

At the RED commit, repeated `readBlobStream()` calls still opened one one-shot
`cat-file` child per blob and never used the typed session content path. The
GREEN witness uses 32 deterministic 4,096-byte objects: fallback opens 32
children, the session route opens one child, and both routes produce the same
semantic digest.

The 10 MiB + 1 byte case opens one persistent child for metadata and exactly
one one-shot child for content. It performs no session content read and leaves
no active session after close.

## Verification

The implementation tree and the versioned release candidate each ran the
complete `npm run release:verify` method. Final candidate counts are:

| Gate | Result | Observed tests |
| --- | --- | ---: |
| Lint | PASS | - |
| Unit tests (Node) | PASS | 2,109 |
| Unit tests (Bun) | PASS | 2,108 |
| Unit tests (Deno) | PASS | 2,099 |
| Public type compatibility | PASS | - |
| Integration tests (Node) | PASS | 202 |
| Integration tests (Bun) | PASS | 202 |
| Integration tests (Deno) | PASS | 202 |
| Examples and build stamp | PASS | - |
| npm and JSR dry-runs | PASS | - |
| **Release method summary** | **PASS: 14/14 gates** | **6,922** |

Tag and publication evidence remain deliberately absent from this candidate
witness.

## Publication Gate

Publication remains blocked until the release PR passes GitHub CI and review,
merges normally, the exact merged candidate passes full release verification,
a signed annotated `v6.5.7` tag peels to that reviewed merge, and the release
workflow publishes npm plus the final GitHub Release.
