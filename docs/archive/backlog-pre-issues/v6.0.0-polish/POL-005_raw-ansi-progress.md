# POL-005: Remove raw ANSI escape codes from progress.js

## Source
Bijou BigBro Audit (2026-04-26) — Detailed Screen Breakdown, Section 6

## What
`handleChunkEvent` in `progress.js` manually emits raw escape codes (`\r\x1b[K`) directly to `deps.ctx.io.write`. This breaks Bijou's cross-platform port abstraction. If `ctx.mode` changes to accessible or pipe, raw ANSI will corrupt the output stream.

## Fix
Use `ctx.writeLine()` or `ctx.updateLine()` and let the Bijou adapter handle VT100 control sequences. Never write raw ANSI in application code.

## Files
- `bin/ui/progress.js`

## Effort
Small
