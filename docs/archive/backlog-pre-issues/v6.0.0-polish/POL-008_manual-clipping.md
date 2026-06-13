# POL-008: Replace manual clipping with bijou clipToWidth

## Source
Bijou BigBro Audit (2026-04-26) — Scorecard V-004

## What
`dashboard-view.js` implements `tailClip` and `clip` manually instead of using `clipToWidth` from `@flyingrobots/bijou-tui`. Manual clipping doesn't account for wide characters (CJK, emoji) and breaks grapheme cluster boundaries.

## Fix
1. Replace `clip(text, width)` calls with `clipToWidth(text, width)` from bijou-tui.
2. Replace `tailClip(text, width)` with `clipToWidth(text, width, { side: 'left' })` or equivalent.
3. Delete the custom `clip` and `tailClip` helper functions.

## Files
- `bin/ui/dashboard-view.js`

## Effort
Small
