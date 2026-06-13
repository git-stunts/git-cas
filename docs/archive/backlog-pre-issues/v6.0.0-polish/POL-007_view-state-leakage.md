# POL-007: Move slicing/viewport logic out of render functions

## Source
Bijou BigBro Audit (2026-04-26) — Scorecard, Main Audit Section 1

## What
Slicing and scrolling logic is found in render functions rather than domain selectors:
- `buildRefsViewport` computes visible window slicing in the view layer
- Various render functions compute `focusRow`, `scrollY` clamping inline

The View should only receive the *result* of the filter/slice, not compute it.

## Fix
1. Move `buildRefsViewport` logic into a selector function in `dashboard.js` (model layer).
2. Ensure render functions receive pre-sliced, pre-clamped data — no viewport arithmetic in the view.

## Files
- `bin/ui/dashboard-view.js`
- `bin/ui/dashboard.js`

## Effort
Medium
