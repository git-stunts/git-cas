/**
 * Pure render functions for the vault dashboard.
 */

import { badge, boxV3, createSurface, parseAnsiToSurface, kbd } from '@flyingrobots/bijou';
import { commandPalette, navigableTable, splitPaneLayout } from '@flyingrobots/bijou-tui';
import { renderDoctorReport, renderVaultStats } from './vault-report.js';
import { renderManifestView } from './manifest-view.js';

/**
 * @typedef {import('./dashboard.js').DashModel} DashModel
 * @typedef {import('./dashboard.js').DashDeps} DashDeps
 * @typedef {import('./dashboard.js').DashSource} DashSource
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou').Surface} Surface
 */

const SPLIT_MIN_LIST_WIDTH = 28;
const SPLIT_MIN_DETAIL_WIDTH = 32;
const SPLIT_DIVIDER_SIZE = 1;

/**
 * Safely clip text to a pane width.
 *
 * @returns {string}
 */
function clip(text, width) {
  return width > 0 ? text.slice(0, width) : '';
}

/**
 * Clip long paths from the left so the most specific suffix stays visible.
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
 * Compute visible window for cursor scrolling.
 *
 * @param {number} cursor
 * @param {number} total
 * @param {number} height
 * @returns {{ start: number, end: number }}
 */
function textSurface(text, width, height) {
  return parseAnsiToSurface(text, Math.max(1, width), Math.max(1, height));
}

/**
 * Write inline items on a single row.
 *
 * @param {Surface} target
 * @param {{ x: number, y: number, parts: (Surface | string)[], maxWidth: number }} options
 */
function blitInline(target, options) {
  let cursor = options.x;
  for (const part of options.parts) {
    const surface = typeof part === 'string'
      ? textSurface(
        clip(part, Math.max(1, options.maxWidth - (cursor - options.x))),
        Math.max(1, Math.min(part.length, options.maxWidth - (cursor - options.x))),
        1,
      )
      : part;
    if (cursor >= options.x + options.maxWidth) {
      break;
    }
    target.blit(surface, cursor, options.y);
    cursor += surface.width + 1;
  }
}

/**
 * Build header badges that summarize current explorer state.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {(Surface | string)[]}
 */
function headerParts(model, ctx) {
  const parts = [
    badge(`${model.filtered.length}/${model.entries.length || model.filtered.length} visible`, { variant: 'info', ctx }),
  ];
  if (model.metadata?.encryption) {
    parts.push(badge('encrypted', { variant: 'warning', ctx }));
  }
  if (model.filtering || model.filterText) {
    parts.push(badge(model.filtering ? 'filtering' : `filter ${model.filterText}`, { variant: 'accent', ctx }));
  }
  parts.push(badge(`pane ${model.splitPane.focused === 'a' ? 'entries' : 'inspector'}`, { variant: 'primary', ctx }));
  appendSelectionBadges(parts, model, ctx);
  return parts;
}

/**
 * Append badges related to selection and overlays.
 *
 * @param {(Surface | string)[]} parts
 * @param {DashModel} model
 * @param {BijouContext} ctx
 */
function appendSelectionBadges(parts, model, ctx) {
  const selected = model.filtered[model.table.focusRow];
  if (selected) {
    parts.push(badge(`selected ${selected.slug}`, { variant: 'accent', ctx }));
  }
  if (model.activeDrawer) {
    parts.push(badge(`${model.activeDrawer} drawer`, { variant: 'info', ctx }));
  }
  if (model.palette) {
    parts.push(badge('palette', { variant: 'warning', ctx }));
  }
}

/**
 * Human-readable label for the active dashboard source.
 *
 * @param {DashSource} source
 * @returns {string}
 */
function sourceLabel(source) {
  if (source.type === 'vault') {
    return 'source vault refs/cas/vault';
  }
  if (source.type === 'ref') {
    return `source ref ${source.ref}`;
  }
  return `source oid ${source.treeOid}`;
}

/**
 * Render the header surface.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {Surface}
 */
