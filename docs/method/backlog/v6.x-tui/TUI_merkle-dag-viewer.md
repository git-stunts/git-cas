# TUI-008: Merkle DAG viewer

## What

Use Bijou v5's `dagPane` to visualize the Merkle manifest structure of v2 manifests. When inspecting a manifest with sub-manifests, show the DAG: root manifest node connecting to sub-manifest nodes, each sub-manifest connecting to its chunk nodes. This is a new view — the existing treemap shows size distribution across the repository; the DAG shows the internal structure of a single stored asset.

## Why

v2 manifests introduced Merkle trees for content-addressed chunking. A large file stored with CDC produces a root manifest pointing to multiple sub-manifests, each containing a subset of chunks. Understanding this structure is critical for debugging storage efficiency, verifying integrity, and reasoning about deduplication. Currently, sub-manifests are shown as a flat `tree()` list in `manifest-view.js` (`renderSubManifestsSection`) — the user sees `sub-0`, `sub-1`, etc., but has no visual sense of the DAG topology, depth, or fan-out.

## Current State

- `manifest-view.js` lines 135–141 — `renderSubManifestsSection()` uses Bijou's `tree()` component to render sub-manifests as a flat list with labels like `sub-0  12 chunks  start: 0  oid: a1b2c3d4...`.
- The manifest data model (`ManifestData`) includes `subManifests: SubManifestRef[]` where each ref has `oid`, `chunkCount`, `startIndex`, `endIndex`.
- No existing DAG visualization exists in the TUI.

## Design

### Bijou v5 Components Used

- `dagPane(nodes, edges, options)` — renders a navigable directed acyclic graph with node labels and edge connections
- `boxSurface` — container for the DAG view panel
- Keyboard navigation within the DAG (arrow keys to traverse nodes)

### Implementation Plan

1. Add a new view mode or drawer for the DAG viewer. Options:
   - **Option A**: New tab alongside list/treemap/refs, activated by `m` (merkle) key.
   - **Option B**: Drawer that opens from the detail pane when viewing a v2 manifest, activated by `m` key.
   - Recommend Option B — the DAG is per-manifest, not a global view.
2. Build the DAG data from a manifest:
   - Root node: `{ id: 'root', label: manifest.slug, detail: formatBytes(manifest.size) }`
   - Sub-manifest nodes: `{ id: sub.oid, label: 'sub-N', detail: '${sub.chunkCount} chunks' }`
   - Chunk nodes (optional, toggleable): `{ id: chunk.digest, label: '#N', detail: formatBytes(chunk.size) }`
   - Edges: root -> each sub-manifest, each sub-manifest -> its chunks.
3. Create `renderMerkleDAG(manifest, options)` in a new file `bin/ui/merkle-dag.js` (or extend `manifest-view.js`).
4. Add `m` keybinding mapped to `{ type: 'open-merkle-dag' }` action. Only active when a v2 manifest is selected.
5. Add `'merkle-dag'` to `activeDrawer` or use a separate `merkleDAGVisible` flag.
6. Render the DAG in a full-width overlay or split alongside the manifest inspector.
7. Support node selection in the DAG — pressing enter on a sub-manifest node could load its full manifest detail.

### Files Modified

- `bin/ui/merkle-dag.js` — new file, DAG data builder and render function
- `bin/ui/dashboard.js` — add `open-merkle-dag` action, DAG state management, `m` keybinding
- `bin/ui/dashboard-view.js` — render DAG overlay/drawer in `renderOverlays()`

### Dependencies

- TUI-001 (framed app shell)
- TUI-002 (boxSurface for DAG panel container)

## Acceptance Criteria

- [ ] `m` key opens the Merkle DAG viewer when a v2 manifest is selected
- [ ] DAG shows root manifest -> sub-manifests -> chunks topology
- [ ] Node labels show OID prefix, chunk count, and size
- [ ] DAG is navigable with arrow keys
- [ ] Pressing enter on a sub-manifest node shows its detail
- [ ] DAG viewer gracefully handles manifests with no sub-manifests (shows single root node)
- [ ] DAG viewer handles large manifests (50+ sub-manifests) without rendering artifacts
- [ ] `escape` closes the DAG viewer
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Large
