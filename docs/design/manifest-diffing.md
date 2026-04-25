# Design: Manifest Diffing

## Problem

No way to compare two versions of an asset to find what changed at the chunk
level. Operators must re-transfer entire assets even when CDC means most chunks
survived unchanged.

## Solution

A pure domain function that compares two manifests by chunk digest.

### API

```js
// Domain service (CasService)
const diff = service.diffManifests(oldManifest, newManifest);

// Facade
const diff = cas.diffManifests(oldManifest, newManifest);
```

### Return Shape

```js
{
  added: Chunk[],       // in new, not in old (by digest)
  removed: Chunk[],     // in old, not in new (by digest)
  unchanged: Chunk[],   // in both (by digest), positions from new manifest
  summary: {
    addedCount: number,
    removedCount: number,
    unchangedCount: number,
    addedBytes: number,
    removedBytes: number,
    unchangedBytes: number,
  }
}
```

### Algorithm

1. Build a Set of old digests
2. Build a Set of new digests
3. Walk new chunks: if digest in old set → unchanged, else → added
4. Walk old chunks: if digest not in new set → removed
5. Compute summary stats

O(n + m) time, O(n + m) space. No persistence I/O — pure in-memory.

### Where It Lives

`src/domain/services/ManifestDiff.js` — a standalone module with no class,
no state, no dependencies beyond the Chunk/Manifest types. A pure function.

CasService exposes it as `diffManifests(old, new)`.
Facade exposes it as `cas.diffManifests(old, new)`.

### No Port Needed

This is pure domain logic — set algebra on digests. No crypto, no persistence,
no compression. Just data in, data out.
