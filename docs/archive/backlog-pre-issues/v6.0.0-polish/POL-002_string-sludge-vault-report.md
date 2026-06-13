# POL-002: Eliminate string sludge and boundary violation in vault-report.js

## Source
Bijou BigBro Audit (2026-04-26) — Detailed Screen Breakdown, Section 4

## What
1. **PadEnd anti-pattern:** `renderKeyValueLines` calculates max label length and calls `label.padEnd(labelWidth)`. This is manual table-rendering sludge — use Bijou `table()` with `border: 'none'` instead.
2. **View/domain mixing:** `inspectVaultHealth` executes domain queries (`cas.getVaultService()`) in the same file that exports `renderDoctorReport`. Domain logic belongs in `dashboard-cmds.js`, not the view module.

## Fix
1. Replace `padEnd` key-value rendering with `table({ border: 'none' })`.
2. Move `inspectVaultHealth` into `dashboard-cmds.js` (or a dedicated application-layer module). The view should only receive the computed report data.

## Files
- `bin/ui/vault-report.js`
- `bin/ui/dashboard-cmds.js`

## Effort
Medium
