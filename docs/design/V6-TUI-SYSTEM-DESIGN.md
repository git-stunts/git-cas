# V6 TUI System Design: The git-cas Cockpit

_Strategic design for the industrial-grade CAS management surface, applying IBM Design Thinking and Bijou V6 Block patterns._

## 1. The Hills (Our Intent)
Hills define our mission in human terms. We are successful when:

1.  **The Operator** can identify the "Economics of the Vault" (deduplication ratio, storage growth, and encryption coverage) within **10 seconds** of opening the dashboard.
2.  **The Security Auditor** can trace the provenance of a specific asset from slug to its Merkle-root OID without leaving the dashboard.
3.  **The Developer** can perform a "Store & Sync" operation using a guided wizard that prevents "Format Drift" (incorrect chunking/encryption choices).

---

## 2. User Personas

### 👤 The Infrastructure Operator (Arlo)
- **Pain:** "I don't know how much space we're actually saving with CDC."
- **Goal:** Monitor vault health and deduplication efficiency.
- **TUI Use:** Full-screen monitoring, "atlas" treemaps.

### 👤 The Security Lead (Sasha)
- **Pain:** "Is this backup actually encrypted? Who has access?"
- **Goal:** Audit recipients and verify cryptographic integrity.
- **TUI Use:** Encryption cards, recipient management, `doctor` sweeps.

---

## 3. The "Service-to-Surface" Map

The TUI is organized into three primary **Workspaces**.

### Workspace A: The Explorer (Primary)
**Purpose:** Navigation and Inspection.
- **Features:** 
    - Full-text slug filtering.
    - Responsive asset ledger (Table).
    - Deep-tissue manifest inspection (Merkle DAG).
- **Components:** `Shell`, `AssetLedgerBlock`, `InspectorBlock`, `MerkleLensBlock`.

### Workspace B: The Atlas (Strategic)
**Purpose:** Understanding repo-wide CAS impact.
- **Features:**
    - Repo-vs-Source treemap toggling.
    - Drill-down into specific Git namespaces.
- **Components:** `TreemapBlock`, `AtlasSidebarBlock`, `Breadcrumb`.

### Workspace C: The Operations Deck (Feedback)
**Purpose:** Lifecycle management and long-running tasks.
- **Features:**
    - Guided Store Wizard.
    - Vault integrity "Doctor" sweeps.
    - Timeline of recent vault rotations.
- **Components:** `WizardBlock`, `HealthDashboardBlock`, `Timeline`.

---

## 4. Screen-by-Screen Component Breakdown

### Surface 1: The Shell (Persistent)
The "Frame" that hosts all other blocks.
- **Top:** `HeaderBlock` (Title + Source Status + Global Badges).
- **Middle:** Dynamic Content Area (Workspace A, B, or C).
- **Bottom:** `FooterBlock` (Keybinding Hints + Status Rail).
- **Overlay Layer:** `CommandPalette`, `NotificationStack`.

### Surface 2: Entry Ledger (Workspace A)
- **Block:** `AssetTable`
    - Uses `navigableTable` for high-performance scrolling.
    - Uses `badge` for inline metadata (Size, Crypto, Format).
- **Block:** `InspectorCard`
    - Uses `markdown` for asset descriptions.
    - Uses `badge` for cryptographic status.
- **Block:** `MerkleLens`
    - Uses `segmentedControl` (V6) to toggle Table/Tree/DAG.

### Surface 3: Repository Atlas (Workspace B)
- **Block:** `TreemapMap`
    - Uses `canvas` (TUI) for shader-based region rendering.
- **Block:** `AtlasBriefing`
    - Uses `sectionHeading` for categorized stats.
    - Uses `scrollbar` for long legend lists.

---

## 5. Interaction Patterns: "Geometric Intent"

1.  **The Rule of 2:** Every major workspace split (Sidebar vs Content) is separated by a 2-cell gap.
2.  **Focus Ownership:** Focus is indicated by the `primary` token cursor (▸) and a `brand` border highlight.
3.  **Graceful Lowering:** All screens must be readable in `noColor` mode (using box-drawing characters and `[brackets]` for badges).

---

## 6. Success Metrics (Playback)

- **Test A:** Can a user find an asset by SHA-256 digest using the palette (Ctrl+P)?
- **Test B:** Does the UI remain responsive during a 1GB `store` operation? (Verified via `OperationFeed` progress blocks).
- **Test C:** Does the Merkle DAG view correctly "lower" to a text-list in CI environments?

---
**Signed,**
*EXPERT Bijou BigBro*
*(IBM Design Thinking Certified)*
