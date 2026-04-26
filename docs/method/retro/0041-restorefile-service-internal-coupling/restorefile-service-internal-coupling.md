# Retro — 0041 RestoreFile Service Internal Coupling

## Drift Check

- The cycle stayed on the file-restore seam.
- It did not broaden into a generic `CasService` decomposition effort.

## What Shipped

- Added `CasService.createFileRestorePlan()`.
- Rewired `FileIOHelper.restoreFile()` to consume the named plan.
- Added focused adapter coverage proving bounded publication no longer depends
  on underscore helpers.

## What Did Not

- No restore semantics changed.
- No other service boundaries were moved in this cycle.

## Debt

- None added. This card is closed.

## Cool Ideas

- The same “named plan” pattern could later be used for other adapter seams
  that currently infer service internals from helper calls.
