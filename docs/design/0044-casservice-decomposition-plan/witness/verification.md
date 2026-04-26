# Witness — 0044 CasService Decomposition Plan

## Playback

1. Does `ARCHITECTURE.md` now publish an explicit `CasService` decomposition
   trajectory instead of leaving it implied?
   Yes. `ARCHITECTURE.md` now contains a dedicated decomposition trajectory
   section with the extraction order.

2. Does the plan identify both the earliest safe extractions and the work that
   must wait on platform dependency cleanup?
   Yes. The architecture truth now separates the early seams from the restore
   extraction that depends on platform ports.

3. Did the cycle stay design-first instead of turning into a speculative class
   explosion?
   Yes. No production code moved in this cycle.

## RED -> GREEN

- RED spec:
  - `test/unit/docs/architecture.decomposition.test.js`
- Green wiring:
  - `ARCHITECTURE.md`
  - `BEARING.md`

## Validation

- `npx vitest run test/unit/docs/architecture.decomposition.test.js`
- `npx eslint test/unit/docs/architecture.decomposition.test.js`
- full repo validation recorded at cycle close

## Notes

- The plan keeps the public `CasService` facade intact while making the
  internal extraction order explicit.
