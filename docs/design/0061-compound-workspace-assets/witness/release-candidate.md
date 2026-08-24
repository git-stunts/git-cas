# PERF-0061 v6.5.10 Release Candidate Witness

Date: 2026-08-24

Issue: #127

Implementation review: #128

Release review: #129

## Scope

This witness records the pre-publication candidate for compound asset admission
and exact selected terminal roots. It does not claim that a `v6.5.10` tag, npm
artifact, or GitHub Release exists. This is an explicitly unpublished
candidate.

The candidate:

- sets npm, JSR, and runtime package metadata to `6.5.10`;
- moves compound workspace assets and exact roots from `Unreleased` to
  `6.5.10`;
- packages and links `docs/releases/v6.5.10.md`;
- records v6.5.9 publication evidence as immutable history;
- marks design 0061 landed after implementation review #128; and
- leaves v6.5.10 tag and registry claims deliberately absent.

## Implementation Provenance

Implementation review #128 merged normally as
`57cd300294a94660d2afb644c653a3be78c15d53`. Its second parent is exact
reviewed head `6714750620aa2310ad0279f957414be65898a66a`.

Exact implementation checkpoint
`e663754bf221784f0e5856a41fe071bebfa5befb` passed the complete release method
before the reviewed head added only the committed verification record:

| Gate                       | Result                | Observed tests |
| -------------------------- | --------------------- | -------------: |
| Lint                       | PASS                  |              - |
| Unit tests (Node)          | PASS                  |          2,192 |
| Unit tests (Bun)           | PASS                  |          2,191 |
| Unit tests (Deno)          | PASS                  |          2,182 |
| Public type compatibility  | PASS                  |              - |
| Integration tests (Node)   | PASS                  |            207 |
| Integration tests (Bun)    | PASS                  |            207 |
| Integration tests (Deno)   | PASS                  |            207 |
| Examples and build stamp   | PASS                  |              - |
| npm and JSR dry-runs       | PASS                  |              - |
| **Release method summary** | **PASS: 14/14 gates** |      **7,186** |

The versioned release-candidate tree verified below was committed as
`2a5be40c718e8069fb466af1be265357d8cb7ce0`. The following
documentation-only commit binds that immutable candidate identity into the
witness; publication still requires verification of the eventual reviewed
merge.

The versioned candidate passed the same complete release method:

| Gate                       | Result                | Observed tests |
| -------------------------- | --------------------- | -------------: |
| Lint                       | PASS                  |              - |
| Unit tests (Node)          | PASS                  |          2,194 |
| Unit tests (Bun)           | PASS                  |          2,193 |
| Unit tests (Deno)          | PASS                  |          2,184 |
| Public type compatibility  | PASS                  |              - |
| Integration tests (Node)   | PASS                  |            207 |
| Integration tests (Bun)    | PASS                  |            207 |
| Integration tests (Deno)   | PASS                  |            207 |
| Examples and build stamp   | PASS                  |              - |
| npm and JSR dry-runs       | PASS                  |              - |
| **Release method summary** | **PASS: 14/14 gates** |      **7,192** |

## Semantic and Process Witness

The direct git-cas SHA-1/SHA-256 integration proof preserves application
handles, transitive readback after immediate prune, one exact final workspace
generation, and later reclamation with only the selected terminal roots held
directly.

A controlled downstream git-warp prototype compared the same 65-node,
65-patch corpus plus a five-patch suffix across one warmup and three measured
runs per scenario:

| Scenario    | Git commands | Median CPU ms | Median wall ms |
| ----------- | -----------: | ------------: | -------------: |
| Cold before |          139 |       545.476 |      2,822.893 |
| Cold after  |           50 |       322.103 |      1,328.603 |
| Incr before |          149 |       555.478 |      3,039.536 |
| Incr after  |           60 |       320.050 |      1,387.245 |
| Warm before |           25 |       166.882 |        548.191 |
| Warm after  |           25 |       176.325 |        622.956 |

Semantic fingerprints, cache posture, and replay counts match. The warm path
does not materialize writes and retains the exact 25-command topology. These
consumer measurements justify the candidate API but remain provisional until
rerun against the public v6.5.10 registry artifact.

## Compatibility and Publication Gate

The release is additive and migration-free. Existing stored objects, handles,
descriptors, ref layouts, readers, workspace generations, and retain-all calls
remain compatible without rewriting or cutover.

Publication remains blocked until release PR #129 passes hosted CI and review,
the exact reviewed merge passes verification, a signed annotated `v6.5.10` tag
peels to that merge, and the release workflow publishes npm plus the final
GitHub Release.