function renderHeaderSurface(model, deps) {
  const surface = createSurface(Math.max(1, model.columns), 4);
  surface.blit(textSurface('git-cas repository explorer', surface.width, 1), 0, 0);
  surface.blit(textSurface(tailClip(`cwd ${deps.cwdLabel ?? '-'}`, surface.width), surface.width, 1), 0, 1);
  blitInline(surface, {
    x: 0,
    y: 2,
    parts: [sourceLabel(deps.source), ...headerParts(model, deps.ctx)],
    maxWidth: surface.width,
  });
  surface.blit(textSurface('─'.repeat(surface.width), surface.width, 1), 0, 3);
  return surface;
}

/**
 * Render a fixed-width overlay panel surface.
 *
 * @param {{ title: string, body: string, width: number, height: number, ctx: BijouContext }} options
 * @returns {Surface}
 */
function renderOverlayPanel(options) {
  const innerWidth = Math.max(1, options.width - 2);
  const innerHeight = Math.max(1, options.height - 2);
  return boxV3(textSurface(options.body, innerWidth, innerHeight), {
    ctx: options.ctx,
    title: options.title,
    width: options.width,
  });
}

/**
 * Build drawer copy for the stats overlay.
 *
 * @param {DashModel} model
 * @returns {string}
 */
function statsDrawerBody(model) {
  if (model.statsStatus === 'loading') {
    return 'Loading vault stats...';
  }
  if (model.statsStatus === 'error') {
    return `Failed to load stats\n\n${model.statsError ?? 'unknown error'}`;
  }
  return model.statsReport
    ? renderVaultStats(model.statsReport)
    : 'Stats have not been loaded yet.';
}

/**
 * Build drawer copy for the doctor overlay.
 *
 * @param {DashModel} model
 * @returns {string}
 */
function doctorDrawerBody(model) {
  if (model.doctorStatus === 'loading') {
    return 'Loading doctor report...';
  }
  if (model.doctorStatus === 'error') {
    return `Failed to load doctor report\n\n${model.doctorError ?? 'unknown error'}`;
  }
  return typeof model.doctorReport === 'string'
    ? model.doctorReport
    : model.doctorReport
    ? renderDoctorReport(model.doctorReport)
    : 'Doctor report has not been loaded yet.';
}

/**
 * Render the stats drawer.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {Surface}
 */
function renderStatsDrawer(model, opts) {
  return renderOverlayPanel({
    title: 'Source Stats',
    body: statsDrawerBody(model),
    width: Math.max(32, Math.min(56, opts.width - 2)),
    height: Math.max(8, opts.height),
    ctx: opts.ctx,
  });
}

/**
 * Render the doctor drawer.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {Surface}
 */
function renderDoctorDrawer(model, opts) {
  return renderOverlayPanel({
    title: 'Doctor Report',
    body: doctorDrawerBody(model),
    width: Math.max(32, Math.min(56, opts.width - 2)),
    height: Math.max(8, opts.height),
    ctx: opts.ctx,
  });
}

/**
 * Render the operator drawer surface when active.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {Surface | null}
 */
function renderDrawerSurface(model, opts) {
  if (!model.activeDrawer) {
    return null;
  }
  return model.activeDrawer === 'stats'
    ? renderStatsDrawer(model, opts)
    : renderDoctorDrawer(model, opts);
}

/**
 * Render the command palette overlay.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {Surface | null}
 */
function renderPaletteSurface(model, opts) {
  if (!model.palette) {
    return null;
  }
  const width = Math.max(32, Math.min(72, opts.width - 8));
  const body = commandPalette(model.palette, {
    width: Math.max(16, width - 2),
    ctx: opts.ctx,
  });
  return renderOverlayPanel({
    title: 'Command Palette',
    body,
    width,
    height: Math.min(opts.height, model.palette.height + 3),
    ctx: opts.ctx,
  });
}

/**
 * Select the current vault entry from table focus.
 *
 * @param {DashModel} model
 * @returns {{ slug: string, treeOid: string } | undefined}
 */
function selectedEntry(model) {
  return model.filtered[model.table.focusRow];
}

/**
 * Choose a responsive table schema for the explorer pane width.
 *
 * @param {number} width
 * @returns {{ columns: { header: string, width: number, align?: 'left' | 'right' | 'center' }[], indexes: number[] }}
 */
