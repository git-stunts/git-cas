# Retro — 0037 Scrypt Maxmem Budget Dedup

## Drift Check

- The cycle stayed tightly scoped to one duplicated formula.
- It did not reopen KDF policy or runtime-specific derive behavior.

## What Shipped

- Added one shared `scryptMaxmem` helper.
- Rewired the Node, Bun, and Web Crypto fallback derive paths to use it.
- Added a focused unit test for the shared formula.

## What Did Not

- No user-facing KDF defaults changed.
- No new runtime behavior was introduced beyond removing duplication.

## Debt

- None added. This card is closed.

## Cool Ideas

- If KDF policy ever becomes a more explicit runtime policy object, this helper
  could move beside it without changing adapter call sites again.
