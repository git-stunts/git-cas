# TR — Manifest Diffing

## The Idea

Compare two manifests to find which chunks changed between versions of an asset.
Returns added, removed, and unchanged chunks with their digests and positions.

```js
const diff = cas.diffManifests(oldManifest, newManifest);
// { added: [chunk3, chunk4], removed: [chunk2], unchanged: [chunk0, chunk1] }
```

## Why It's Interesting

- **Incremental sync**: Only transfer changed chunks when syncing between repos
  or to remote storage. Bandwidth savings proportional to dedup ratio.
- **Change visualization**: Show which byte ranges of an asset were modified
  between versions. Useful for binary diff tooling.
- **Efficient restore**: If you already have a prior version restored locally,
  only fetch the chunks you're missing.
- **Audit trail**: Log exactly which chunks changed per version, not just
  "the whole file changed."
- Trivially implementable — it's a set difference on chunk digests. The
  interesting part is the API design and integration with restore/sync.

## Design Sketch

```js
diffManifests(oldManifest, newManifest) → {
  added: Chunk[],      // in new, not in old
  removed: Chunk[],    // in old, not in new
  unchanged: Chunk[],  // in both (by digest)
  reordered: boolean,  // same chunks, different order
}
```

CDC makes this powerful — small edits only affect nearby chunks, so most
chunks survive across versions.
