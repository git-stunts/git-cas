# PERF-0060 v6.5.9 Release Candidate Witness

Date: 2026-08-24

Issue: #123

Implementation review: #124

Release review: pending

## Scope

This witness records the pre-publication candidate for compound
staging-workspace admission. It does not claim that a `v6.5.9` tag, npm
artifact, or GitHub Release exists. This is an explicitly unpublished
candidate.

The candidate:

- sets npm, JSR, and runtime package metadata to `6.5.9`;
- moves compound workspace admission from `Unreleased` to `6.5.9`;
- packages and links `docs/releases/v6.5.9.md`;
- records v6.5.8 publication evidence as immutable history;
- marks design 0060 landed after implementation review #124; and
- leaves v6.5.9 tag and registry claims deliberately absent.

## Implementation Provenance

Implementation review #124 merged normally as
`eb8d617620fa8f401fb887f5b1bbc341d4746b0a`. Its second parent is exact
reviewed head `29ba6e88c787a5e54c95a554e9166fd21aae31c0`.

That exact implementation head passed the complete release method:

| Gate                       | Result                | Observed tests |
| -------------------------- | --------------------- | -------------: |
| Lint                       | PASS                  |              - |
| Unit tests (Node)          | PASS                  |          2,177 |
| Unit tests (Bun)           | PASS                  |          2,176 |
| Unit tests (Deno)          | PASS                  |          2,167 |
| Public type compatibility  | PASS                  |              - |
| Integration tests (Node)   | PASS                  |            207 |
| Integration tests (Bun)    | PASS                  |            207 |
| Integration tests (Deno)   | PASS                  |            207 |
| Examples and build stamp   | PASS                  |              - |
| npm and JSR dry-runs       | PASS                  |              - |
| **Release method summary** | **PASS: 14/14 gates** |      **7,141** |

Versioned candidate verification: pending. The committed versioned tree must
pass the same method before this release review can become ready.

## Semantic and Process Witness

Five counterbalanced samples compare the same 33-operation, 81-handle graph
under per-wave and compound admission in fresh SHA-1 and SHA-256 repositories.
Every ordered application-handle digest matches.

| Object format | Git children | Git interactions | Median wall reduction |
| ------------- | -----------: | ---------------: | --------------------: |
| SHA-1         |    200 -> 23 |       380 -> 238 |               80.522% |
| SHA-256       |    200 -> 23 |       380 -> 238 |               80.405% |

Compound admission reduces 33 retained workspace generations to one. The
remaining 18 `mktree` children preserve Git validation across dependent
descriptor-pack visibility boundaries and are not bypassed by this release.

## Compatibility and Publication Gate

The release is additive and migration-free. Existing application handles,
stored object bytes, descriptor schemas, ref namespaces, workspace methods,
readers, and repositories remain compatible without rewriting or cutover.

Publication remains blocked until the versioned candidate passes the full
release method, the release PR passes hosted CI and review, the exact reviewed
merge passes verification, a signed annotated `v6.5.9` tag peels to that merge,
and the release workflow publishes npm plus the final GitHub Release.
