/**
 * Render a semantic repository treemap for the dashboard.
 */

/**
 * @typedef {import('./dashboard-cmds.js').RepoTreemapReport} RepoTreemapReport
 * @typedef {import('./dashboard-cmds.js').RepoTreemapTile} RepoTreemapTile
 * @typedef {import('./dashboard.js').DashSource} DashSource
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 */

const TILE_COLOR = {
  worktree: [59, 207, 212],
  git: [252, 147, 5],
  ref: [242, 0, 148],
  vault: [166, 227, 1],
  cas: [137, 180, 250],
  meta: [148, 163, 184],
};

const TILE_FILL = {
  worktree: '█',
  git: '▓',
  ref: '▒',
  vault: '■',
  cas: '▦',
  meta: '░',
};

const TILE_LABEL = {
  worktree: 'worktree',
  git: 'git',
  ref: 'refs',
  vault: 'vault',
  cas: 'source',
  meta: 'other',
};

/**
 * Format bytes as a compact human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}K`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)}M`; }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/**
 * Build a human-readable label for the active dashboard source.
 *
 * @param {DashSource} source
 * @returns {string}
 */
function sourceLabel(source) {
  if (source.type === 'vault') {
    return 'vault';
  }
  if (source.type === 'ref') {
    return `ref ${source.ref}`;
  }
  return `oid ${source.treeOid}`;
}

/**
 * Clip long labels to fit a rectangle.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function clip(text, width) {
  if (width <= 0) {
    return '';
  }
  if (text.length <= width) {
    return text;
  }
  if (width <= 1) {
    return text.slice(0, width);
  }
  return `${text.slice(0, width - 1)}…`;
}

/**
 * Clip paths from the left so the suffix stays visible.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function tailClip(text, width) {
  if (width <= 0) {
    return '';
  }
  if (text.length <= width) {
    return text;
  }
  if (width <= 3) {
    return clip(text, width);
  }
  return `...${text.slice(text.length - (width - 3))}`;
}

/**
 * Find the next wrap position inside one line of plain text.
 *
 * @param {string} line
 * @param {number} width
 * @returns {number}
 */
function findWrapIndex(line, width) {
  const splitAt = Math.min(width, line.length);
  const boundaryChar = line[splitAt];
  if (boundaryChar && /\s/u.test(boundaryChar)) {
    return splitAt;
  }
  let backtrack = splitAt;
  while (backtrack > 0 && !/\s/u.test(line[backtrack - 1])) {
    backtrack--;
  }
  return backtrack > 0 ? backtrack : splitAt;
}

/**
 * Wrap one plain-text line to the requested width.
 *
 * Prefer breaking on the last whitespace boundary that fits inside the
 * available width. When a token is longer than the whole line budget, fall
 * back to a hard break so rendering always makes forward progress.
 *
 * @param {string} line
 * @param {number} width
 * @returns {string[]}
 */
function wrapLine(line, width) {
  if (line.length === 0) {
    return [''];
  }

  const wrapped = [];
  let remaining = line;

  while (remaining.length > width) {
    const splitAt = Math.min(width, remaining.length);
    const wrapIndex = findWrapIndex(remaining, width);
    const chunk = remaining.slice(0, wrapIndex).replace(/\s+$/u, '');
    wrapped.push(chunk || remaining.slice(0, splitAt));

    let nextStart = wrapIndex;
    while (nextStart < remaining.length && /\s/u.test(remaining[nextStart])) {
      nextStart++;
    }
    remaining = remaining.slice(nextStart);
  }

  if (remaining.length > 0 || wrapped.length === 0) {
    wrapped.push(remaining);
  }

  return wrapped;
}

/**
 * Wrap plain text into fixed-width chunks.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wrapText(text, width) {
  if (width <= 0) {
    return [''];
  }
  return text
    .split('\n')
    .flatMap((line) => wrapLine(line, width));
}

/**
 * Clamp wrapped lines to a display budget.
 *
 * @param {string[]} lines
 * @param {number} width
 * @param {number} maxLines
 * @returns {string[]}
 */
function limitLines(lines, width, maxLines) {
  if (lines.length <= maxLines) {
    return lines;
  }
  const capped = lines.slice(0, maxLines);
  capped[maxLines - 1] = `${clip(capped[maxLines - 1], Math.max(1, width - 1))}…`;
  return capped;
}

