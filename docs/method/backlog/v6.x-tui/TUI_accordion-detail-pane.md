# TUI-011: Accordion sections in detail pane

## What

Use Bijou v5's `interactiveAccordion` for collapsible sections in the manifest detail view. The manifest inspector currently renders all sections sequentially — Metadata, Encryption, Compression, Chunking, Chunks, Sub-Manifests — in a single vertical scroll. With an accordion, each section expands or collapses independently, letting users focus on the section they care about without scrolling past the rest.

## Why

A fully expanded manifest view for an encrypted, compressed, CDC-chunked asset with 50+ chunks can easily exceed 80 lines of text. The user typically only needs one or two sections at a time — the encryption profile to verify algorithm settings, or the chunk ledger to check deduplication. Collapsible sections reduce visual clutter and make navigation faster. The accordion pattern is familiar from file managers, IDEs, and web UIs.

## Current State

- `manifest-view.js` lines 151–173 — `renderManifestView()` concatenates all sections with double newlines:
  - `renderBadges()` — badge line
  - `renderMetadataSection()` — slug, filename, size, chunk count
  - `renderEncryptionSection()` — algorithm, KDF, nonce, tag
  - Compression line — algorithm name
  - `renderSubManifestsSection()` — sub-manifest tree
  - `renderChunksSection()` — chunk table (capped at 20 rows)
- All sections are always expanded. No collapse/expand mechanism exists.
- Each section uses `sectionHeading()` with a `◆` prefix — these become natural accordion headers.

## Design

### Bijou v5 Components Used

- `interactiveAccordion(sections, state, options)` — renders collapsible sections with expand/collapse state
- `createAccordionState(sectionCount, options)` — initializes accordion state (which sections are open)
- `accordionToggle(state, index)` — toggles a section open/closed
- `accordionFocusNext(state)` / `accordionFocusPrev(state)` — keyboard navigation between sections

### Implementation Plan

1. Define accordion sections from manifest data:
   - **Section 0 — Metadata**: always present. Default: expanded.
   - **Section 1 — Encryption**: present if `manifest.encryption`. Default: collapsed.
   - **Section 2 — Compression**: present if `manifest.compression`. Default: collapsed.
   - **Section 3 — Sub-Manifests**: present if `manifest.subManifests?.length`. Default: collapsed.
   - **Section 4 — Chunks**: present if `manifest.chunks?.length`. Default: collapsed.
2. Add `detailAccordion` state to `DashModel`, initialized when a manifest is loaded.
3. Refactor `renderManifestView()` to return section objects `{ header, body }[]` instead of a flat string. Each section's header is the existing `sectionHeading()` text; the body is the section content.
4. In `renderDetailPane()`, pass sections and accordion state to `interactiveAccordion()`.
5. Wire keyboard navigation:
   - When detail pane is focused, `j`/`k` (or `tab`/`shift+tab`) navigate between accordion sections.
   - `enter` or `space` toggles the focused section.
   - `shift+j`/`shift+k` still scroll within an expanded section (via TUI-010 pager).
6. Persist accordion state per-slug so switching between entries remembers which sections were open.

### Files Modified

- `bin/ui/manifest-view.js` — refactor `renderManifestView()` to return structured section objects
- `bin/ui/dashboard.js` — add `detailAccordion` state to `DashModel`, accordion action handlers, keyboard routing when detail pane is focused
- `bin/ui/dashboard-view.js` — use `interactiveAccordion()` in `renderDetailPane()`

### Dependencies

- TUI-001 (framed app shell)
- TUI-002 (boxSurface for section containers)
- TUI-010 (pager for scrolling within expanded sections)

## Acceptance Criteria

- [ ] Manifest detail view renders sections as an accordion
- [ ] Each section can be independently expanded or collapsed
- [ ] Metadata section is expanded by default; others are collapsed
- [ ] Keyboard navigation moves focus between section headers
- [ ] `enter` or `space` toggles section expand/collapse
- [ ] Section headers show expand/collapse indicator (chevron or similar)
- [ ] Accordion state persists when switching between entries
- [ ] Sections that don't apply to a manifest (e.g., encryption for a plaintext asset) are not shown
- [ ] Accordion works correctly with the pager (TUI-010) for scrolling within long sections
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Medium
