/**
 * Render a semantic repository treemap for the dashboard.
 */

/**
 * @typedef {import('./dashboard-cmds.js').RepoTreemapReport} RepoTreemapReport
 * @typedef {import('./dashboard-cmds.js').RepoTreemapTile} RepoTreemapTile
 * @typedef {import('./dashboard.js').DashSource} DashSource
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 */

import { GIT_CAS_PALETTE } from './theme.js';

const TILE_COLOR = {
  worktree: GIT_CAS_PALETTE.cyan,
  git: GIT_CAS_PALETTE.orange,
  ref: GIT_CAS_PALETTE.sky,
  vault: GIT_CAS_PALETTE.ghost,
  cas: GIT_CAS_PALETTE.ruby,
  meta: GIT_CAS_PALETTE.slate,
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

function formatBytes(bytes) {
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}K`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)}M`; }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function sourceLabel(source) {
  if (source.type === 'vault') { return 'vault'; }
  if (source.type === 'ref') { return `ref ${source.ref}`; }
  return `oid ${source.treeOid}`;
}

function clip(text, width) {
  if (width <= 0) { return ''; }
  if (text.length <= width) { return text; }
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}

function currentLevelLabel(report) {
  return report.breadcrumb.join(' > ');
}

function tailClip(text, width) {
  if (width <= 0) { return ''; }
  if (text.length <= width) { return text; }
  return width <= 3 ? clip(text, width) : `...${text.slice(text.length - (width - 3))}`;
}

function findWrapIndex(line, width) {
  const splitAt = Math.min(width, line.length);
  const boundaryChar = line[splitAt];
  if (boundaryChar && /\s/u.test(boundaryChar)) { return splitAt; }
  let backtrack = splitAt;
  while (backtrack > 0 && !/\s/u.test(line[backtrack - 1])) { backtrack--; }
  return backtrack > 0 ? backtrack : splitAt;
}

function wrapLine(line, width) {
  if (line.length === 0) { return ['']; }
  const wrapped = [];
  let remaining = line;
  while (remaining.length > width) {
    const splitAt = Math.min(width, remaining.length);
    const wrapIndex = findWrapIndex(remaining, width);
    const chunk = remaining.slice(0, wrapIndex).replace(/\s+$/u, '');
    wrapped.push(chunk || remaining.slice(0, splitAt));
    let nextStart = wrapIndex;
    while (nextStart < remaining.length && /\s/u.test(remaining[nextStart])) { nextStart++; }
    remaining = remaining.slice(nextStart);
  }
  if (remaining.length > 0 || wrapped.length === 0) { wrapped.push(remaining); }
  return wrapped;
}

function wrapText(text, width) {
  if (width <= 0) { return ['']; }
  return text.split('\n').flatMap((line) => wrapLine(line, width));
}

function limitLines(lines, width, maxLines) {
  if (lines.length <= maxLines) { return lines; }
  const capped = lines.slice(0, maxLines);
  capped[maxLines - 1] = `${clip(capped[maxLines - 1], Math.max(1, width - 1))}…`;
  return capped;
}

function formatPercent(value, total) {
  return total <= 0 ? '0.0%' : `${((value / total) * 100).toFixed(1)}%`;
}

function sortTilesByValue(tiles) {
  return [...tiles].sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function splitTiles(tiles) {
  if (tiles.length <= 1) { return [tiles, []]; }
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

function layoutTreemap(tiles, rect, vertical = rect.width >= rect.height) {
  if (tiles.length === 0 || rect.width <= 0 || rect.height <= 0) { return []; }
  if (tiles.length === 1) { return [{ tile: tiles[0], ...rect }]; }
  const [groupA, groupB] = splitTiles(tiles);
  if (groupB.length === 0) { return [{ tile: groupA[0], ...rect }]; }
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

function createGrid(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: ' ', kind: null })));
}