/**
 * Format a percentage for a tile relative to the whole report.
 *
 * @param {number} value
 * @param {number} total
 * @returns {string}
 */
function formatPercent(value, total) {
  if (total <= 0) {
    return '0.0%';
  }
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * Sort treemap tiles by value so the layout and detail list both reflect the
 * most significant regions first.
 *
 * @param {RepoTreemapTile[]} tiles
 * @returns {RepoTreemapTile[]}
 */
function sortTilesByValue(tiles) {
  return [...tiles].sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

/**
 * Group tiles into a binary split that approximates a treemap.
 *
 * @param {RepoTreemapTile[]} tiles
 * @returns {[RepoTreemapTile[], RepoTreemapTile[]]}
 */
function splitTiles(tiles) {
  if (tiles.length <= 1) {
    return [tiles, []];
  }

  const total = tiles.reduce((sum, tile) => sum + tile.value, 0);
  const target = total / 2;
  let bestIndex = 1;
  let bestDelta = Infinity;
  let running = 0;

  for (let index = 1; index < tiles.length; index++) {
    running += tiles[index - 1].value;
    const delta = Math.abs(target - running);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }

  return [tiles.slice(0, bestIndex), tiles.slice(bestIndex)];
}

/**
 * Recursively layout treemap rectangles.
 *
 * @param {RepoTreemapTile[]} tiles
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {boolean} vertical
 * @returns {Array<{ tile: RepoTreemapTile, x: number, y: number, width: number, height: number }>}
 */
function layoutTreemap(tiles, rect, vertical = rect.width >= rect.height) {
  if (tiles.length === 0 || rect.width <= 0 || rect.height <= 0) {
    return [];
  }
  if (tiles.length === 1) {
    return [{ tile: tiles[0], ...rect }];
  }

  const [groupA, groupB] = splitTiles(tiles);
  if (groupB.length === 0) {
    return [{ tile: groupA[0], ...rect }];
  }

  const total = tiles.reduce((sum, tile) => sum + tile.value, 0);
  const weightA = groupA.reduce((sum, tile) => sum + tile.value, 0);
  const ratio = total > 0 ? weightA / total : 0.5;

  if (vertical) {
    const widthA = Math.max(1, Math.min(rect.width - 1, Math.round(rect.width * ratio)));
    return [
      ...layoutTreemap(groupA, { x: rect.x, y: rect.y, width: widthA, height: rect.height }, !vertical),
      ...layoutTreemap(groupB, { x: rect.x + widthA, y: rect.y, width: rect.width - widthA, height: rect.height }, !vertical),
    ];
  }

  const heightA = Math.max(1, Math.min(rect.height - 1, Math.round(rect.height * ratio)));
  return [
    ...layoutTreemap(groupA, { x: rect.x, y: rect.y, width: rect.width, height: heightA }, !vertical),
    ...layoutTreemap(groupB, { x: rect.x, y: rect.y + heightA, width: rect.width, height: rect.height - heightA }, !vertical),
  ];
}

/**
 * Create an empty cell grid.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Array<Array<{ ch: string, kind: keyof typeof TILE_COLOR | null, label?: boolean }>>}
 */
function createGrid(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: ' ', kind: null })));
}

/**
 * Write one cell when it falls inside the current grid.
 *
 * @param {ReturnType<typeof createGrid>} grid
 * @param {{ row: number, col: number, ch: string, kind: RepoTreemapTile['kind'], label?: boolean }} cell
 */
function putCell(grid, cell) {
  if (grid[cell.row]?.[cell.col]) {
    grid[cell.row][cell.col] = { ch: cell.ch, kind: cell.kind, label: cell.label ?? false };
  }
}

const LABEL_FOREGROUND = [255, 255, 255];

/**
 * Paint a visible outline around a tile rectangle.
 *
 * Using box-drawing characters keeps same-kind regions readable in the map,
 * which matters most for repository scope where multiple worktree tiles can
 * otherwise blend into one solid field.
 *
 * @param {ReturnType<typeof createGrid>} grid
 * @param {{ tile: RepoTreemapTile, x: number, y: number, width: number, height: number }} rect
 */
