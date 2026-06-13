# POL-017: Extract HeatmapBlock

## Source
Bijou BigBro Audit (2026-04-26) — Detailed Screen Breakdown Section 8

## What
`heatmap.js` is a custom renderer with manual grid math and hardcoded geometry. It should be a proper block component that:
- Accepts an array of values and a color scale
- Automatically calculates grid wrapping from the available Surface width
- Returns a Surface, not a string

## Fix
Create `bin/ui/blocks/heatmap-block.js`:
1. Takes `{ values: number[], width: number, colorScale?: (v: number) => string }`
2. Uses `gridSurface()` or manual Surface construction with proper cell rendering
3. Handles responsive wrapping based on available width
4. Replaces the manual `col >= width` counting and `\n` insertion

## Files
- `bin/ui/blocks/heatmap-block.js` (new)
- `bin/ui/heatmap.js` (refactor to delegate to block)

## Effort
Small
