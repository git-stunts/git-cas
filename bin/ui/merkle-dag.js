/**
 * Merkle DAG data builder — converts a manifest into dagPane source nodes.
 */

/**
 * @typedef {import('../../src/domain/value-objects/Manifest.js').ManifestData} ManifestData
 */

/**
 * Format bytes as human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Build dagPane source nodes from a manifest.
 *
 * For a manifest with sub-manifests (Merkle tree):
 *   root → sub-0, sub-1, ... → chunk nodes per sub-manifest
 *
 * For a flat manifest (no sub-manifests):
 *   root → chunk-0, chunk-1, ...
 *
 * @param {ManifestData} manifest
 * @returns {{ id: string, label: string, children: string[] }[]}
 */
export function buildDagSource(manifest) {
  const nodes = [];
  const subs = manifest.subManifests || [];
  const chunks = manifest.chunks || [];

  if (subs.length > 0) {
    const rootChildren = subs.map((_, i) => `sub-${i}`);
    nodes.push({
      id: 'root',
      label: `${manifest.slug}  ${formatBytes(manifest.size)}  ${chunks.length} chunks`,
      children: rootChildren,
    });
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      const subChunks = chunks.slice(sub.startIndex, sub.startIndex + sub.chunkCount);
      const chunkChildren = subChunks.map((c) => `chunk-${c.index}`);
      nodes.push({
        id: `sub-${i}`,
        label: `sub-${i}  ${sub.chunkCount} chunks  ${sub.oid.slice(0, 8)}...`,
        children: chunkChildren,
      });
      for (const c of subChunks) {
        nodes.push({
          id: `chunk-${c.index}`,
          label: `#${c.index}  ${formatBytes(c.size)}  ${c.digest.slice(0, 8)}`,
          children: [],
        });
      }
    }
  } else {
    const chunkChildren = chunks.map((c) => `chunk-${c.index}`);
    nodes.push({
      id: 'root',
      label: `${manifest.slug}  ${formatBytes(manifest.size)}`,
      children: chunkChildren,
    });
    for (const c of chunks) {
      nodes.push({
        id: `chunk-${c.index}`,
        label: `#${c.index}  ${formatBytes(c.size)}  ${c.digest.slice(0, 8)}`,
        children: [],
      });
    }
  }

  return nodes;
}