function putCell(grid, cell) {
  if (grid[cell.row]?.[cell.col]) {
    grid[cell.row][cell.col] = { ch: cell.ch, kind: cell.kind, label: cell.label ?? false, focused: cell.focused ?? false };
  }
}

const LABEL_FOREGROUND = GIT_CAS_PALETTE.ghost;
const FOCUS_BORDER_COLOR = GIT_CAS_PALETTE.orange;

function outlineGlyphs(focused) {
  return focused ? { h: '═', v: '║', tl: '╔', tr: '╗', bl: '╚', br: '╝' } : { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘' };
}

function outlineRect(grid, rect, focused = false) {
  if (rect.width < 2 || rect.height < 2) { return; }
  const { h, v, tl, tr, bl, br } = outlineGlyphs(focused);
  const top = rect.y; const bottom = rect.y + rect.height - 1; const left = rect.x; const right = rect.x + rect.width - 1;
  for (let col = left + 1; col < right; col++) {
    putCell(grid, { row: top, col, ch: h, kind: rect.tile.kind, focused });
    putCell(grid, { row: bottom, col, ch: h, kind: rect.tile.kind, focused });
  }
  for (let row = top + 1; row < bottom; row++) {
    putCell(grid, { row, col: left, ch: v, kind: rect.tile.kind, focused });
    putCell(grid, { row, col: right, ch: v, kind: rect.tile.kind, focused });
  }
  putCell(grid, { row: top, col: left, ch: tl, kind: rect.tile.kind, focused });
  putCell(grid, { row: top, col: right, ch: tr, kind: rect.tile.kind, focused });
  putCell(grid, { row: bottom, col: left, ch: bl, kind: rect.tile.kind, focused });
  putCell(grid, { row: bottom, col: right, ch: br, kind: rect.tile.kind, focused });
}

function paintLabel(grid, rect) {
  if (rect.width < 6 || rect.height < 2) { return; }
  const label = clip(rect.tile.label, rect.width - 2);
  const labelRow = rect.y + Math.floor((rect.height - 1) / 2);
  const startCol = rect.x + Math.max(0, Math.floor((rect.width - label.length) / 2));
  for (let index = 0; index < label.length; index++) {
    const cell = grid[labelRow]?.[startCol + index];
    if (cell) { grid[labelRow][startCol + index] = { ch: label[index], kind: rect.tile.kind, label: true }; }
  }
}

function paintRect(grid, rect, selectedTileId) {
  const fill = TILE_FILL[rect.tile.kind] ?? TILE_FILL.meta;
  for (let row = rect.y; row < rect.y + rect.height; row++) {
    for (let col = rect.x; col < rect.x + rect.width; col++) {
      if (grid[row]?.[col]) { grid[row][col] = { ch: fill, kind: rect.tile.kind }; }
    }
  }
  outlineRect(grid, rect, rect.tile.id === selectedTileId);
  paintLabel(grid, rect);
}

function renderGrid(grid, ctx) {
  return grid.map((row) => row.map((cell) => {
    if (!cell.kind) { return cell.ch; }
    const color = TILE_COLOR[cell.kind] ?? TILE_COLOR.meta;
    if (cell.focused) {
      const focusText = ctx.style.rgb(FOCUS_BORDER_COLOR[0], FOCUS_BORDER_COLOR[1], FOCUS_BORDER_COLOR[2], cell.ch);
      return ctx.style.inverse ? ctx.style.bold(ctx.style.inverse(focusText)) : ctx.style.bold(focusText);
    }
    if (cell.label) { return ctx.style.bold(ctx.style.rgb(LABEL_FOREGROUND[0], LABEL_FOREGROUND[1], LABEL_FOREGROUND[2], cell.ch)); }
    return ctx.style.rgb(color[0], color[1], color[2], cell.ch);
  }).join(''));
}

function renderLegendLines(ctx, width) {
  return /** @type {Array<keyof typeof TILE_FILL>} */ (['worktree', 'git', 'ref', 'vault', 'cas', 'meta'])
    .map((kind) => {
      const fill = TILE_FILL[kind];
      const color = TILE_COLOR[kind];
      return clip(ctx.style.rgb(color[0], color[1], color[2], `${fill} ${TILE_LABEL[kind]}`), width);
    });
}

function renderDetails(tiles, options) {
  return sortTilesByValue(tiles)
    .slice(0, Math.max(0, options.lines))
    .map((tile, index) => clip(
      `${index + 1}. ${tile.label} [${TILE_LABEL[tile.kind]}] ${formatPercent(tile.value, options.totalValue)} · ${tile.detail}`,
      options.width,
    ));
}

function renderOverview(report, width) {
  const common = [
    clip(`scope ${report.scope}`, width),
    clip(`source ${sourceLabel(report.source)}`, width),
    clip(`level ${currentLevelLabel(report)}`, width),
    clip(`root ${tailClip(report.cwd, Math.max(1, width - 5))}`, width),
    clip(`total ${formatBytes(report.totalValue)}`, width),
  ];
  if (report.scope === 'source') {
    return [
      ...common,
      clip('logical source weighting', width),
      clip(`current regions ${report.tiles.length}`, width),
      clip(`source entries ${report.summary.sourceEntries}`, width),
      clip(`vault entries ${report.summary.vaultEntries}`, width),
    ];
  }
  return [
    ...common,
    clip(`${report.worktreeMode} paths ${report.summary.worktreePaths}`, width),
    clip(`current regions ${report.tiles.length}`, width),
    clip(`worktree regions ${report.summary.worktreeItems}`, width),
    clip(`refs ${report.summary.refCount} in ${report.summary.refNamespaces} namespaces`, width),
    clip(`vault ${report.summary.vaultEntries}  source ${report.summary.sourceEntries}`, width),
  ];
}

function selectedTile(report, selectedTileId) {
  if (!selectedTileId) { return report.tiles[0] ?? null; }
  return report.tiles.find((tile) => tile.id === selectedTileId) ?? report.tiles[0] ?? null;
}

function renderFocusedTile(report, selectedTileId, width) {
  const tile = selectedTile(report, selectedTileId);
  if (!tile) { return ['No region selected.']; }
  return [
    clip(tile.label, width),
    clip(`${TILE_LABEL[tile.kind]} · ${formatPercent(tile.value, report.totalValue)}`, width),
    clip(tile.detail, width),
    clip(tile.drillable ? 'Press + to descend.' : 'Leaf tile.', width),
  ];
}

function renderNotes(report, width, lines) {
  return limitLines(report.notes.flatMap((note) => wrapText(note, width)), width, lines);
}

export function renderRepoTreemapMap(report, options) {
  const width = Math.max(12, options.width);
  const height = Math.max(4, options.height);
  const grid = createGrid(width, height);
  const layout = layoutTreemap(sortTilesByValue(report.tiles), { x: 0, y: 0, width, height });
  for (const rect of layout) { paintRect(grid, rect, options.selectedTileId ?? null); }
  return renderGrid(grid, options.ctx).join('\n');
}

export function renderRepoTreemapSidebar(report, options) {
  const width = Math.max(16, options.width);
  return {
    overview: renderOverview(report, width).join('\n'),
    legend: renderLegendLines(options.ctx, width).join('\n'),
    focused: renderFocusedTile(report, options.selectedTileId, width).join('\n'),
    regions: renderDetails(report.tiles, {
      totalValue: report.totalValue,
      width,
      lines: Math.max(3, Math.min(10, options.height - 20)),
    }).join('\n'),
    notes: renderNotes(report, width, Math.max(2, Math.min(8, options.height - 24))).join('\n'),
  };
}

export function renderRepoTreemap(report, options) {
  const width = Math.max(24, options.width); const height = Math.max(10, options.height);
  const summaryLines = renderOverview(report, width); const legendLines = renderLegendLines(options.ctx, width);
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
