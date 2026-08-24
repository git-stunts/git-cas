# PERF-0059 v6.5.8 Release Candidate Witness

Date: 2026-08-23

Issue: #119

Implementation review: #120

Release review: #121

## Scope

This witness records the pre-publication candidate for bounded application
write waves and one-generation workspace batching. It does not claim that a
`v6.5.8` tag, npm artifact, or GitHub Release exists. This is an explicitly
unpublished candidate.

The candidate:

- sets npm, JSR, and runtime package metadata to `6.5.8`;
- moves bounded write-wave behavior from `Unreleased` to `6.5.8`;
- packages and links `docs/releases/v6.5.8.md`;
- records v6.5.7 publication evidence as immutable history;
- marks design 0059 landed after implementation merge #120; and
- leaves v6.5.8 tag and registry claims deliberately absent.

## Implementation Provenance

| Capability                         | Review anchor | Commit                                     |
| ---------------------------------- | ------------- | ------------------------------------------ |
| Typed Plumbing batch adoption      | #120          | `4671f8513a0fa1aced8e17a0b57fe86460fc914b` |
| Public asset and bundle waves      | #120          | `fde524e787505d470b5c61026c6bf1a6b109b35a` |
| Cross-wave writer reuse            | #120          | `3c211b7e5fab3c6f73c905bb6781ed56aa706e13` |
| Final manifest-tree wave           | #120          | `63b49156e0f2904c0656e5bb29b976684e659345` |
| Released Plumbing 3.3.0 pin        | #120          | `f34acd0ef6b37e23df4c50542279bad136fbb848` |
| Review hardening and decomposition | #120          | `8badb3194d1bed66e79dff1355cfcc765078ca11` |

Implementation review #120 merged normally as
`a762a02ca9270b2ace05b98a3d3025c61927de2c`. Its second parent is the exact
reviewed head `8badb3194d1bed66e79dff1355cfcc765078ca11`.

## Semantic and Process Witness

The released-Plumbing witness compares repeated singles with bounded batches
in five counterbalanced samples for both SHA-1 and SHA-256 repositories. Every
complete input-ordered handle digest matches.

| Operation                    | Git children | Typed interactions | Median wall reduction |
| ---------------------------- | -----------: | -----------------: | --------------------: |
| 16 SHA-1 assets              |      49 -> 2 |           64 -> 19 |               87.137% |
| 16 SHA-256 assets            |      49 -> 2 |           64 -> 19 |               86.673% |
| 16 SHA-1 workspace bundles   |     147 -> 8 |          224 -> 13 |               91.047% |
| 16 SHA-256 workspace bundles |     147 -> 8 |          224 -> 13 |               90.930% |

The stable release gate is identical handles plus repeated process and protocol
topology. Wall time and worker CPU are supporting host observations.

## Failure and Reachability Witness

Focused tests reject missing and surplus batch results, preserve frozen source
errors through typed wrappers, validate positive safe manifest thresholds,
retain sequential adapter fallbacks, close failed update-ref sessions, and
route blobs above the 64 MiB session ceiling through the one-shot writer.

The real-Git matrix stages asset and bundle batches, prunes immediately,
restores retained content, releases the workspace, prunes again, and observes
released bundle roots become collectible. No test treats partial immutable
object creation as a complete batch result.

## Verification

The exact reviewed implementation head passed the complete release method with
7,054 observed tests. The versioned release candidate then passed the same
14-stage method with these final candidate counts:

| Gate                       | Result                | Observed tests |
| -------------------------- | --------------------- | -------------: |
| Lint                       | PASS                  |              - |
| Unit tests (Node)          | PASS                  |          2,153 |
| Unit tests (Bun)           | PASS                  |          2,152 |
| Unit tests (Deno)          | PASS                  |          2,143 |
| Public type compatibility  | PASS                  |              - |
| Integration tests (Node)   | PASS                  |            203 |
| Integration tests (Bun)    | PASS                  |            203 |
| Integration tests (Deno)   | PASS                  |            203 |
| Examples and build stamp   | PASS                  |              - |
| npm and JSR dry-runs       | PASS                  |              - |
| **Release method summary** | **PASS: 14/14 gates** |      **7,057** |

Tag and publication evidence remain deliberately absent from this candidate
witness.

## Publication Gate

Publication remains blocked until the release PR passes GitHub CI and review,
merges normally, the exact merged candidate passes full release verification,
a signed annotated `v6.5.8` tag peels to that reviewed merge, and the release
workflow publishes npm plus the final GitHub Release.
