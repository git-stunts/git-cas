# POL-004: Extract git commit parsing from history-timeline.js

## Source
Bijou BigBro Audit (2026-04-26) — Detailed Screen Breakdown, Section 5

## What
`parseCommitLine` in `history-timeline.js` executes regex parsing of Git commit messages (`/^vault:\s*(init|add|update|remove)\s*(.*)$/`) directly inside the UI module. Parsing Git stdout is a pure infrastructure adapter concern.

The function also returns a concatenated string instead of a Surface.

## Fix
1. Extract `parseCommitLine` into the git adapter layer (`src/infrastructure/` or `dashboard-cmds.js`).
2. Have the view function accept an array of typed `VaultCommitEvent` objects.
3. Return a composed Surface instead of string concatenation.

## Files
- `bin/ui/history-timeline.js`
- `bin/ui/dashboard-cmds.js` (or `src/infrastructure/`)

## Effort
Medium
