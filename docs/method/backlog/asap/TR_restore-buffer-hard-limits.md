# TR — Restore Buffer Hard Limits

## Why This Exists

`maxRestoreBufferSize` is currently a soft planning guard, not a hard memory
boundary.

The buffered restore path still reads whole chunk blobs before validating their
actual size and only checks decompressed size after full `gunzip()`. That
leaves room for oversized blob reads and decompression bombs to overshoot the
configured limit before `git-cas` notices.

## Target Outcome

Design and land real restore memory boundaries that:

- bound actual blob-read sizes, not only manifest-declared sizes
- bound decompression behavior before full output materialization
- keep encrypted and compressed restore failures explicit and testable
- preserve the current integrity guarantees

## Human Value

Operators should be able to treat restore size limits as real safety controls
instead of advisory documentation.

## Agent Value

Agents should be able to reason about restore memory safety from executable
tests instead of caveats buried in implementation details.

## Notes

- include both encrypted restore and compressed restore paths
- account for malicious manifests that point at unexpectedly large blob objects
- distinguish true hard limits from current preflight estimates
