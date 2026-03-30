# TR-011 — Streaming Encrypted Restore

## Legend

- [TR — Truth](../legends/TR-truth.md)

## Why This Exists

`git-cas` currently streams plaintext restores chunk-by-chunk, but encrypted or
compressed restores buffer the full payload in memory before yielding output.

That is safe and simple for the current whole-object AES-GCM format, but it
also means large encrypted restores are bounded by `maxRestoreBufferSize` and do
not yet benefit from a lower-memory temp-file streaming approach.

## Target Outcome

Produce a design-backed investigation of streaming encrypted/compressed restore,
including:

- current integrity and buffering constraints
- whether decrypt-to-temp-file plus atomic rename is the right model
- benchmark questions needed to compare memory and throughput tradeoffs

## Human Value

Maintainers and operators should be able to understand whether large encrypted
restores can become more memory-efficient without weakening integrity
guarantees.

## Agent Value

Agents should be able to reason about encrypted restore constraints and propose
bounded follow-on work without hand-waving around the current buffering model.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- distinguish plaintext streaming from encrypted/compressed restore behavior
- account for the current whole-object AES-GCM tag model
- evaluate temp-file restore semantics before considering direct-to-destination
  writes
- tie any design work to benchmark and memory observations, not intuition alone
