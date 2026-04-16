# TR — Dual Encryption Modes

## Why This Exists

`git-cas` currently uses one whole-object AES-GCM envelope model. That keeps
the integrity boundary simple, but it also means authenticated restore is
buffered for encrypted content.

The clean future shape may be to support two explicit modes instead of
pretending one format can satisfy both goals equally well:

- a compatibility-oriented whole-object mode
- a framed authenticated mode for bounded streaming restore

## Target Outcome

Investigate whether `git-cas` should expose explicit encryption schemes such as:

- `whole-v1` for the current all-or-nothing envelope
- `framed-v1` for authenticated frame-by-frame restore

The work should make the tradeoffs explicit:

- authenticity boundary
- metadata overhead
- Web Crypto behavior
- streaming restore semantics
- compatibility and migration strategy

## Human Value

Operators should be able to choose between simpler whole-object encryption and
true authenticated streaming based on their workload rather than discovering the
difference accidentally through buffering behavior.

## Agent Value

Agents should be able to discuss future encrypted streaming work in terms of
explicit formats and guarantees instead of vague “make decrypt streaming”
language.

## Notes

- this is deliberately broader than the current streaming-encrypted-restore
  backlog note
- keep any future design explicit about integrity semantics, not just
  throughput and memory
