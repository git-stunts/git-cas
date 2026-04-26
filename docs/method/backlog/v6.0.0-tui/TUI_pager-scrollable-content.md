# TUI-010: Pager for long content

## What

Use Bijou v5's `pager` component for scrollable long content in the detail pane, doctor report drawer, stats drawer, and any other view that can exceed the visible terminal height. Currently these views render at fixed height and truncate silently. A `pager` with `pagerScrollBy`, `pagerPageDown/Up` makes all long content scrollable with a visible scroll indicator.

## Why

The manifest inspector already has a rudimentary scroll mechanism — `model.detailScroll` tracked in `DashModel`, incremented by `shift+j`/`shift+k` keybindings, applied as a blit offset in `renderDetailPane()` (line 927: `content.blit(manifestSurface, 0, bodyTop, 0, model.detailScroll, ...)`). But this is hand-rolled, has no scroll position indicator, no bounds checking beyond a `Math.max(0, ...)` clamp, and doesn't exist at all for the doctor report or stats drawers — those views simply truncate when they exceed the panel height. The chunk table in `manifest-view.js` also hard-caps at 20 rows (line 93: `chunks.slice(0, 20)`) because there's no way to scroll further.

## Current State

- `dashboard.js` — `model.detailScroll` field, `scroll-detail` action, `shift+j`/`shift+k` keybindings (delta: 3)
- `dashboard-view.js` line 927 — `content.blit(manifestSurface, 0, bodyTop, 0, model.detailScroll, innerWidth, bodyHeight)` applies scroll offset
- `manifest-view.js` line 93 — `chunks.slice(0, 20)` hard-limits chunk display
- `vault-report.js` — `renderDoctorReport()` and `renderVaultStats()` return strings with no scroll capability
- Stats and doctor drawers (`renderStatsDrawer`, `renderDoctorDrawer`) render into fixed-height `renderOverlayPanel` boxes

## Design

### Bijou v5 Components Used

- `pager(content, options)` — wraps content in a scrollable viewport with position tracking
- `pagerScrollBy(state, delta)` — scroll by N lines
- `pagerPageDown(state)` / `pagerPageUp(state)` — page-sized scroll
- `pagerScrollTo(state, line)` — jump to a specific line
- Scroll indicator (bar or percentage) rendered by the pager component

### Implementation Plan

1. Replace `model.detailScroll` with a `pager` state object in `DashModel`. Initialize via `createPagerState()` or equivalent.
2. Replace `scroll-detail` action handler with `pagerScrollBy(model.detailPager, delta)`.
3. In `renderDetailPane()`, replace the manual blit-with-offset approach with `pager(manifestSurface, { state: model.detailPager, height: bodyHeight })`.
4. Add pager state for the doctor drawer — `model.doctorPager`. Wire `shift+j`/`shift+k` when the doctor drawer is active.
5. Add pager state for the stats drawer — `model.statsPager`. Wire `shift+j`/`shift+k` when the stats drawer is active.
6. Remove the `chunks.slice(0, 20)` limit in `manifest-view.js` — with a pager, all chunks can be rendered and scrolled.
7. Add a scroll position indicator (line count or percentage) visible in the pager chrome or the status bar.
8. Ensure `d`/`u` (page down/up) keys work within paged content when the detail pane is focused.

### Files Modified

- `bin/ui/dashboard.js` — replace `detailScroll` with pager state, add pager states for doctor/stats drawers, update scroll action handlers
- `bin/ui/dashboard-view.js` — use `pager()` in `renderDetailPane()`, `renderStatsDrawer()`, `renderDoctorDrawer()`
- `bin/ui/manifest-view.js` — remove `chunks.slice(0, 20)` limit, render all chunks

### Dependencies

- TUI-001 (framed app shell)
- TUI-002 (boxSurface for pager container panels)

## Acceptance Criteria

- [ ] Detail pane content is scrollable via `pager` component
- [ ] Doctor drawer content is scrollable
- [ ] Stats drawer content is scrollable
- [ ] Scroll position indicator is visible when content exceeds viewport
- [ ] `shift+j`/`shift+k` scroll active paged content
- [ ] `d`/`u` page down/up in paged content when detail pane is focused
- [ ] Chunk table shows all chunks (not limited to 20)
- [ ] Manual `detailScroll` field is removed from `DashModel`
- [ ] Scroll bounds are respected (no scrolling past content end)
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Medium
