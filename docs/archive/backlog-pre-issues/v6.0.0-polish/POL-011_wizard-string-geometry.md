# POL-011: Fix string-based geometry in store-wizard.js

## Source
Bijou BigBro Audit (2026-04-26) — Detailed Screen Breakdown, Section 2

## What
`renderWizardSurface` counts lines via `body.split('\n').length` to calculate panel height. This is a "Geometric Lawfulness" violation — height should be calculated by the layout engine, not by splitting strings.

Additionally, the wizard manually injects `\n` for spacing and uses string concatenation for focus cursors.

## Fix
1. Use `parseAnsiToSurface` height or `Surface.measure` for geometry instead of line counting.
2. Replace manual `lines.push('')` spacing with `vstackSurface` gap or `separator`.
3. Use `browsableList` from bijou-tui for selection lists instead of manual `renderSelectList`.

## Files
- `bin/ui/store-wizard.js`

## Effort
Medium
