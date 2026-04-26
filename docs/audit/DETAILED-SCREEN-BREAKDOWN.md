# 🔬 Deep-Tissue UI Audit: git-cas V4 → V6
**Date:** 2026-04-26
**Auditor:** EXPERT Bijou BigBro

This document represents the "crawl under the porch" architectural inspection of the `git-cas` TUI layer (`bin/ui/*`). It catalogs every structural violation, "sludge" pattern, and geometric flaw across all screens and components.

---

## 1. The Root Shell (`dashboard-view.js`)

**Purpose:** Hosts the interactive `git-cas vault dashboard` explorer.

### 🛑 Architectural & Sludge Violations
- **Manual Blit Math:** `renderDashboard` computes layout via `screen.blit(header, 0, 0)` and `bodyTop = header.height`. This brittle math breaks if components change height dynamically.
- **Rhythm Violation:** Scattered use of `spacer(1, 1)` and magic numbers like `Math.max(32, Math.min(56, opts.width - 2))` in drawer logic.
- **Manual String Wrapping:** `limitWrappedLines` and `wrapWhitespaceText` reinvent layout logic that the V5 `text()` or `markdown()` components handle natively.
- **Array Mutation Sludge:** `headerParts` conditionally pushes string/Surface badges into an array and joins them, rather than using a declarative `row()` or `Stack`.
- **View-State Leakage:** Slicing logic for the refs-list viewport (`buildRefsViewport`) is managed directly in the view layer instead of a selector.

### 🛠 V6 Prescription
- Replace manual blitting with `createTuiAppSkeleton` or a custom `FlexLayout` block.
- Use `column({ gap: 2 })` and `row({ gap: 1 })` to enforce the 2-cell rhythm globally.

---

## 2. Store Wizard (`store-wizard.js`)

**Purpose:** Guided TUI flow for `git-cas vault store`.

### 🛑 Architectural & Sludge Violations
- **String Parsing for Geometry:** `renderWizardSurface` counts lines via `body.split('\n').length` to calculate the panel height. This is a severe violation of "Geometric Lawfulness." The height should be calculated by the layout engine (`Surface.measure`), not by regexing strings.
- **Hardcoded Padding:** The wizard manually injects `\n` to space out steps (`lines.push('')`).
- **Primitive Obsession:** `renderSelectList` manually injects focus cursors (`▸`) using string concatenation.

### 🛠 V6 Prescription
- Build a generic `WizardBlock` in Bijou that takes an array of `Step` objects.
- Use `radioGroup()` or `list()` for the selection lists rather than string assembly.

---

## 3. Manifest Anatomy (`manifest-view.js`)

**Purpose:** Used by `git-cas inspect` and the Dashboard Inspector pane.

### 🛑 Architectural & Sludge Violations
- **Boundary Leakage:** `renderManifestView` checks `if ('toJSON' in manifest) manifest.toJSON()`. The UI layer should only receive decoded, pure domain data. Data normalization is an adapter concern, not a view concern.
- **Array-to-String Layout:** The function pushes strings into a `sections` array and calls `sections.join('\n\n')`. This bypasses the Bijou layout engine entirely.
- **Magic Table Padding:** The `chunksBody` manually truncates digests via `digest.slice(0, 12)` instead of letting a column-width constraint handle clipping.

### 🛠 V6 Prescription
- The component must return a `Surface` or `LayoutNode`, not a `string`.
- Use `box()` and `stack()` primitives to handle section layout without `\n\n`.

---

## 4. Vault Reporting (`vault-report.js`)

**Purpose:** Output for `git-cas vault stats` and `git-cas doctor`.

### 🛑 Architectural & Sludge Violations
- **The "PadEnd" Anti-Pattern:** `renderKeyValueLines` calculates max label length and calls `label.padEnd(labelWidth)`. This is manual table-rendering sludge. 
- **View/Domain Mixing:** `inspectVaultHealth` executes domain queries (`cas.getVaultService()`) in the same file that exports `renderDoctorReport`.

### 🛠 V6 Prescription
- Use the Bijou `table()` component with `border: 'none'` to achieve aligned key-value pairs without manual string padding.
- Move `inspectVaultHealth` into `application/` or `dashboard-cmds.js` to restore hexagonal boundaries.

---

## 5. History Timeline (`history-timeline.js`)

**Purpose:** Output for `git-cas vault history --pretty`.

### 🛑 Architectural & Sludge Violations
- **Adapter Leakage:** `parseCommitLine` executes regex parsing of Git commit messages (`/^vault:\s*(init|add|update|remove)\s*(.*)$/`) directly inside the UI module. Parsing Git stdout is a pure infrastructure adapter concern.
- **Incomplete Surface Usage:** The function returns a concatenated string (`output += \n...`) instead of a unified `Surface`.

### 🛠 V6 Prescription
- The parser must be extracted to `src/infrastructure/git-adapter.js`.
- The view function must accept an array of typed `VaultCommitEvent` objects.

---

## 6. IO Progress (`progress.js`)

**Purpose:** Animated progress bars for CLI `store`/`restore`.

### 🛑 Architectural & Sludge Violations
- **Raw ANSI Leakage:** `handleChunkEvent` manually emits raw escape codes (`\r\x1b[K`) directly to `deps.ctx.io.write`. This breaks Bijou's cross-platform port abstraction. If `ctx.mode` changes to accessible or pipe, raw ANSI will corrupt the output stream.

### 🛠 V6 Prescription
- Never write raw ANSI in application code. Use `ctx.writeLine()` or `ctx.updateLine()` and let the Bijou adapter handle the VT100 control sequences.

---

## 7. Encryption Card (`encryption-card.js`)

**Purpose:** Output for `git-cas vault info --encryption`.

### 🛑 Architectural & Sludge Violations
- **Sludge Assembly:** The view pushes strings into an array (`rows.push(...)`) and joins them with `\n`.
- **String Context Confusion:** `surfaceToString(badge(...))` is used to convert a Bijou 2D surface back into a 1D string to be concatenated into the array. This is expensive and destroys layout invariants.

### 🛠 V6 Prescription
- Return a `boxSurface()` or `LayoutNode`.
- Use `row([label, gap(2), badge])` for inline components instead of coercing surfaces to strings.

---

## 8. Heatmap (`heatmap.js`)

**Purpose:** Output for `git-cas inspect --heatmap`.

### 🛑 Architectural & Sludge Violations
- **Manual Grid Math:** Calculates grid wrapping manually by counting `col >= width` and inserting `\n`.
- **Hardcoded Geometry:** `Math.min(60, (ctx.runtime.columns || 80) - 10)`

### 🛠 V6 Prescription
- Promote `Heatmap` to a first-class `bijou-tui` primitive. The component should accept an array of values and automatically calculate grid wrapping using `Surface.width`.

---

**Crawl Complete.**
The foundations have been thoroughly inspected. Every instance of "Sludge," "String Layout," and "View-State Leakage" has been documented.
