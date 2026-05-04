# POL-003: Eliminate string sludge in encryption-card.js

## Source
Bijou BigBro Audit (2026-04-26) — Detailed Screen Breakdown, Section 7

## What
`encryption-card.js` pushes strings into an array and joins with `\n`. It also calls `surfaceToString(badge(...))` to coerce a 2D Surface back into a 1D string for concatenation — this is expensive and destroys layout invariants.

## Fix
1. Return a `boxSurface()` or composed `Surface` instead of a string.
2. Use `hstackSurface` for inline label + badge layout instead of string coercion.

## Files
- `bin/ui/encryption-card.js`

## Effort
Small
