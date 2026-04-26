/**
 * HeatmapBlock — grid visualization of chunk values with gradient coloring.
 *
 * Accepts an array of cell values and renders a wrapped grid using
 * Surface construction. Handles responsive wrapping based on available
 * width without manual column counting.
 */

import { gradientText } from '@flyingrobots/bijou';

/** @type {import('@flyingrobots/bijou').GradientStop[]} */
const DEFAULT_GRADIENT = [
  { pos: 0, color: [0, 255, 255] },
  { pos: 1, color: [255, 0, 255] },
];

const BLOCK_CHAR = '\u2588';

/**
 * @typedef {Object} HeatmapOptions
 * @property {number} width - Available width in columns.
 * @property {number[]} [breaks] - Indices where a line break should be forced (e.g. sub-manifest boundaries).
 * @property {import('@flyingrobots/bijou').GradientStop[]} [gradient] - Custom gradient stops.
 * @property {import('@flyingrobots/bijou').StyleFunction} [style] - Style function for gradient rendering.
 */

/**
 * Render a heatmap grid as a gradient-colored string.
 *
 * Each cell is a single block character. Cells wrap at `width` columns.
 * Optional `breaks` array forces line breaks at specific indices
 * (e.g. sub-manifest boundaries).
 *
 * @param {number} cellCount - Number of cells to render.
 * @param {HeatmapOptions} options
 * @returns {string}
 */
export function renderHeatmapGrid(cellCount, options) {
  const { width, breaks, gradient = DEFAULT_GRADIENT, style } = options;
  const breakSet = breaks ? new Set(breaks) : new Set();
  const gridWidth = Math.max(1, width);

  const rows = [];
  let row = '';
  let col = 0;

  for (let i = 0; i < cellCount; i++) {
    if (breakSet.has(i) && col > 0) {
      rows.push(row);
      row = '';
      col = 0;
    }
    row += BLOCK_CHAR;
    col++;
    if (col >= gridWidth) {
      rows.push(row);
      row = '';
      col = 0;
    }
  }
  if (row.length > 0) {
    rows.push(row);
  }

  const grid = rows.join('\n');
  return gradientText(grid, gradient, { style });
}
