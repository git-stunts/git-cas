# 0044-casservice-decomposition-plan

## Title

Publish the `CasService` decomposition order before extracting more seams

## Why

`CasService` is still the dominant orchestration unit in `git-cas`. That is not
automatically a bug, but it does make future change riskier unless the repo has
an explicit extraction order and clear non-goals.

Without that plan, “decomposition” stays vague and every refactor risks turning
into class-count churn instead of an intentional boundary improvement.

## Decision

Close this debt item with a design-backed extraction order rather than a
speculative refactor. Publish the plan in `ARCHITECTURE.md` and align
`BEARING.md` so future work can pull bounded seams in order.

## Scope

This cycle covers:

- identifying the stable `CasService` seams worth extracting
- ordering those seams by risk and dependency
- documenting which work must wait on platform dependency cleanup

This cycle does not cover:

- extracting the seams immediately
- public API changes
- moving Node stream or zlib coupling out of the domain

## Playback Questions

1. Does `ARCHITECTURE.md` now publish an explicit `CasService` decomposition
   trajectory instead of leaving it implied?
2. Does the plan identify both the earliest safe extractions and the work that
   must wait on platform dependency cleanup?
3. Did the cycle stay design-first instead of turning into a speculative class
   explosion?

## Red Tests

The executable spec will live in:

- `test/unit/docs/architecture.decomposition.test.js`

## Green Shape

The repo should have one explicit decomposition order:

1. store write coordination
2. manifest/tree publication
3. recipient mutation flows
4. restore pipeline extraction only after platform ports exist

The public `CasService` facade stays intact while those internal seams are
pulled one by one.
