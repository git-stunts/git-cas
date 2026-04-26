# Retro — 0042 Store Write Failure Surface

## Drift Check

- The cycle stayed on write-side store error normalization.
- It did not reopen stream-source handling or broader service decomposition.

## What Shipped

- Added an explicit `STORE_ERROR` surface for raw write failures.
- Preserved `CasError` write codes while enriching them with write-phase
  metadata.
- Added focused RED/GREEN tests for the chosen contract.

## What Did Not

- Source failures still use `STREAM_ERROR`.
- Restore behavior did not change.

## Debt

- None added. This card is closed.

## Cool Ideas

- If later persistence adapters need richer sink diagnostics, the same metadata
  envelope can carry adapter-specific hints without changing the top-level
  contract again.
