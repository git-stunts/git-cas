/**
 * Chunk heatmap visualization — visual block map of chunks.
 */

import { getCliContext } from './context.js';
import { renderHeatmapGrid } from './blocks/heatmap-block.js';

/**
 * @typedef {import('../../src/domain/value-objects/Manifest.js').ManifestData} ManifestData
 * @typedef {import('../../src/domain/value-objects/Manifest.js').SubManifestRef} SubManifestRef
 */

const HEATMAP_MAX_WIDTH = 60;
const HEATMAP_MARGIN = 10;

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
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

/**
 * Build the legend line.
 *
 * @param {ManifestData['chunks']} chunks
 * @param {SubManifestRef[]} subManifests
 * @returns {string}
 */
function buildLegend(chunks, subManifests) {
  const chunkSize = chunks.length > 0 ? chunks[0].size : 0;
  const parts = [`${chunks.length} chunks`];
  if (subManifests.length) {
    parts.push(`${subManifests.length} sub-manifests`);
  }
  if (chunkSize) {
    parts.push(`${formatBytes(chunkSize)}/chunk`);
  }
  return parts.join('  ');
}

/**
 * Collect sub-manifest boundary indices.
 *
 * @param {SubManifestRef[]} subManifests
 * @returns {number[]}
 */
function collectBreaks(subManifests) {
  return subManifests
    .filter((sm) => sm.startIndex > 0)
    .map((sm) => sm.startIndex);
}

/**
 * Render a chunk heatmap for pre-normalized manifest data.
 *
 * @param {Object} options
 * @param {ManifestData} options.manifest - Pre-normalized manifest data.
 * @returns {string}
 */
export function renderHeatmap({ manifest }) {
  const ctx = getCliContext();
  const chunks = manifest.chunks || [];

  if (chunks.length === 0) {
    return 'No chunks to display\n';
  }

  const width = Math.min(HEATMAP_MAX_WIDTH, (ctx.runtime.columns || 80) - HEATMAP_MARGIN);
  const subManifests = manifest.subManifests || [];
  const breaks = collectBreaks(subManifests);

  const colored = renderHeatmapGrid(chunks.length, {
    width,
    breaks,
    style: ctx.style,
  });
  const legend = buildLegend(chunks, subManifests);

  return `${colored}\n${legend}\n`;
}
