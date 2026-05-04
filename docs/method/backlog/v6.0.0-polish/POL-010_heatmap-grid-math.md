# POL-010: Replace manual grid math in heatmap.js

## Source
Bijou BigBro Audit (2026-04-26) — Detailed Screen Breakdown, Section 8

## What
`heatmap.js` calculates grid wrapping manually by counting `col >= width` and inserting `\n`. It also uses hardcoded geometry: `Math.min(60, (ctx.runtime.columns || 80) - 10)`.

## Fix
1. Use Bijou's `grid()` or `gridSurface()` layout primitive to handle wrapping automatically.
2. Replace hardcoded width with `constrain()` or named constants.

## Files
- `bin/ui/heatmap.js`

## Effort
Small
