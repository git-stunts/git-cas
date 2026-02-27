/**
 * Chunk heatmap visualization — visual block map of chunks.
 */

import { gradientText } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';

const GRADIENT_STOPS = [
  { pos: 0, color: [0, 255, 255] },
  { pos: 1, color: [255, 0, 255] },
];

/**
 * Format bytes as human-readable string.
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
 * Build the block grid string from chunks.
 */
function buildGrid(chunks, boundaries, width) {
  let grid = '';
  let col = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (boundaries.has(i) && col > 0) {
      grid += '\n';
      col = 0;
    }

    grid += '\u2588';
    col++;

    if (col >= width) {
      grid += '\n';
      col = 0;
    }
  }

  if (col > 0) {
    grid += '\n';
  }
  return grid;
}

/**
 * Build the legend line.
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
 * Render a chunk heatmap for a manifest.
 *
 * @param {Object} options
 * @param {Object} options.manifest - The manifest (from readManifest).
 * @returns {string}
 */
export function renderHeatmap({ manifest }) {
  const ctx = getCliContext();
  const m = manifest.toJSON ? manifest.toJSON() : manifest;
  const chunks = m.chunks || [];

  if (chunks.length === 0) {
    return 'No chunks to display\n';
  }

  const width = Math.min(60, (ctx.runtime.columns || 80) - 10);
  const subManifests = m.subManifests || [];

  const boundaries = new Set();
  for (const sm of subManifests) {
    if (sm.startIndex > 0) {
      boundaries.add(sm.startIndex);
    }
  }

  const grid = buildGrid(chunks, boundaries, width);
  const colored = gradientText(grid, GRADIENT_STOPS, { style: ctx.style });
  const legend = buildLegend(chunks, subManifests);

  return `${colored}\n${legend}\n`;
}