function outlineRect(grid, rect) {
  if (rect.width < 2 || rect.height < 2) {
    return;
  }
  const top = rect.y;
  const bottom = rect.y + rect.height - 1;
  const left = rect.x;
  const right = rect.x + rect.width - 1;

  for (let col = left + 1; col < right; col++) {
    putCell(grid, { row: top, col, ch: '─', kind: rect.tile.kind });
    putCell(grid, { row: bottom, col, ch: '─', kind: rect.tile.kind });
  }
  for (let row = top + 1; row < bottom; row++) {
    putCell(grid, { row, col: left, ch: '│', kind: rect.tile.kind });
    putCell(grid, { row, col: right, ch: '│', kind: rect.tile.kind });
  }
  putCell(grid, { row: top, col: left, ch: '┌', kind: rect.tile.kind });
  putCell(grid, { row: top, col: right, ch: '┐', kind: rect.tile.kind });
  putCell(grid, { row: bottom, col: left, ch: '└', kind: rect.tile.kind });
  putCell(grid, { row: bottom, col: right, ch: '┘', kind: rect.tile.kind });
}

/**
 * Overlay a centered tile label on a painted rectangle.
 *
 * @param {ReturnType<typeof createGrid>} grid
 * @param {{ tile: RepoTreemapTile, x: number, y: number, width: number, height: number }} rect
 */
function paintLabel(grid, rect) {
  if (rect.width < 6 || rect.height < 2) {
    return;
  }
  const label = clip(rect.tile.label, rect.width - 2);
  const labelRow = rect.y + Math.floor((rect.height - 1) / 2);
  const startCol = rect.x + Math.max(0, Math.floor((rect.width - label.length) / 2));
  for (let index = 0; index < label.length; index++) {
    const cell = grid[labelRow]?.[startCol + index];
    if (cell) {
      grid[labelRow][startCol + index] = { ch: label[index], kind: rect.tile.kind, label: true };
    }
  }
}

/**
 * Paint a rectangle into the cell grid.
 *
 * @param {ReturnType<typeof createGrid>} grid
 * @param {{ tile: RepoTreemapTile, x: number, y: number, width: number, height: number }} rect
 */
function paintRect(grid, rect) {
  const fill = TILE_FILL[rect.tile.kind] ?? TILE_FILL.meta;

  for (let row = rect.y; row < rect.y + rect.height; row++) {
    for (let col = rect.x; col < rect.x + rect.width; col++) {
      if (grid[row]?.[col]) {
        grid[row][col] = { ch: fill, kind: rect.tile.kind };
      }
    }
  }
  outlineRect(grid, rect);
  paintLabel(grid, rect);
}

/**
 * Convert the cell grid into display lines.
 *
 * @param {ReturnType<typeof createGrid>} grid
 * @param {BijouContext} ctx
 * @returns {string[]}
 */
function renderGrid(grid, ctx) {
  return grid.map((row) => row.map((cell) => {
    if (!cell.kind) {
      return cell.ch;
    }
    const color = TILE_COLOR[cell.kind] ?? TILE_COLOR.meta;
    if (cell.label) {
      return ctx.style.bold(
        ctx.style.rgb(LABEL_FOREGROUND[0], LABEL_FOREGROUND[1], LABEL_FOREGROUND[2], cell.ch),
      );
    }
    return ctx.style.rgb(color[0], color[1], color[2], cell.ch);
  }).join(''));
}

/**
 * Render the legend line for the treemap kinds.
 *
 * @param {BijouContext} ctx
 * @param {number} width
 * @returns {string}
 */
function renderLegendLines(ctx, width) {
  return /** @type {Array<keyof typeof TILE_FILL>} */ (['worktree', 'git', 'ref', 'vault', 'cas', 'meta'])
    .map((kind) => {
      const fill = TILE_FILL[kind];
      const color = TILE_COLOR[kind];
      return clip(`${ctx.style.rgb(color[0], color[1], color[2], fill)} ${TILE_LABEL[kind]}`, width);
    });
}

/**
 * Render the most important tile details.
 *
 * @param {RepoTreemapTile[]} tiles
 * @param {{ totalValue: number, width: number, lines: number }} options
 * @returns {string[]}
 */
function renderDetails(tiles, options) {
  return sortTilesByValue(tiles)
    .slice(0, Math.max(0, options.lines))
    .map((tile, index) => clip(
      `${index + 1}. ${tile.label} [${TILE_LABEL[tile.kind]}] ${formatPercent(tile.value, options.totalValue)} · ${tile.detail}`,
      options.width,
    ));
}

