# POL-001: Eliminate string sludge in manifest-view.js

## Source
Bijou BigBro Audit (2026-04-26) — Detailed Screen Breakdown, Section 3

## What
`renderManifestView` and `buildManifestSections` push strings into arrays and join with `\n\n`. The component returns a `string`, not a `Surface`. This bypasses the Bijou layout engine and makes composition fragile.

Additionally, `manifest-view.js` normalizes data via `manifest.toJSON()` in the view layer — this is an adapter concern, not a view concern.

## Fix
1. Have callers pass normalized `ManifestData` (not `Manifest` instances) so the view never calls `toJSON`.
2. Where feasible, return `Surface` objects composed with `vstackSurface` instead of `string.join('\n\n')`.
3. Replace `digest.slice(0, 12)` with column-width constraints on the table schema.

## Files
- `bin/ui/manifest-view.js`
- `bin/ui/dashboard.js` (callers that pass Manifest instances)
- `bin/ui/dashboard-view.js` (callers)

## Effort
Medium
