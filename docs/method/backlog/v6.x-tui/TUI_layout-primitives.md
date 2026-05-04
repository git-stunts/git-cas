# TUI-006: Layout primitives (hstack/vstack/flex/grid)

## What

Replace manual surface position arithmetic in `dashboard-view.js` with Bijou v5 layout primitives (`hstack`, `vstack`, `flex`, `grid`). The split pane already uses `splitPaneLayout`, but the header, footer, body composition, overlay positioning, and sub-pane layouts all compute x/y offsets manually. Layout primitives make this declarative.

## Why

`dashboard-view.js` is 1429 lines, and a significant portion is manual layout math: computing `bodyTop`, `bodyHeight`, `cursorY`, blit offsets for header/body/footer stacking, inline badge positioning via `blitInline()`, overlay centering, toast stacking positions, and responsive column selection in `tableSchema()`. This manual math is fragile — off-by-one errors on resize, inconsistent padding, and duplicated height calculations. Layout primitives express intent ("stack these vertically, this one fills remaining space") rather than pixel arithmetic.

## Current State

- `renderDashboard()` (lines 1414–1429) — manually computes `bodyTop = header.height`, `bodyHeight = height - header.height - footer.height`, blits header at y=0, body at y=bodyTop, footer at y=height-footer.height.
- `renderBody()` (lines 1351–1373) — uses `splitPaneLayout` (good), but manually blits panes and divider with computed offsets.
- `renderHeaderSurface()` (lines 203–231) — manually blits title, subtitle, badges at hardcoded y offsets (0, 1, 2, 3).
- `blitInline()` (lines 77–93) — custom horizontal layout helper that manually tracks a cursor position.
- `renderOverlays()` (lines 1383–1405) — manually centers palette, right-aligns drawers, stacks toasts.
- `renderTreemapView()`, `renderRefsView()` — manual sidebar/main split math.

## Design

### Bijou v5 Components Used

- `vstack(children, options)` — vertical stack layout
- `hstack(children, options)` — horizontal stack layout
- `flex(children, options)` — flex layout with grow/shrink
- `grid(children, options)` — grid layout for regular arrangements

### Implementation Plan

1. **Main layout**: Replace the manual header/body/footer composition in `renderDashboard()` with `vstack([header, flex(body, { grow: 1 }), footer])`. The body fills remaining vertical space.
2. **Header**: Replace the hardcoded y=0,1,2,3 blit calls in `renderHeaderSurface()` with `vstack([titleRow, subtitleRow, badgeRow, ruleRow])`.
3. **Badge row**: Replace `blitInline()` with `hstack(badgeSurfaces, { gap: 1 })` for horizontal badge layout.
4. **Body split**: Keep `splitPaneLayout` for the main split pane (it already works well), but use `hstack` for the treemap sidebar/main split and refs sidebar/main split.
5. **Overlay positioning**: Use `flex` with alignment options (`align: 'center'`, `justify: 'center'`) for palette centering. Use `align: 'end'` for right-aligned drawers.
6. **Delete `blitInline()`** — fully replaced by `hstack`.
7. Apply changes incrementally — start with the outer `renderDashboard()` composition, then work inward to sub-layouts.

### Files Modified

- `bin/ui/dashboard-view.js` — refactor `renderDashboard()`, `renderHeaderSurface()`, `renderBody()`, `renderOverlays()`, `renderTreemapView()`, `renderRefsView()`; delete `blitInline()`

### Dependencies

- TUI-001 (framed app shell — outer frame changes how renderDashboard composes)
- TUI-003 (status bar changes footer composition)

## Acceptance Criteria

- [ ] `renderDashboard()` uses `vstack` or `flex` for header/body/footer composition
- [ ] `renderHeaderSurface()` uses `vstack` for row stacking
- [ ] Badge rows use `hstack` instead of `blitInline()`
- [ ] `blitInline()` is deleted
- [ ] Manual `bodyTop`, `bodyHeight` arithmetic is eliminated from `renderDashboard()`
- [ ] Overlay centering uses layout primitives instead of `Math.floor((width - palette.width) / 2)`
- [ ] Dashboard renders identically at all tested terminal sizes (80x24, 120x40, 200x60)
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Large