function tableSchema(width) {
  if (width >= 64) {
    return {
      columns: [
        { header: 'Slug', width: Math.max(14, width - 36) },
        { header: 'Size', width: 8, align: 'right' },
        { header: 'Chunks', width: 6, align: 'right' },
        { header: 'Crypto', width: 7 },
        { header: 'Format', width: 9 },
      ],
      indexes: [0, 1, 2, 3, 4],
    };
  }
  if (width >= 48) {
    return {
      columns: [
        { header: 'Slug', width: Math.max(14, width - 23) },
        { header: 'Size', width: 8, align: 'right' },
        { header: 'Profile', width: 11 },
      ],
      indexes: [0, 1, 5],
    };
  }
  return {
    columns: [
      { header: 'Slug', width: Math.max(14, width - 12) },
      { header: 'State', width: 10 },
    ],
    indexes: [0, 5],
  };
}

/**
 * Clamp a table state to the current pane size and responsive schema.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number }} size
 * @returns {import('@flyingrobots/bijou-tui').NavigableTableState}
 */
function tableViewState(model, size) {
  const schema = tableSchema(size.width);
  const rows = model.table.rows.map((row) => schema.indexes.map((index) => row[index] ?? ''));
  const focusRow = Math.max(0, Math.min(model.table.focusRow, rows.length - 1));
  let scrollY = model.table.scrollY;
  if (focusRow < scrollY) {
    scrollY = focusRow;
  } else if (focusRow >= scrollY + size.height) {
    scrollY = focusRow - size.height + 1;
  }
  return {
    ...model.table,
    columns: schema.columns,
    rows,
    height: size.height,
    focusRow,
    scrollY: Math.min(scrollY, Math.max(0, rows.length - size.height)),
  };
}

/**
 * Render the split divider surface.
 *
 * @param {number} height
 * @returns {Surface}
 */
function renderDividerSurface(height) {
  return textSurface(Array.from({ length: Math.max(1, height) }, () => '│').join('\n'), 1, Math.max(1, height));
}

/**
 * Render the explorer list pane.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {Surface}
 */
function renderListPane(model, opts) {
  const innerWidth = Math.max(1, opts.width - 2);
  const innerHeight = Math.max(1, opts.height - 2);
  const metaLines = [
    clip(model.filtering ? `filter /${model.filterText}\u2588` : model.filterText ? `filter ${model.filterText}` : 'filter all', innerWidth),
    clip(`${model.filtered.length} assets  focus row ${model.table.rows.length ? model.table.focusRow + 1 : 0}`, innerWidth),
  ];
  const tableHeight = Math.max(1, innerHeight - metaLines.length);

  if (model.table.rows.length === 0) {
    metaLines.push(model.status === 'loading' ? 'Loading...' : model.error ? `Error: ${model.error}` : 'No entries');
  } else {
    const tableText = navigableTable(tableViewState(model, { width: innerWidth, height: tableHeight }), {
      ctx: opts.ctx,
      focusIndicator: model.splitPane.focused === 'a' ? '▸' : '·',
    });
    metaLines.push(tableText);
  }

  return boxV3(textSurface(metaLines.join('\n'), innerWidth, innerHeight), {
    ctx: opts.ctx,
    title: model.splitPane.focused === 'a' ? 'Entries *' : 'Entries',
    width: opts.width,
  });
}

/**
 * Render the explorer detail pane.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {Surface}
 */
function renderDetailPane(model, opts) {
  const innerWidth = Math.max(1, opts.width - 2);
  const innerHeight = Math.max(1, opts.height - 2);
  const content = createSurface(innerWidth, innerHeight);
  const entry = selectedEntry(model);

  if (!entry) {
    content.blit(textSurface('Select an entry to inspect it.', innerWidth, innerHeight), 0, 0);
    return boxV3(content, {
      ctx: opts.ctx,
      title: model.splitPane.focused === 'b' ? 'Inspector *' : 'Inspector',
      width: opts.width,
    });
  }

  const manifest = model.manifestCache.get(entry.slug);
  const summary = [
    `asset ${entry.slug}`,
    `tree  ${entry.treeOid.slice(0, 12)}...`,
  ];
  content.blit(textSurface(summary.join('\n'), innerWidth, Math.min(2, innerHeight)), 0, 0);

  if (!manifest) {
    const loadingText = entry.slug === model.loadingSlug ? 'Loading manifest...' : 'Manifest not loaded yet.';
    content.blit(textSurface(loadingText, innerWidth, Math.max(1, innerHeight - 3)), 0, 3);
    return boxV3(content, {
      ctx: opts.ctx,
      title: model.splitPane.focused === 'b' ? 'Inspector *' : 'Inspector',
      width: opts.width,
    });
  }

  const manifestBody = renderManifestView({ manifest, ctx: opts.ctx });
  const manifestLines = Math.max(1, manifestBody.split('\n').length);
  const manifestSurface = parseAnsiToSurface(manifestBody, innerWidth, manifestLines);
  const bodyTop = 3;
  const bodyHeight = Math.max(1, innerHeight - bodyTop);
  content.blit(manifestSurface, 0, bodyTop, 0, model.detailScroll, innerWidth, bodyHeight);

  return boxV3(content, {
    ctx: opts.ctx,
    title: model.splitPane.focused === 'b' ? 'Inspector *' : 'Inspector',
    width: opts.width,
  });
}

