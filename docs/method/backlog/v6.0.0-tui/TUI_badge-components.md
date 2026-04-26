# TUI-005: Badge components

## What

Replace the custom badge/chip rendering in `renderBadges()` (manifest-view.js) and `appendSelectionBadges()` / `headerParts()` (dashboard-view.js) with Bijou v5's `badge` component. The dashboard and manifest view currently use `chipSurface()` and `chipText()` from `theme.js` to build inline badges — these are effectively hand-rolled badge components that v5 provides natively with consistent sizing, padding, and theme-aware coloring.

## Why

The current `chipSurface()` and `chipText()` helpers in `theme.js` manually apply fg/bg/bold styling via raw ANSI calls and hardcoded `CHIP_TONES`. Bijou v5's `badge` component integrates with the theme system, supports semantic variants (info, warning, success, danger, accent, brand), handles padding and truncation consistently, and works in both surface and text rendering contexts. Migrating reduces theme.js complexity and ensures badges look consistent across the app without maintaining a parallel tone mapping.

## Current State

**`theme.js`**:
- `CHIP_TONES` constant (lines 43–51) — 7 tone variants with hardcoded RGB values
- `chipSurface(ctx, label, tone)` (lines 90–94) — returns a 1-line `Surface` for inline blitting
- `chipText(ctx, label, tone)` (lines 104–108) — returns an ANSI string for string-based renderers

**`manifest-view.js`**:
- `renderBadges(m, ctx)` (lines 40–56) — builds badge line: `v1`/`v2` version, `encrypted`, compression algorithm, `merkle`

**`dashboard-view.js`**:
- `headerParts(model, ctx)` (lines 102–121) — builds header badges: entry count, encryption status, filter state, active view
- `appendSelectionBadges(parts, model, ctx)` (lines 130–155) — appends: selected slug, alert count, treemap scope/level/focus, drawer name, palette indicator

Badge vocabulary: `encrypted`, `compressed`, `convergent`, `CDC`, `framed`, `whole`, `v1`/`v2`, `filtering`, `entries ledger`, `manifest inspector`, `atlas view`, `ref index`, `command deck`, plus dynamic labels.

## Design

### Bijou v5 Components Used

- `badge(label, options)` — renders a badge with semantic variant, returns Surface or string depending on context
- `BadgeVariant` — `'info' | 'warning' | 'success' | 'danger' | 'accent' | 'brand' | 'neutral'`
- Theme-aware coloring (badge colors derived from `GIT_CAS_THEME`)

### Implementation Plan

1. Map existing `CHIP_TONES` to v5 badge variants:
   - `brand` -> `badge(label, { variant: 'brand' })`
   - `info` -> `badge(label, { variant: 'info' })`
   - `accent` -> `badge(label, { variant: 'accent' })`
   - `warning` -> `badge(label, { variant: 'warning' })`
   - `success` -> `badge(label, { variant: 'success' })`
   - `danger` -> `badge(label, { variant: 'danger' })`
   - `neutral` -> `badge(label, { variant: 'neutral' })`
2. Replace `chipSurface()` calls in `dashboard-view.js` with `badge()` calls that return surfaces.
3. Replace `chipText()` calls in `manifest-view.js` `renderBadges()` with `badge()` calls that return strings.
4. Delete `CHIP_TONES`, `chipSurface()`, and `chipText()` from `theme.js`.
5. Verify all badge use sites render with correct variant and sizing.

### Files Modified

- `bin/ui/theme.js` — delete `CHIP_TONES`, `chipSurface()`, `chipText()`
- `bin/ui/dashboard-view.js` — replace `chipSurface()` calls with `badge()` in `headerParts()` and `appendSelectionBadges()`
- `bin/ui/manifest-view.js` — replace `chipText()` calls with `badge()` in `renderBadges()`

### Dependencies

- TUI-001 (theme propagation — badges pull colors from the app theme)

## Acceptance Criteria

- [ ] All `chipSurface()` calls replaced with `badge()` in `dashboard-view.js`
- [ ] All `chipText()` calls replaced with `badge()` in `manifest-view.js`
- [ ] `CHIP_TONES`, `chipSurface`, `chipText` deleted from `theme.js`
- [ ] Badge variants match the semantic intent of each use site
- [ ] Header badges render correctly at all terminal widths
- [ ] Manifest view badges render correctly for all manifest types (encrypted, compressed, merkle, etc.)
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Small
