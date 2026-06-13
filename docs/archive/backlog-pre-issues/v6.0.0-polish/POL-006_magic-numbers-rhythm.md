# POL-006: Replace magic numbers with semantic spacing constants

## Source
Bijou BigBro Audit (2026-04-26) — Scorecard V-001, V-002; Main Audit Section 3

## What
Scattered magic numbers and inconsistent spacing throughout the TUI:
- `Math.max(32, Math.min(56, opts.width - 2))` in drawer logic
- `bodyTop = header.height` arithmetic in `renderDashboard`
- `spacer(1, 1)` and manual `'  '` padding instead of 2-cell rhythm
- Hardcoded geometry like `Math.min(60, (ctx.runtime.columns || 80) - 10)` in heatmap

## Fix
1. Define semantic spacing constants (e.g., `GAP = 2`, `PANEL_MIN_WIDTH`, `PANEL_MAX_WIDTH`).
2. Replace all hardcoded min/max width clamping with named constants.
3. Enforce the 2-cell rhythm: gaps between major sections should always be 2 cells.
4. Use `constrain()` from bijou where available instead of manual `Math.min/max` clamping.

## Files
- `bin/ui/dashboard-view.js`
- `bin/ui/heatmap.js`
- `bin/ui/vault-report.js`

## Effort
Medium
