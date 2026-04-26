# 📊 Bijou BigBro Scorecard & Homework
**Date:** 2026-04-26 09:45:12
**Target:** `git-cas` TUI Dashboard
**Status:** Architectural Intervention Required

## 🏆 The Scorecard

| Category | Grade | Logic |
| :--- | :---: | :--- |
| **TEA Purity** | **A-** | Model/Update/View split is clean. Command routing is robust. |
| **Geometric Lawfulness** | **C+** | Heavy reliance on magic numbers and manual "pixel-pushing." |
| **Semantic Truth** | **B** | Uses tokens correctly, but lacks a cohesive component vocabulary. |
| **Anti-SLUDGE Compliance** | **B-** | Significant "View-State Leakage" in the render functions. |
| **Orchestration** | **B+** | View stack and overlays are handled well, but logic is fragmented. |

**OVERALL GRADE: B-**

---

## 💪 Strengths
- **Robust TEA Loop:** The use of `startApp` and command orchestration is industry-standard.
- **Hexagonal Integrity:** The UI correctly stays behind the `BijouContext` port, ensuring runtime portability (Node/Bun/Deno).
- **Rich Data Viz:** The treemap and Merkle DAG implementations prove that the framework can handle high-density information.

## ⚠️ Weaknesses
- **Geometric Illiteracy:** Manual width/height math (e.g., `rows - 4 - 3 - 2 - 2`) makes the layout brittle.
- **Component Fragmentation:** Every view reinvented its own "Boxed Panel" logic instead of using a shared `WorkspaceBlock`.
- **View-State Leakage:** Slicing and scrolling logic is often found in the `render` functions rather than the domain selectors.

---

## 🚫 Violation Checklist

- [x] **V-001: Rhythm Violation** - Use of `spacer(1, 1)` and `'  '` instead of the **Rule of 2** (2-cell gaps).
- [x] **V-002: Magic Numbers** - Hardcoded offsets in `renderDashboard` (`bodyTop = header.height`).
- [x] **V-003: String Sludge** - Use of `.join('\n')` for vertical layout instead of `vstackSurface`.
- [x] **V-004: Manual Clipping** - Implementing `tailClip` manually instead of using `clipToWidth` from `bijou-tui`.
- [x] **V-005: Focus Confusion** - Custom logic for focus indicators (▸) instead of using the `ui.cursor` token.

---

## 🧐 "Weird Usages" (The Smoothing List)

### 1. The "Manual Blit" Pattern
**Found in:** `renderDashboard`
**Weirdness:** Manually calculating where the footer goes.
**Smoothing:** Use `createFramedApp` skeleton which provides a declarative `header`, `footer`, and `body` region automatically.

### 2. The "Badge Array" Pattern
**Found in:** `headerParts`
**Weirdness:** Pushing surfaces into an array and joining them.
**Smoothing:** Use a `ToolbarBlock`. It should manage the spacing and "overflow dropping" of badges automatically.

### 3. The "Pseudo-Shader" Pattern
**Found in:** `applyTransitionEffect`
**Weirdness:** Manually filling with blank cells to simulate a wipe.
**Smoothing:** Use the built-in `transition-shaders.ts`. It provides hardware-accelerated (packed-buffer) transitions like `dissolve`, `slide`, and `wipe`.

---

## 📚 Homework Assignment

### 1. Stabilize the Pulse
Replace all `spacer(1, 1)` calls with a semantic `gap(2)` constant or `spacer(2, 2)` to align with the **2-cell rhythm**.

### 2. Extract the Blocks
Refactor `bin/ui/encryption-card.js` into a first-class `AssetCardBlock`. It must return a `Surface`, not a string.

### 3. Adopt the Skeleton
Migrate the root `renderDashboard` from manual blitting to the `createTuiAppSkeleton`.

### 4. Semantic Filtering
Move the slug filtering logic from `dashboard-view.js` into a domain selector in `dashboard-cmds.js`. The View should only receive the *result* of the filter.

---
**Signed,**
*EXPERT Bijou BigBro*
*(HOO RAH!)*
