# TUI-001: Migrate to createFramedApp + startApp

## What

Replace the manual `run()` + context setup + mode detection pipeline with Bijou v5's `createFramedApp()` + `startApp(app, { theme })`. The current `launchDashboard()` in `dashboard.js` manually creates a `BijouContext` via `createCliTuiContext()`, detects the output mode via `detectCliTuiMode()`, builds a `DashDeps` object, instantiates the TEA app via `createDashboardApp(deps)`, and then calls `run(app, { ctx })`. All of that boilerplate collapses into a framed app declaration with a theme object. This is the foundation card — every other TUI card depends on the framed app shell being in place.

## Why

The current bootstrap path is ~70 lines of plumbing spread across `context.js` and the bottom of `dashboard.js`. It manually reimplements mode detection, stderr I/O wiring, and NO_COLOR handling that Bijou v5 provides out of the box. The framed app also gives us frame chrome (title bar, border), built-in theme propagation, and a hosted runner that manages lifecycle events (resize, focus, quit) without manual wiring. This unblocks every other v5 feature adoption.

## Current State

- `context.js` (119 lines) — `getCliContext()`, `createCliTuiContext()`, `detectCliTuiMode()`, plus a custom `stderrIO()` port implementation.
- `dashboard.js` lines 2044–2054 — `launchDashboard()` manually constructs context, detects mode, branches on interactive vs pipe, builds deps, calls `run()`.
- `dashboard.js` lines 2018–2030 — `normalizeLaunchContext()` patches missing mode onto context objects.
- `dashboard.js` lines 1990–1996 — `createDashboardApp()` returns a raw `{ init, update, view }` TEA record.

## Design

### Bijou v5 Components Used

- `createFramedApp(config)` — declares the TEA app with frame chrome, theme, and lifecycle hooks
- `startApp(app, options)` — hosted runner replacing `run()`
- `defineTheme(palette)` — wraps `GIT_CAS_PALETTE` into a v5 theme object
- Automatic mode detection (replaces `detectCliTuiMode`)
- Built-in stderr output support via `output: 'stderr'` option

### Implementation Plan

1. Create a `GIT_CAS_THEME` object in `theme.js` using `defineTheme()` with the existing `GIT_CAS_PALETTE` colors mapped to v5 semantic roles (brand, accent, surface, muted, danger, etc.).
2. Refactor `createDashboardApp()` to return a `createFramedApp()` result instead of a raw TEA record. Pass `{ theme: GIT_CAS_THEME, title: 'git-cas vault', frame: 'rounded' }`.
3. Replace `launchDashboard()`'s `run(app, { ctx })` call with `startApp(app, { output: 'stderr' })`. The framed app handles mode detection, context creation, and resize wiring internally.
4. Delete `createCliTuiContext()` and `detectCliTuiMode()` from `context.js`. Keep `getCliContext()` — it is used by non-TUI CLI commands (manifest-view, vault-list) that render to stderr outside the dashboard.
5. Delete `normalizeLaunchContext()` from `dashboard.js`.
6. Update `dashboard-view.js` — the `renderDashboard()` function no longer needs to manually compose header chrome and footer into a full-screen surface. The framed app provides the outer frame; `renderDashboard()` returns only the inner content surface.
7. Update test doubles that currently mock `run()` to mock `startApp()` instead.

### Files Modified

- `bin/ui/theme.js` — add `GIT_CAS_THEME` export via `defineTheme()`
- `bin/ui/dashboard.js` — rewrite `createDashboardApp()` and `launchDashboard()`, delete `normalizeLaunchContext()`
- `bin/ui/context.js` — delete `createCliTuiContext()`, `detectCliTuiMode()`, and `stderrIO()`; keep `getCliContext()`
- `bin/ui/dashboard-view.js` — remove manual frame/chrome composition from `renderDashboard()`

### Dependencies

- None — this is the foundation card
- Enables: TUI-002, TUI-003, TUI-004, TUI-005, TUI-006, TUI-007, TUI-008, TUI-009, TUI-010, TUI-011, TUI-012

## Acceptance Criteria

- [ ] `launchDashboard()` uses `startApp()` instead of `run()`
- [ ] `createDashboardApp()` returns a `createFramedApp()` result
- [ ] `GIT_CAS_THEME` is defined in `theme.js` and passed to the framed app
- [ ] `detectCliTuiMode()` and `createCliTuiContext()` are deleted from `context.js`
- [ ] `normalizeLaunchContext()` is deleted from `dashboard.js`
- [ ] Dashboard renders correctly in interactive mode with frame chrome
- [ ] Non-TTY fallback (`printStaticList`) still works
- [ ] All existing unit tests pass without modification (or are updated to use `startApp` mocks)
- [ ] `npx eslint .` reports 0 errors

## Effort

Large
