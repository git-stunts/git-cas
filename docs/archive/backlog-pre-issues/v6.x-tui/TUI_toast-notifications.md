# TUI-004: Toast notifications

## What

Replace the custom toast notification system with Bijou v5's built-in `toast` + `notify` system. The dashboard currently implements its own toast lifecycle — creation, animation, expiration, dismissal, and rendering — across ~100 lines in `dashboard.js` and ~130 lines in `dashboard-view.js`. All of this is subsumed by v5's toast middleware.

## Why

The custom toast system works but duplicates functionality that Bijou v5 provides natively. The custom implementation manages its own animation timers (`animateToast`), phase state machine (`entering`/`steady`/`exiting`), progress tracking, shadow rendering, and slide-offset math. Replacing it with `notify()` eliminates ~230 lines of bespoke state management and gives us consistent toast behavior (stacking, auto-dismiss, accessibility announcements) for free.

## Current State

**`dashboard.js`** (~100 lines of toast logic):
- `ToastLevel`, `ToastPhase`, `ToastRecord` typedefs (lines 34–36)
- `toast-progress`, `toast-expire`, `dismiss-toast` message types (lines 80–82)
- `addToast()` — creates record, schedules enter animation + TTL timer (lines 524–535)
- `dismissToast()` — filters toast from model (lines 544–549)
- `animateToast()` — drives `animate()` tween for enter/exit (lines 559–568)
- `updateToast()` — immutable toast record updater (lines 578–588)
- `startToastExit()` — triggers exit animation + deferred dismiss (around line 610)
- `handleAppMsg()` routes `toast-progress`, `toast-expire`, `dismiss-toast` (lines 1888–1898)
- `model.toasts` array and `model.nextToastId` counter in `DashModel`

**`dashboard-view.js`** (~130 lines of toast rendering):
- `TOAST_THEME` constant (lines 23–28)
- `renderToastStack()` — positions and blits toast surfaces (lines 711–732)
- `renderToastSurface()` — builds individual toast surface with title, message, progress bar
- `renderToastShadow()` — drop shadow effect
- `toastSlideOffset()` — horizontal slide based on animation phase

## Design

### Bijou v5 Components Used

- `notify(level, title, message)` — fire-and-forget toast dispatch
- `toastMiddleware(options)` — app middleware that manages toast lifecycle, stacking, and rendering
- `ToastPosition` — configuration for toast anchor (bottom-right matches current behavior)

### Implementation Plan

1. Add `toastMiddleware({ position: 'bottom-right', maxVisible: 4 })` to the framed app configuration in `createDashboardApp()`.
2. Replace all `addToast(model, { level, title, message })` call sites with `notify(level, title, message)`. There are 3 call sites: two in `handleLoadedEntries` area (line 872, line 1479) and one in `handleLoadError` (line 1870).
3. Remove toast-related fields from `DashModel`: `toasts`, `nextToastId`.
4. Remove toast message types from `DashMsg`: `toast-progress`, `toast-expire`, `dismiss-toast`.
5. Delete `addToast()`, `dismissToast()`, `animateToast()`, `updateToast()`, `startToastExit()` from `dashboard.js`.
6. Delete `renderToastStack()`, `renderToastSurface()`, `renderToastShadow()`, `toastSlideOffset()`, `TOAST_THEME` from `dashboard-view.js`.
7. Remove toast rendering call from `renderOverlays()` (line 1404).
8. Remove toast badge from `appendSelectionBadges()` (lines 135–137 in `dashboard-view.js`).
9. Verify error toasts still appear for load failures and stale-source scenarios.

### Files Modified

- `bin/ui/dashboard.js` — delete toast state, toast message handlers, `addToast`/`dismissToast`/`animateToast`/`updateToast`/`startToastExit`; replace with `notify()` calls
- `bin/ui/dashboard-view.js` — delete `TOAST_THEME`, `renderToastStack`, `renderToastSurface`, `renderToastShadow`, `toastSlideOffset`; remove toast badge from `appendSelectionBadges`

### Dependencies

- TUI-001 (framed app shell provides middleware integration point)

## Acceptance Criteria

- [ ] All `addToast()` call sites replaced with `notify()` calls
- [ ] Toast middleware is registered in the framed app config
- [ ] `DashModel` no longer contains `toasts` or `nextToastId`
- [ ] `DashMsg` no longer contains `toast-progress`, `toast-expire`, `dismiss-toast`
- [ ] All deleted functions are confirmed unused (no dead imports)
- [ ] Error toasts still appear when manifest loading fails
- [ ] Error toasts still appear when treemap/stats/doctor loading fails
- [ ] Toast stacking and auto-dismiss behavior matches previous UX
- [ ] ~230 lines of custom toast code removed
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass (toast-related tests updated or removed)

## Effort

Medium
