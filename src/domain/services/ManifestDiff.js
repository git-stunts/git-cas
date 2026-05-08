/**
 * @fileoverview Manifest diffing — pure domain function.
 *
 * Compares two manifests by chunk digest to find added, removed, and
 * unchanged chunks. No I/O, no ports, no state — just set algebra.
 */

/**
 * @typedef {Object} ManifestDiffResult
 * @property {import('../value-objects/Chunk.js').default[]} added - Chunks in `newManifest` not in `oldManifest`.
 * @property {import('../value-objects/Chunk.js').default[]} removed - Chunks in `oldManifest` not in `newManifest`.
 * @property {import('../value-objects/Chunk.js').default[]} unchanged - Chunks in both (by digest), from `newManifest`.
 * @property {{ addedCount: number, removedCount: number, unchangedCount: number, addedBytes: number, removedBytes: number, unchangedBytes: number }} summary
 */

/**
 * Compares two manifests by chunk digest.
 *
 * @param {Manifest} oldManifest
 * @param {Manifest} newManifest
 * @returns {ManifestDiffResult}
 */
export default function diffManifests(oldManifest, newManifest) {
  const oldDigests = new Set(oldManifest.chunks.map((c) => c.digest));
  const newDigests = new Set(newManifest.chunks.map((c) => c.digest));

  const added = [];
  const unchanged = [];
  for (const chunk of newManifest.chunks) {
    if (oldDigests.has(chunk.digest)) {
      unchanged.push(chunk);
    } else {
      added.push(chunk);
    }
  }

  const removed = oldManifest.chunks.filter((c) => !newDigests.has(c.digest));

  const sum = (arr) => arr.reduce((acc, c) => acc + c.size, 0);

  return {
    added,
    removed,
    unchanged,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      unchangedCount: unchanged.length,
      addedBytes: sum(added),
      removedBytes: sum(removed),
      unchangedBytes: sum(unchanged),
    },
  };
}
