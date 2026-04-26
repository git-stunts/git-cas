# 🕵️‍♂️ Bijou BigBro Audit: `git-cas`
**Date:** 2026-04-26
**Status:** Architectural Intervention Required (V4 → V6 Transition)

## 0. Executive Summary
`git-cas` is an industrial-grade CAS engine with a TUI that currently feels like a "V4 artifact" surviving in a "V5/V6 world." While the TEA orchestration is robust, the visual layer relies heavily on **manual ANSI string concatenation** and **brittle geometric math**. 

This audit provides a blueprint for a **Block-Based TUI**, drawing inspiration from modern web UI libraries like **Mantine**. We will move away from "rendering strings" and toward "composing structured surfaces."

---

## 1. Architectural Integrity: From Strings to Surfaces

### The Findings
- **Sludge Detected:** `renderDashboard` and `renderBody` in `dashboard-view.js` use manual vertical stacking and `screen.blit` with hardcoded offsets (`top`, `height`).
- **Violation:** `renderListPane` and `renderDetailPane` wrap content in `boxSurface` manually.
- **Problem:** This is **"Pixel Pushing in the Terminal."** If you add a new header row, the entire layout math breaks.

### The BigBro Way
Transition to **Declarative Layout Blocks**. Instead of manual blitting, use `createFramedApp` (or a custom `Workspace` block) that uses `calculateFlex` or `Stack` primitives.

**Proposal:** Create a `Layout.js` block that owns the Shell geometry.
```js
// The V6 Way
const shell = Shell({
  header: HeaderBlock({ title: 'git-cas', source: model.source }),
  body: WorkspaceBlock({
    sidebar: EntryLedgerBlock({ state: model.table }),
    content: InspectorBlock({ entry: model.selectedEntry }),
  }),
  footer: FooterBlock({ hints: model.keyHints })
});
```

---

## 2. Component Design: The "Mantine" Block Strategy

Modern TUIs should feel "packaged." Instead of calling five different functions to render a "Ref Index," you should use a cohesive **RefBlock**.

### Block 1: `AssetCard` (Mantine Card equivalent)
Currently, `encryption-card.js` returns a string.
- **Refactor:** A structured component that takes an `Asset` entity and returns a `Surface`.
- **Features:** Automatic truncation, status badges for crypto/compression, and 2-cell rhythm internal padding.

### Block 2: `MerkleExplorer` (Interactive Tree/DAG)
Currently, `merkle-dag.js` and `manifest-view.js` are separate concerns.
- **Refactor:** A unified "Exploration Block" that toggles between a **Table** (v1 flat), a **Tree** (v2 directory), and a **DAG** (Merkle structure).
- **Inspiration:** Mantine's "Tabs" or "SegmentedControl."

### Block 3: `OperationFeed` (Feedback/Notifications)
Currently uses a toast system.
- **Refactor:** A "Notification Center" block that handles both transient toasts and a persistent "Log" of I/O operations (stores/restores).
- **Improvement:** Every store/restore should spawn a scoped **ProgressBlock** within the feed.

---

## 3. Geometric Lawfulness & Rhythm

### The Findings
- **Magic Numbers:** `Math.max(32, Math.min(56, opts.width - 2))` in `renderStatsDrawer`.
- **Rhythm Violation:** Scattered use of `spacer(1, 1)` and manual `'  '` padding.
- **Problem:** The UI feels "jittery" because different panes use different internal padding rules.

### The Mentorship
Bijou v5/v6 demands a **2-cell rhythm**. 
1. **Rule of 2:** Gaps between major sections should always be 2 cells.
2. **Constraint-First:** Use `Surface.constrain({ width, height })` instead of manual clamping in business logic.
3. **Semantic Spacing:** Use `row([A, gap(2), B])` instead of `A + '  ' + B`.

---

## 4. CLI: Pro-Grade UI Blocks

`git-cas` CLI is powerful but visually "raw."

### Opportunity: `git-cas vault list`
- **Current:** Simple ANSI table.
- **Proposal:** Use the Bijou `table()` component with **Adaptive Column Lowering**. If the terminal is narrow, hide "Profile" and "Chunks" automatically.

### Opportunity: `git-cas doctor`
- **Current:** Text report.
- **Proposal:** A **HealthDashboard** block. Use `badge()` for status and a `timeline()` for the vault commit history. 

### Opportunity: `git-cas inspect --heatmap`
- **Finding:** Heatmap is a custom renderer.
- **Proposal:** Promote this to a **HeatmapBlock** in `bijou-tui`. It’s a generic pattern for CAS data.

---

## 5. Interaction: Intent over Spaghetti

### The Findings
- **Spaghetti:** `handleAction` in `dashboard.js` is a massive conditional tree.
- **Problem:** Key routing is handled manually.

### The BigBro Way
Use **View Stack Focus**. 
- Each "Block" should declare its own `KeyMap`. 
- The `RuntimeEngine` should route input to the **Topmost Focused Block**.
- **Mantine Inspiration:** Focus management should be "built-in" to the block (e.g., a `ModalBlock` automatically traps focus).

---

## 6. Action Plan for `git-cas`

1. **Phase 1 (Stabilize Rhythm):** Audit all `boxSurface` and `textSurface` calls. Replace magic numbers with 2-cell tokens.
2. **Phase 2 (Extract Blocks):** Move `repo-treemap.js` and `merkle-dag.js` into a `bin/ui/blocks/` directory. Wrap them in Mantine-style interfaces.
3. **Phase 3 (Transition Shaders):** Replace `applyTransitionEffect` with `animate(model, { shader: 'dissolve' })`.
4. **Phase 4 (CLI Polishing):** Update `bin/git-cas.js` to use TUI blocks for `inspect`, `doctor`, and `list`.

---
**Signed,**
*EXPERT Bijou BigBro*
*(Industrial-Grade Mentorship)*