/**
 * Render the footer help surface.
 *
 * @param {BijouContext} ctx
 * @param {number} width
 * @returns {Surface}
 */
function renderFooterSurface(ctx, width) {
  const lines = [
    '─'.repeat(Math.max(1, width)),
    `${kbd('j/k', { ctx })} rows  ${kbd('d/u', { ctx })} page  ${kbd('J/K', { ctx })} scroll  ${kbd('enter', { ctx })} inspect`,
    `${kbd('tab', { ctx })} pane  ${kbd('H/L', { ctx })} resize  ${kbd('ctrl+p', { ctx })} palette`,
    `${kbd('s', { ctx })} stats  ${kbd('g', { ctx })} doctor  ${kbd('esc', { ctx })} close  ${kbd('q', { ctx })} quit`,
  ];
  return textSurface(lines.join('\n'), width, 4);
}

/**
 * Render the body with a split explorer layout.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderBody(model, deps, options) {
  const layout = splitPaneLayout(model.splitPane, {
    direction: 'row',
    width: model.columns,
    height: options.height,
    minA: SPLIT_MIN_LIST_WIDTH,
    minB: SPLIT_MIN_DETAIL_WIDTH,
    dividerSize: SPLIT_DIVIDER_SIZE,
  });
  const listPane = renderListPane(model, { width: layout.paneA.width, height: layout.paneA.height, ctx: deps.ctx });
  const detailPane = renderDetailPane(model, { width: layout.paneB.width, height: layout.paneB.height, ctx: deps.ctx });
  options.screen.blit(listPane, layout.paneA.col, options.top + layout.paneA.row);
  options.screen.blit(renderDividerSurface(layout.divider.height), layout.divider.col, options.top + layout.divider.row);
  options.screen.blit(detailPane, layout.paneB.col, options.top + layout.paneB.row);
}

/**
 * Render any active operator overlays over the dashboard body.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 * @returns {void}
 */
function renderOverlays(model, deps, options) {
  const drawer = renderDrawerSurface(model, {
    width: options.screen.width,
    height: options.height,
    ctx: deps.ctx,
  });
  if (drawer) {
    options.screen.blit(drawer, Math.max(0, options.screen.width - drawer.width), options.top);
  }

  const palette = renderPaletteSurface(model, {
    width: options.screen.width,
    height: options.height,
    ctx: deps.ctx,
  });
  if (palette) {
    const x = Math.max(0, Math.floor((options.screen.width - palette.width) / 2));
    const y = options.top + Math.max(0, Math.floor((options.height - palette.height) / 3));
    options.screen.blit(palette, x, y);
  }
}

/**
 * Render the full dashboard explorer layout.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {Surface}
 */
export function renderDashboard(model, deps) {
  const width = Math.max(1, model.columns);
  const height = Math.max(1, model.rows);
  const screen = createSurface(width, height);
  const header = renderHeaderSurface(model, deps);
  const footer = renderFooterSurface(deps.ctx, width);
  const bodyTop = header.height;
  const bodyHeight = Math.max(1, height - header.height - footer.height);

  screen.blit(header, 0, 0);
  renderBody(model, deps, { top: bodyTop, height: bodyHeight, screen });
  renderOverlays(model, deps, { top: bodyTop, height: bodyHeight, screen });
  screen.blit(footer, 0, Math.max(0, height - footer.height));

  return screen;
}
