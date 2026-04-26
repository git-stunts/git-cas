# TUI-002: Replace boxV3 with boxSurface

## What

Replace all `boxV3()` calls with `boxSurface()`, the v5 successor. `boxV3` was removed in Bijou v5. There are 6 call sites in `dashboard-view.js` — two helper functions (`renderOverlayPanel`, `renderPanel`) and four inline usages in `renderListPane` and `renderDetailPane`. The API shape is nearly identical; the primary change is the function name and the options object gaining a `theme` field instead of relying solely on `ctx`.

## Why

`boxV3` does not exist in Bijou v5. The import will fail at runtime, making the entire dashboard unusable. This is the only hard breaking API change in the v3-to-v5 upgrade path and must be resolved before the TUI can even render.

## Current State

`dashboard-view.js` line 5 imports `boxV3` from `@flyingrobots/bijou`:
```js
import { boxV3, createSurface, parseAnsiToSurface, kbd } from '@flyingrobots/bijou';
```

Six call sites:
- Line 242 — `renderOverlayPanel()`: `boxV3(textSurface(...), { ctx, title, width })`
- Line 681 — `renderPanel()`: `boxV3(textSurface(...), { ctx, title, width })`
- Line 874 — `renderListPane()`: `boxV3(textSurface(...), { ctx, title, width })`
- Line 896 — `renderDetailPane()` (no manifest loaded): `boxV3(content, { ctx, title, width })`
- Line 915 — `renderDetailPane()` (loading state): `boxV3(content, { ctx, title, width })`
- Line 929 — `renderDetailPane()` (manifest loaded): `boxV3(content, { ctx, title, width })`

## Design

### Bijou v5 Components Used

- `boxSurface(content, options)` — direct replacement for `boxV3`

### Implementation Plan

1. Update the import in `dashboard-view.js`: replace `boxV3` with `boxSurface` in the import statement.
2. Find-and-replace all 6 `boxV3(` calls with `boxSurface(`.
3. If v5's `boxSurface` requires a `theme` option instead of (or in addition to) `ctx`, thread the theme object through. After TUI-001 lands, the theme is available from the framed app context.
4. Verify each call site renders correctly — title text, border style, and content clipping should be unchanged.

### Files Modified

- `bin/ui/dashboard-view.js` — update import, replace 6 call sites

### Dependencies

- TUI-001 (if `boxSurface` requires theme object from framed app context)
- Can proceed independently if `boxSurface` accepts the same `{ ctx, title, width }` options

## Acceptance Criteria

- [ ] `boxV3` import is removed from `dashboard-view.js`
- [ ] `boxSurface` is imported and used at all 6 call sites
- [ ] `renderOverlayPanel()` renders bordered panels with titles
- [ ] `renderPanel()` renders bordered panels with titles
- [ ] `renderListPane()` renders the entries ledger box
- [ ] `renderDetailPane()` renders the manifest inspector box in all three states (empty, loading, loaded)
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Small