/**
 * Render repo/source overview lines for the sidebar.
 *
 * @param {RepoTreemapReport} report
 * @param {number} width
 * @returns {string[]}
 */
function renderOverview(report, width) {
  if (report.scope === 'source') {
    return [
      clip(`scope ${report.scope}`, width),
      clip(`source ${sourceLabel(report.source)}`, width),
      clip(`root ${tailClip(report.cwd, Math.max(1, width - 5))}`, width),
      clip(`total ${formatBytes(report.totalValue)}`, width),
      clip('logical source weighting', width),
      clip(`source entries ${report.summary.sourceEntries}`, width),
      clip(`vault entries ${report.summary.vaultEntries}`, width),
    ];
  }

  return [
    clip(`scope ${report.scope}`, width),
    clip(`source ${sourceLabel(report.source)}`, width),
    clip(`root ${tailClip(report.cwd, Math.max(1, width - 5))}`, width),
    clip(`total ${formatBytes(report.totalValue)}`, width),
    clip(`${report.worktreeMode} paths ${report.summary.worktreePaths}`, width),
    clip(`worktree regions ${report.summary.worktreeItems}`, width),
    clip(`refs ${report.summary.refCount} in ${report.summary.refNamespaces} namespaces`, width),
    clip(`vault ${report.summary.vaultEntries}  source ${report.summary.sourceEntries}`, width),
  ];
}

/**
 * Render wrapped note lines for the sidebar.
 *
 * @param {RepoTreemapReport} report
 * @param {number} width
 * @param {number} lines
 * @returns {string[]}
 */
function renderNotes(report, width, lines) {
  return limitLines(report.notes.flatMap((note) => wrapText(note, width)), width, lines);
}

/**
 * Render only the treemap grid.
 *
 * @param {RepoTreemapReport} report
 * @param {{ ctx: BijouContext, width: number, height: number }} options
 * @returns {string}
 */
export function renderRepoTreemapMap(report, options) {
  const width = Math.max(12, options.width);
  const height = Math.max(4, options.height);
  const grid = createGrid(width, height);
  const layout = layoutTreemap(sortTilesByValue(report.tiles), { x: 0, y: 0, width, height });
  for (const rect of layout) {
    paintRect(grid, rect);
  }
  return renderGrid(grid, options.ctx).join('\n');
}

/**
 * Build text sections for the treemap sidebar.
 *
 * @param {RepoTreemapReport} report
 * @param {{ ctx: BijouContext, width: number, height: number }} options
 * @returns {{ overview: string, legend: string, regions: string, notes: string }}
 */
export function renderRepoTreemapSidebar(report, options) {
  const width = Math.max(16, options.width);
  return {
    overview: renderOverview(report, width).join('\n'),
    legend: renderLegendLines(options.ctx, width).join('\n'),
    regions: renderDetails(report.tiles, {
      totalValue: report.totalValue,
      width,
      lines: Math.max(3, Math.min(10, options.height - 20)),
    }).join('\n'),
    notes: renderNotes(report, width, Math.max(2, Math.min(8, options.height - 24))).join('\n'),
  };
}

/**
 * Render a repository treemap as ANSI-aware text.
 *
 * @param {RepoTreemapReport} report
 * @param {{ ctx: BijouContext, width: number, height: number }} options
 * @returns {string}
 */
export function renderRepoTreemap(report, options) {
  const width = Math.max(24, options.width);
  const height = Math.max(10, options.height);
  const summaryLines = renderOverview(report, width);
  const legendLines = renderLegendLines(options.ctx, width);
  const detailRows = Math.min(4, Math.max(1, height - 10));
  const noteLines = renderNotes(report, width, Math.max(1, height - summaryLines.length - legendLines.length - detailRows - 3));
  const gridHeight = Math.max(4, height - summaryLines.length - legendLines.length - detailRows - noteLines.length - 3);
  return [
    ...summaryLines,
    ...renderRepoTreemapMap(report, { ...options, width, height: gridHeight }).split('\n'),
    ...legendLines,
    ...renderDetails(report.tiles, { totalValue: report.totalValue, width, lines: detailRows }),
    ...noteLines,
  ].slice(0, height).join('\n');
}
