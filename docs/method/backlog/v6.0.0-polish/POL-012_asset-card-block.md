# POL-012: Extract AssetCard block

## Source
Bijou BigBro Audit (2026-04-26) — Main Audit Section 2, Block 1

## What
`encryption-card.js` and the manifest detail pane in `dashboard-view.js` both render asset metadata as ad-hoc string arrays. There's no shared "asset card" component — each view reinvents its own boxed-panel-with-badges layout.

## Fix
Create `bin/ui/blocks/asset-card.js` — a structured component that takes an asset entity (manifest data + vault entry) and returns a `Surface`. Features:
- Automatic truncation of long slugs/OIDs
- Status badges for crypto/compression/chunking
- 2-cell rhythm internal padding
- Reusable across dashboard detail pane, CLI `inspect`, and CLI `vault info`

## Files
- `bin/ui/blocks/asset-card.js` (new)
- `bin/ui/dashboard-view.js` (consume)
- `bin/ui/encryption-card.js` (replaced or wrapped)

## Effort
Medium
