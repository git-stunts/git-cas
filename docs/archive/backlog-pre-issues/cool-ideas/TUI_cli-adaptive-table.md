# Cool Idea: Adaptive column lowering for CLI vault list

## What
`git-cas vault list` currently outputs a plain tab-separated table. Use bijou's `table()` component with automatic column hiding when the terminal is narrow — hide "Format" and "Chunks" columns first, then "Crypto" if still too tight.

## Why
The TUI dashboard already does responsive column selection in `tableSchema()`. The CLI should match. Operators in narrow terminals or piping through `less` get a usable table without horizontal scrolling.
