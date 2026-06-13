# TUI-012: Animated view transitions

## What

Use Bijou v5's `motion` middleware and transition shaders (fade, wipe, blinds) to animate view switches and panel interactions. When switching between list/treemap/refs views, drilling into the treemap, or resizing the split pane, apply brief transition animations. Spring physics for panel resize. This is the polish card — it makes the TUI feel fluid rather than jarring.

## Why

The current dashboard switches views instantaneously — one frame you see the entries ledger, the next frame you see the treemap. This is disorienting, especially when the layout changes dramatically (split pane to full-width treemap, or list view to refs table). Even a 100ms crossfade gives the eye enough continuity to track what changed. The treemap drill-in/drill-out is particularly jarring without animation — the user loses spatial context when tiles rearrange. Spring physics on split pane resize replaces the current instant snap with momentum-based movement that feels natural.

## Current State

- View switches (`activeDrawer` changes) are instant — `handleAction()` sets `model.activeDrawer` and the next render shows the new view.
- Treemap drill (`treemap-drill-in`, `treemap-drill-out`) recalculates tiles and renders immediately.
- Split pane resize (`split-resize`) calls `splitPaneResizeBy(model.splitPane, delta)` and renders the new ratio immediately.
- The dashboard already uses `animate()` for toast enter/exit tweens (lines 559–568 in `dashboard.js`), proving the animation pipeline works. But no view transitions use it.

## Design

### Bijou v5 Components Used

- `motion(options)` — middleware that manages transition state and interpolation
- `transition(from, to, shader, options)` — applies a shader to blend two surfaces
- `fade` shader — alpha crossfade between surfaces
- `wipe` shader — directional wipe (left, right, up, down)
- `blinds` shader — venetian blind transition
- `spring(options)` — spring physics for continuous value animation

### Implementation Plan

1. Register `motion` middleware in the framed app configuration.
2. **View switch transitions**: When `activeDrawer` changes (list -> treemap, list -> refs, etc.), capture the outgoing surface and crossfade to the incoming surface using `transition(outgoing, incoming, fade, { duration: 120 })`.
3. **Treemap drill transitions**: When drilling in, use `wipe('right')` to suggest spatial descent. When drilling out, use `wipe('left')` to suggest ascent. Duration: 150ms.
4. **Split pane resize**: Replace the instant `splitPaneResizeBy` delta application with a `spring({ stiffness: 300, damping: 20 })` that animates the split ratio to its target. The split pane state holds a `targetRatio` and the spring interpolates `currentRatio` toward it.
5. **Drawer open/close**: Slide drawers in from the right using `wipe('left')` on open, `wipe('right')` on close. Duration: 100ms.
6. **Palette open/close**: Scale-fade the command palette: `fade` combined with a slight vertical offset animation.
7. Keep all transitions under 200ms — the TUI should feel snappy, not theatrical. Provide an `--no-motion` flag or respect `REDUCE_MOTION=1` env var for accessibility.
8. Ensure transitions do not block input — key events during a transition are queued and processed after the transition completes, or cancel the transition immediately.

### Files Modified

- `bin/ui/dashboard.js` — register motion middleware, add transition state, update view-switch and drill handlers to trigger transitions, add spring state for split pane
- `bin/ui/dashboard-view.js` — apply transition shaders in `renderBody()` and `renderOverlays()` when transition state is active
- `bin/ui/repo-treemap.js` — treemap drill transitions

### Dependencies

- TUI-001 (framed app shell for middleware registration)
- TUI-006 (layout primitives — transitions work best with declarative layouts)

## Acceptance Criteria

- [ ] View switches (list/treemap/refs) use a fade or wipe transition
- [ ] Treemap drill-in/drill-out uses directional wipe transitions
- [ ] Split pane resize uses spring physics (no instant snap)
- [ ] Drawer open/close is animated with a slide transition
- [ ] All transitions complete in under 200ms
- [ ] `REDUCE_MOTION=1` env var disables all animations
- [ ] Key events during transitions are not lost
- [ ] Transitions do not cause visual artifacts (tearing, flicker, orphaned frames)
- [ ] Dashboard feels fluid during rapid view switching
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Large
