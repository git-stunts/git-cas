# TUI-013: Full-Screen Detail View (Replace Split Pane)

## What

Replace the 50/50 split pane layout with a full-width list + full-screen
detail view pattern. The entry list gets 100% width (no more truncated
columns). Selecting an entry opens a full-screen manifest inspector.
`Escape` returns to the list.

## Why

The current split pane wastes space in both directions:
- Left: table columns truncate (Slug, Size, Chunks, Crypto, Format — the
  last column is always cut off)
- Right: detail panel has massive empty space below the accordion sections

File explorer TUIs (ranger, lf, yazi, Midnight Commander) solve this with
stacked views — list is the primary view, detail is a drill-in. The treemap
already uses this pattern (press `t` → full screen). The manifest inspector
should too.

## Current State

- `dashboard-view.js` renders `splitPaneLayout()` compositing list + detail
  side by side (lines ~1351-1373)
- `dashboard.js` manages `splitPane` state with focused pane A/B, resize
  with H/L, Tab to switch focus
- Detail pane loads manifest on select (`handleSelect`), renders accordion
  sections
- Split ratio is adjustable but defaults to ~50/50

## Design

### Layout Model

```
MODE: list (default)
┌────────────────────────────────────────────┐
│ header + badges                            │
├────────────────────────────────────────────┤
│ Slug          Size    Chunks  Crypto  Fmt  │
│ ─────────────────────────────────────────  │
│ > assets/v1   100K    1       plain   v1   │
│   assets/v2   100K    1       plain   v1   │
│   config/app  74B     1       plain   v1   │
│   secrets/env 100B    1       framed  v1   │
├────────────────────────────────────────────┤
│ status bar                                 │
│ keybinding hints                           │
└────────────────────────────────────────────┘

MODE: detail (press Enter or l on selected entry)
┌────────────────────────────────────────────┐
│ header + badges (asset: assets/v1)         │
├────────────────────────────────────────────┤
│ Manifest Inspector — assets/data-v1        │
│ tree  ed806237e7a6...                      │
│                                            │
│ ▼ Asset Metadata                           │
│   ┌──────────────────────────────────────┐ │
│   │ slug      assets/data-v1             │ │
│   │ filename  data.bin                   │ │
│   │ size      100.0 KiB                  │ │
│   │ chunks    1                          │ │
│   └──────────────────────────────────────┘ │
│                                            │
│ ► Chunk Ledger (1)                         │
│ ► Encryption                               │
│ ► Compression                              │
├────────────────────────────────────────────┤
│ status bar                                 │
│ [ j/k ] section  [ space ] toggle          │
│ [ esc ] back  [ q ] quit                   │
└────────────────────────────────────────────┘
```

### Navigation

| Key | List Mode | Detail Mode |
|-----|-----------|-------------|
| `j/k` | Move cursor in entry list | Navigate accordion sections |
| `Enter` / `l` | Open detail view | Toggle accordion section |
| `Escape` / `h` | Close drawer/palette | Return to list |
| `Space` | — | Toggle accordion section |
| `/` | Filter entries | — |
| `t` | Open treemap (existing) | — |
| `?` | Help overlay (existing) | Help overlay |

### Key Removal: Split Pane

- Remove `Tab` (pane switch) — no more panes
- Remove `H/L` (pane resize) — no more split
- Remove `splitPaneLayout` usage
- Remove `splitPane` from model state
- The `splitPaneFocusNext`, `splitPaneResizeBy`, `createSplitPaneState`
  imports become unused

### Implementation Plan

1. Add `viewMode: 'list' | 'detail'` to the model (default: `'list'`)
2. On `Enter`/`l` in list mode: set `viewMode: 'detail'`, load manifest
   if not cached, build accordion
3. On `Escape`/`h` in detail mode: set `viewMode: 'list'`
4. `renderBody()`: when `viewMode === 'list'`, render full-width table.
   When `viewMode === 'detail'`, render full-width accordion/manifest view.
5. Remove `splitPaneLayout()` from `renderBody()`
6. Remove `splitPane` state from model
7. Remove Tab/H/L keybindings
8. Update header badges to show context (list: entry count, detail: asset name)
9. Update footer hints per mode
10. Update status bar per mode
11. The table gets the FULL terminal width — all columns visible

### Preview on Navigate

As a bonus: when navigating entries in list mode, show a 1-line preview
in the status bar (slug, size, encryption status). This replaces the
instant-feedback of the split pane without needing a separate panel.

### Files Modified

- `bin/ui/dashboard.js` — model changes, navigation, remove split pane state
- `bin/ui/dashboard-view.js` — remove splitPaneLayout, full-width list/detail
- `bin/ui/theme.js` — no changes expected
- `test/unit/cli/dashboard.test.js` — update model, remove pane tests, add
  view mode tests

### Dependencies

- TUI-011 (accordion) — already done, detail view uses it
- TUI-010 (pager) — already done, detail view uses it

## Acceptance Criteria

- [ ] List view uses full terminal width — no truncated columns
- [ ] Enter/l opens full-screen detail view
- [ ] Escape/h returns to list
- [ ] Accordion navigation works in detail mode
- [ ] Treemap/refs views still work (they already use full screen)
- [ ] Tab/H/L keybindings removed
- [ ] splitPaneLayout import removed
- [ ] All existing tests updated or replaced
- [ ] Status bar shows context per mode

## Effort

Large
