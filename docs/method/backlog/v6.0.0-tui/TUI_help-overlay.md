# TUI-007: Help overlay

## What

Add a `helpView` overlay triggered by the `?` key that shows all keybindings organized by context (global, list view, treemap view, refs view, filter mode). This replaces the static footer hints currently rendered by `renderFooterSurface()` as the primary discoverability mechanism for keyboard navigation.

## Why

The current footer crams 12–15 keybinding hints into 3 lines of text that change based on the active view. Users must memorize which keys are available in which context, and the footer provides no grouping or explanation — just raw `kbd('j/k')` fragments. A help overlay gives users a single, always-accessible reference that shows every available action with its key, description, and context. This is the standard pattern (vim `:help`, tmux `?`, htop `F1`) and frees up the footer row for the status bar (TUI-003).

## Current State

- `dashboard-view.js` lines 1320–1342 — `renderFooterSurface()` builds view-dependent keybinding hints.
- `dashboard.js` lines 141–169 — `createKeyBindings()` defines 24 keybindings with labels, but these labels are never shown to the user; they're only used as `KeyMap` descriptions.
- No `?` keybinding exists currently. The key is available.

## Design

### Bijou v5 Components Used

- `overlay(content, options)` — renders a centered overlay panel with backdrop dimming
- `boxSurface(content, options)` — bordered content panel for the help body
- `vstack` / `hstack` — layout for grouped keybinding sections
- `kbd(key, options)` — already used, renders styled key indicators

### Implementation Plan

1. Add a `?` keybinding to `createKeyBindings()` mapped to a new `{ type: 'open-help' }` action.
2. Add `'help'` to the `activeDrawer` union type in `DashModel`, or use a separate `helpVisible: boolean` flag.
3. In `handleAction()`, toggle help visibility on `open-help`. Close on `escape` or `?` (toggle behavior).
4. Create `renderHelpOverlay(model, deps)` in `dashboard-view.js` that builds the help content:
   - **Global** section: `q` quit, `?` help, `ctrl+p` palette, `escape` close overlay
   - **List View** section: `j/k` navigate, `d/u` page, `enter` inspect, `tab` pane focus, `H/L` resize, `/` filter
   - **Treemap View** section: `j/k` regions, `d/u` page, `+/-` drill, `T` scope, `i` files
   - **Refs View** section: `j/k` refs, `d/u` page, `enter` switch source
   - **Operators** section: `s` stats, `g` doctor, `r` refs, `t` treemap
5. Derive help content from the `KeyMap` entries where possible — `createKeyBindings()` already has labels.
6. Render as a centered overlay using `overlay()` or manual centering (consistent with palette overlay positioning).
7. Simplify or delete `renderFooterSurface()` — replace with a single-line hint: `? help  q quit` (or remove entirely if TUI-003 status bar is in place).

### Files Modified

- `bin/ui/dashboard.js` — add `open-help` action, `helpVisible` state, toggle logic in `handleAction()`
- `bin/ui/dashboard-view.js` — add `renderHelpOverlay()`, update `renderOverlays()` to render help, simplify or remove `renderFooterSurface()`

### Dependencies

- TUI-001 (framed app shell)
- TUI-002 (boxSurface for help panel border)
- Complements TUI-003 (status bar takes over footer, help overlay takes over keybinding hints)

## Acceptance Criteria

- [ ] `?` key opens the help overlay
- [ ] `escape` or `?` again closes the help overlay
- [ ] Help overlay shows all keybindings grouped by context
- [ ] Keybinding labels match the descriptions in `createKeyBindings()`
- [ ] Help overlay renders as a centered panel with a visible border
- [ ] Help overlay is scrollable if content exceeds terminal height
- [ ] Footer hints are simplified to `? help  q quit` or removed entirely
- [ ] Help overlay does not interfere with other overlays (palette, drawers)
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Medium
