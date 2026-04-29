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
import { renderShortSha, shortenSha } from '../components/short-sha.js';

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

function clampIndex(index, length) {
  return Math.max(0, Math.min(index, Math.max(0, length - 1)));
}

function chunkPage({ chunks, pageSize, selectedIndex }) {
  const size = pageSize ? Math.max(1, pageSize) : Math.max(1, chunks.length);
  const selected = clampIndex(selectedIndex ?? 0, chunks.length);
  const pageStart = Math.floor(selected / size) * size;
  return {
    chunks: chunks.slice(pageStart, pageStart + size),
    selected,
    pageStart,
    pageEnd: Math.min(chunks.length, pageStart + size),
    page: Math.floor(pageStart / size) + 1,
    pages: Math.max(1, Math.ceil(chunks.length / size)),
  };
}

function shaCharsForWidth(width) {
  if (!Number.isFinite(width)) { return 16; }
  if (width >= 92) { return 20; }
  if (width >= 72) { return 16; }
  return 12;
}

/**
 * Render the chunk table view.
 *
 * @param {ManifestData} manifest
 * @param {BijouContext} ctx
 * @param {{ pageSize?: number, selectedIndex?: number, width?: number }} [options]
 * @returns {string}
 */
export function renderChunkTable(manifest, ctx, options = {}) {
  const chunks = manifest.chunks || [];
  const page = chunkPage({ chunks, pageSize: options.pageSize, selectedIndex: options.selectedIndex });
  const shaChars = shaCharsForWidth(options.width);
  const rows = page.chunks.map((c, offset) => {
    const absoluteIndex = page.pageStart + offset;
    const selected = options.selectedIndex !== undefined && absoluteIndex === page.selected;
    return [
      selected ? '>' : ' ',
      String(c.index ?? absoluteIndex),
      formatBytes(c.size),
      renderShortSha(c.digest, ctx, { chars: shaChars, selected }),
      renderShortSha(c.blob, ctx, { chars: shaChars, selected }),
    ];
  });
  const chunkTable = table({
    columns: [
      { header: '', width: 1 },
      { header: '#', width: 5 },
      { header: 'Size', width: 10 },
      { header: 'Digest', width: shaChars + 3 },
      { header: 'Blob', width: shaChars + 3 },
    ],
    rows,
    ctx,
  });
  const suffix = options.pageSize && chunks.length > options.pageSize
    ? `\n  Showing ${page.pageStart + 1}-${page.pageEnd} of ${chunks.length}  Page ${page.page}/${page.pages}`
    : '';
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
    label: `sub-${i}  ${sm.chunkCount} chunks  start: ${sm.startIndex}  oid: ${shortenSha(sm.oid, 8)}`,
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
