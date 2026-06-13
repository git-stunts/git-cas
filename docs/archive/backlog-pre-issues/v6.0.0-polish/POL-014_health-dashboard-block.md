# POL-014: Extract HealthDashboard block

## Source
Bijou BigBro Audit (2026-04-26) — Main Audit Section 4, CLI Opportunities

## What
The `doctor` drawer and CLI `git-cas doctor` both render health reports as plain text. The audit proposes a `HealthDashboard` block with:
- `badge()` for per-entry status (pass/warn/fail)
- `timeline()` for vault commit history
- Structured layout instead of string concatenation

Currently `vault-report.js` mixes domain logic (`inspectVaultHealth`) with rendering (`renderDoctorReport`), and the output is string-based.

## Fix
Create `bin/ui/blocks/health-dashboard.js` — a Surface-based block that:
1. Takes a pre-computed health report (domain data, not raw CAS queries)
2. Renders entry status with badges
3. Renders issue list with severity indicators
4. Optionally includes a vault history timeline
5. Reusable by both the TUI drawer and CLI output

## Files
- `bin/ui/blocks/health-dashboard.js` (new)
- `bin/ui/vault-report.js` (rendering delegates to block; domain logic extracted per POL-002)

## Effort
Medium
