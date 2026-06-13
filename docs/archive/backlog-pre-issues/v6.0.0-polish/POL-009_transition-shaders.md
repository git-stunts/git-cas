# POL-009: Replace manual transition effect with bijou transition shaders

## Source
Bijou BigBro Audit (2026-04-26) — Scorecard "Pseudo-Shader" pattern

## What
`applyTransitionEffect` in `dashboard-view.js` manually fills cells with blanks to simulate wipe/fade transitions. This is a "pseudo-shader" that bypasses Bijou's built-in packed-buffer transition system (`dissolve`, `wipe`, `fade` shaders from `@flyingrobots/bijou-tui`).

## Fix
1. Use `surfaceShaderFilter` with the appropriate shader (`wipeShader`, `fadeShader`, `dissolveShader`) to apply transitions.
2. The shader system operates on packed buffers and is more efficient than per-cell fill.
3. Delete the manual `applyTransitionEffect` function.

## Files
- `bin/ui/dashboard-view.js`
- `bin/ui/dashboard.js` (transition state may need adjustment for shader API)

## Effort
Medium
