# TR-002 — Threat Model

## Legend

- [TR — Truth](../legends/TR-truth.md)

## Why This Exists

`git-cas` has meaningful security behavior, but
[SECURITY.md](../../SECURITY.md) is not the same thing as a threat model.
Operators still need explicit answers about what is protected, what is exposed,
and which compromises are out of scope.

## Target Outcome

Add [docs/THREAT_MODEL.md](../THREAT_MODEL.md) with explicit attacker models,
trust boundaries, non-goals, and operator responsibilities.

## Human Value

Operators should be able to decide whether `git-cas` is appropriate for a given
repository and threat environment without inferring guarantees from marketing or
implementation details.

## Agent Value

Agents should be able to reason about security posture and cite the repo's
actual guarantees and non-guarantees during implementation and review.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- cover vault ref exposure without passphrase disclosure
- cover recipient-based encryption and passphrase-based vault protection
- document what Git object retention, working tree exposure, and host
  compromise mean for the security model
- separate design goals from operator duties and non-goals
