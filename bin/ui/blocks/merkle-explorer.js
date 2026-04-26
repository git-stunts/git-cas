/**
 * MerkleExplorer block — unified view of manifest chunk structure.
 *
 * Supports three modes:
 * - 'table': flat chunk ledger (index, size, digest, blob)
 * - 'tree': sub-manifest hierarchy as a tree
 * - 'dag': full Merkle DAG visualization
 *
 * All three modes consume the same ManifestData input.
 */

import { table, tree } from '@flyingrobots/bijou';
import { buildDagSource } from '../merkle-dag.js';

/**
 * @typedef {import('../../../src/domain/value-objects/Manifest.js').ManifestData} ManifestData
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {'table' | 'tree' | 'dag'} MerkleViewMode
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
 * Determine which modes are available for a manifest.
 *
 * @param {ManifestData} manifest
 * @returns {MerkleViewMode[]}
 */
export function availableModes(manifest) {
  /** @type {MerkleViewMode[]} */
  const modes = ['table'];
  if (manifest.subManifests?.length) {
    modes.push('tree', 'dag');
  }
  return modes;
}

/**
 * Render the chunk table view.
 *
 * @param {ManifestData} manifest
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderChunkTable(manifest, ctx) {
  const chunks = manifest.chunks || [];
  const displayChunks = chunks.slice(0, 20);
  const rows = displayChunks.map((c) => [
    String(c.index),
    formatBytes(c.size),
    typeof c.digest === 'string' ? `${c.digest.slice(0, 12)}...` : '-',
    typeof c.blob === 'string' ? `${c.blob.slice(0, 12)}...` : '-',
  ]);
  const chunkTable = table({
    columns: [{ header: '#' }, { header: 'Size' }, { header: 'Digest' }, { header: 'Blob' }],
    rows,
    ctx,
  });
  const suffix = chunks.length > 20 ? `\n  ...and ${chunks.length - 20} more` : '';
  return `${chunkTable}${suffix}`;
}

/**
 * Render the sub-manifest tree view.
 *
 * @param {ManifestData} manifest
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderSubManifestTree(manifest, ctx) {
  const subs = manifest.subManifests || [];
  if (subs.length === 0) {
    return 'No sub-manifests';
  }
  const nodes = subs.map((sm, i) => ({
    label: `sub-${i}  ${sm.chunkCount} chunks  start: ${sm.startIndex}  oid: ${sm.oid.slice(0, 8)}...`,
  }));
  return tree(nodes, { ctx });
}

/**
 * Build DAG source data for the dagPane component.
 * Re-exports from merkle-dag.js for convenience.
 *
 * @param {ManifestData} manifest
 * @returns {ReturnType<typeof buildDagSource>}
 */
export function buildMerkleDagSource(manifest) {
  return buildDagSource(manifest);
}

/**
 * Render a merkle explorer view in the specified mode.
 *
 * @param {ManifestData} manifest
 * @param {MerkleViewMode} mode
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderMerkleExplorer(manifest, mode, ctx) {
  if (mode === 'tree') {
    return renderSubManifestTree(manifest, ctx);
  }
  if (mode === 'dag') {
    return `[DAG mode — use 'm' key in dashboard for interactive view]`;
  }
  return renderChunkTable(manifest, ctx);
}
