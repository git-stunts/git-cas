/**
 * Render a semantic repository treemap for the dashboard drawer.
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
 * Group tiles into a binary split that approximates a treemap.
 *
 * @param {RepoTreemapTile[]} tiles
 * @returns {[RepoTreemapTile[], RepoTreemapTile[]]}
 */
function splitTiles(tiles) {
  const total = tiles.reduce((sum, tile) => sum + tile.value, 0);
  const target = total / 2;
  const left = [];
  let leftSum = 0;
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index];
    if (index > 0 && leftSum >= target) {
      return [left, tiles.slice(index)];
    }
    left.push(tile);
    leftSum += tile.value;
  }
  return [left, []];
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
 * @returns {Array<Array<{ ch: string, kind: keyof typeof TILE_COLOR | null }>>}
 */
function createGrid(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: ' ', kind: null })));
}

/**
 * Overlay a centered tile label on a painted rectangle.
 *
 * @param {ReturnType<typeof createGrid>} grid
 * @param {{ tile: RepoTreemapTile, x: number, y: number, width: number, height: number }} rect
 */
function paintLabel(grid, rect) {
  if (rect.width < 4 || rect.height < 2) {
    return;
  }
  const label = clip(rect.tile.label, rect.width - 1);
  const labelRow = rect.y + Math.floor((rect.height - 1) / 2);
  const startCol = rect.x + Math.max(0, Math.floor((rect.width - label.length) / 2));
  for (let index = 0; index < label.length; index++) {
    const cell = grid[labelRow]?.[startCol + index];
    if (cell) {
      grid[labelRow][startCol + index] = { ch: label[index], kind: rect.tile.kind };
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
function renderLegend(ctx, width) {
  const parts = [
    ['worktree', 'worktree'],
    ['git', 'git'],
    ['ref', 'refs'],
    ['vault', 'vault'],
    ['cas', 'source'],
  ].map(([kind, label]) => {
    const fill = TILE_FILL[/** @type {keyof typeof TILE_FILL} */ (kind)];
    const color = TILE_COLOR[/** @type {keyof typeof TILE_COLOR} */ (kind)];
    return `${ctx.style.rgb(color[0], color[1], color[2], fill)} ${label}`;
  });
  return clip(`legend ${parts.join('  ')}`, width);
}

/**
 * Render the most important tile details below the treemap.
 *
 * @param {RepoTreemapTile[]} tiles
 * @param {number} width
 * @param {number} lines
 * @returns {string[]}
 */
function renderDetails(tiles, width, lines) {
  return tiles
    .slice(0, Math.max(0, lines))
    .map((tile) => clip(`${tile.label}  ${tile.detail}`, width));
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
  const summaryLines = [
    clip(`scope ${report.scope}  source ${sourceLabel(report.source)}`, width),
    clip(`root ${tailClip(report.cwd, Math.max(1, width - 5))}`, width),
    clip(`total ${formatBytes(report.totalValue)}  worktree ${report.summary.worktreeItems}  refs ${report.summary.refCount}  source ${report.summary.sourceEntries}`, width),
  ];

  const legendLine = renderLegend(options.ctx, width);
  const noteLines = report.notes.map((note) => clip(note, width));
  const detailRows = Math.min(4, Math.max(1, height - 8));
  const gridHeight = Math.max(4, height - summaryLines.length - detailRows - noteLines.length - 2);
  const grid = createGrid(width, gridHeight);
  const layout = layoutTreemap(report.tiles, { x: 0, y: 0, width, height: gridHeight });
  for (const rect of layout) {
    paintRect(grid, rect);
  }

  return [
    ...summaryLines,
    ...renderGrid(grid, options.ctx),
    legendLine,
    ...renderDetails(report.tiles, width, detailRows),
    ...noteLines,
  ].slice(0, height).join('\n');
}
