# TUI-003: Status bar

## What

Add a persistent `statusBar` at the bottom of the dashboard showing at-a-glance context: vault encryption status, entry count, selected entry slug, current view (list/treemap/refs), and git branch. This replaces the current hand-built footer in `renderFooterSurface()` which mixes keybinding hints with state indicators in a dense, hard-to-scan block.

## Why

The current footer is 3–4 lines of raw keybinding text that changes based on the active view. State indicators (encryption status, entry count, selected slug) are only visible in the header badges, which scroll off or compress at narrow widths. A dedicated status bar gives users a stable, always-visible summary of where they are and what they're looking at — the same mental model as a code editor's status bar.

## Current State

- `dashboard-view.js` lines 1320–1342 — `renderFooterSurface()` builds 3–4 lines of keybinding hints using `kbd()` calls, varying by `model.activeDrawer`.
- `dashboard-view.js` lines 1419–1426 — the footer surface is blitted to the bottom of the screen in `renderDashboard()`.
- Header badges (`headerParts`, `appendSelectionBadges`) carry state info but compete for horizontal space with other chrome.

## Design

### Bijou v5 Components Used

- `statusBar(segments, options)` — renders a single-line status bar with left/center/right segments
- Theme integration for consistent background tinting

### Implementation Plan

1. Define status bar segments derived from `DashModel`:
   - **Left**: view indicator (`entries` / `atlas` / `refs`), entry count (`42 entries`), filter state.
   - **Center**: selected entry slug or treemap focus label.
   - **Right**: encryption badge (`encrypted` / `plaintext`), git branch name (from `model.metadata` or a new field).
2. Create `renderStatusBar(model, deps)` in `dashboard-view.js` that calls `statusBar()` with the segment arrays.
3. Replace the `renderFooterSurface()` call in `renderDashboard()` with `renderStatusBar()`. The keybinding hints move to the help overlay (TUI-007).
4. If TUI-007 is not yet implemented, keep a single condensed hint line above or below the status bar showing `? help  q quit` as a bridge.
5. Add git branch to `DashModel` — populate it during `loadEntriesCmd` via `git rev-parse --abbrev-ref HEAD` or from the store's plumbing layer.

### Files Modified

- `bin/ui/dashboard-view.js` — add `renderStatusBar()`, replace `renderFooterSurface()` in `renderDashboard()`
- `bin/ui/dashboard.js` — add `gitBranch` field to `DashModel`, populate during init
- `bin/ui/dashboard-cmds.js` — fetch git branch name alongside entry loading

### Dependencies

- TUI-001 (theme propagation for status bar styling)
- Enables: TUI-007 (keybinding hints move to help overlay once status bar owns the footer)

## Acceptance Criteria

- [ ] Status bar is visible at the bottom row of the dashboard
- [ ] Left segment shows current view name and entry count
- [ ] Center segment shows selected entry slug or treemap focus
- [ ] Right segment shows encryption status and git branch
- [ ] Status bar updates reactively when model state changes
- [ ] Keybinding hints are either moved to a help overlay or condensed to a single `? help` hint
- [ ] Status bar degrades gracefully at narrow terminal widths (segments truncate, not wrap)
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Medium
