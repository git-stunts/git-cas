# POL-013: Unify MerkleExplorer block (Table/Tree/DAG)

## Source
Bijou BigBro Audit (2026-04-26) — Main Audit Section 2, Block 2

## What
`merkle-dag.js` and `manifest-view.js` are separate concerns that both visualize chunk/sub-manifest structure. The audit proposes a unified "MerkleExplorer" block that toggles between three views of the same data:
- **Table** (flat chunk list — current `chunksBody`)
- **Tree** (directory-style sub-manifest tree — current `subManifestsBody`)
- **DAG** (Merkle graph — current `merkle-dag.js`)

Currently the user must know to press `m` for the DAG and scroll through the accordion for the other views. A segmented control would make all three accessible from one component.

## Fix
Create `bin/ui/blocks/merkle-explorer.js` — a block that:
1. Accepts manifest data as input
2. Renders a mode selector (table/tree/dag) at the top
3. Delegates to the appropriate view based on mode
4. Shares state (selected chunk, scroll position) across modes where applicable

## Files
- `bin/ui/blocks/merkle-explorer.js` (new)
- `bin/ui/merkle-dag.js` (refactor into block)
- `bin/ui/manifest-view.js` (chunk/sub-manifest sections delegate to block)
- `bin/ui/dashboard.js` (mode state, keybindings)

## Effort
Large
