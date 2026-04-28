/**
 * Pure render functions for the vault dashboard.
 */

import { badge, boxSurface, createSurface, parseAnsiToSurface, kbd } from '@flyingrobots/bijou';
import { canvas, clipToWidth, commandPalette, dagPane, hasNotifications, helpView, hstackSurface, interactiveAccordion, navigableTable, pagerSurface, renderNotificationStack, statusBarSurface, vstackSurface } from '@flyingrobots/bijou-tui';
import { renderRepoTreemapMap, renderRepoTreemapSidebar } from './repo-treemap.js';
import { inlineSurface, sectionHeading, shellRule, themeText } from './theme.js';
import { renderVaultStats } from './vault-report.js';
import { renderBadgeRow } from './blocks/asset-card.js';
import { renderHealthDashboard } from './blocks/health-dashboard.js';
import { renderManifestView } from './manifest-view.js';
import { renderWizardSurface } from './store-wizard.js';
import { bakSneppenShader } from './shaders/bak-sneppen.js';

/**
 * @typedef {import('./dashboard.js').DashModel} DashModel
 * @typedef {import('./dashboard.js').DashDeps} DashDeps
 * @typedef {import('./dashboard.js').DashSource} DashSource
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou').Surface} Surface
 */

// ── Layout Constants ─────────────────────────────────────────────────
const DRAWER_MIN_WIDTH = 32;
const DRAWER_MAX_WIDTH = 56;
const DRAWER_MARGIN = 2;
const PALETTE_MIN_WIDTH = 32;
const PALETTE_MAX_WIDTH = 72;
const PALETTE_MARGIN = 8;
const HELP_MIN_WIDTH = 36;
const HELP_MAX_WIDTH = 60;
const HELP_MARGIN = 4;
const REFS_SIDEBAR_RATIO = 0.35;
const TREEMAP_SIDEBAR_RATIO = 0.32;
const OVERLAY_V_OFFSET = 3; // Overlay positioned at 1/3 from top

/**
 * Center an overlay horizontally within a container.
 *
 * @param {number} containerWidth
 * @param {number} overlayWidth
 * @returns {number}
 */
function centerX(containerWidth, overlayWidth) {
  return Math.max(0, Math.floor((containerWidth - overlayWidth) / 2));
}

/**
 * Position an overlay vertically at 1/3 from the top.
 *
 * @param {number} top
 * @param {number} containerHeight
 * @param {number} overlayHeight
 * @returns {number}
 */
function topThirdY(top, containerHeight, overlayHeight) {
  return top + Math.max(0, Math.floor((containerHeight - overlayHeight) / OVERLAY_V_OFFSET));
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
    return clipToWidth(text, width);
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
  if (model.activeDrawer === 'treemap') {
    parts.push(badge('atlas view', { variant: 'brand', ctx }));
  } else if (model.activeDrawer === 'refs') {
    parts.push(badge('ref index', { variant: 'brand', ctx }));
  } else {
    parts.push(badge(model.viewMode === 'list' ? 'entries ledger' : 'manifest inspector', { variant: 'brand', ctx }));
  }
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
  if (selected && model.activeDrawer !== 'treemap') {
    parts.push(badge(`selected ${selected.slug}`, { variant: 'accent', ctx }));
  }
  if (hasNotifications(model.notifications)) {
    parts.push(badge(`alerts ${model.notifications.items.length}`, { variant: 'warning', ctx }));
  }
  if (model.activeDrawer === 'treemap') {
    parts.push(badge(`scope ${model.treemapScope}`, { variant: 'brand', ctx }));
    if (model.treemapScope === 'repository') {
      parts.push(badge(`files ${model.treemapWorktreeMode}`, { variant: 'accent', ctx }));
    }
    parts.push(badge(`level ${treemapLevelLabel(model)}`, { variant: 'info', ctx }));
    const tile = selectedTreemapTile(model);
    if (tile) {
      parts.push(badge(`focus ${tile.label}`, { variant: 'warning', ctx }));
    }
  }
  if (model.activeDrawer && model.activeDrawer !== 'treemap') {
    parts.push(badge(`${model.activeDrawer} drawer`, { variant: 'info', ctx }));
  }
  if (model.palette) {
    parts.push(badge('command deck', { variant: 'warning', ctx }));
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
 * Current breadcrumb label for the treemap level.
 *
 * @param {DashModel} model
 * @returns {string}
 */
function treemapLevelLabel(model) {
  return model.treemapReport?.breadcrumb?.join(' > ') ?? (model.treemapScope === 'repository' ? 'repository' : 'source');
}

/**
 * Selected tile in the current treemap report.
 *
 * @param {DashModel} model
 * @returns {import('./dashboard-cmds.js').RepoTreemapTile | null}
 */
function selectedTreemapTile(model) {
  if (!model.treemapReport || model.treemapReport.tiles.length === 0) {
    return null;
  }
  return model.treemapReport.tiles[Math.max(0, Math.min(model.treemapFocus, model.treemapReport.tiles.length - 1))] ?? null;
}

/**
 * Render the header surface.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {Surface}
 */
function renderHeaderSurface(model, deps, width) {
  const w = Math.max(1, width);
  const titleRow = hstackSurface(1,
    inlineSurface(deps.ctx, 'git-cas', { tone: 'brand' }),
    inlineSurface(deps.ctx, 'repository explorer', { tone: 'secondary' }),
  );
  const cwdRow = hstackSurface(1,
    inlineSurface(deps.ctx, 'cwd', { tone: 'accent' }),
    inlineSurface(deps.ctx, tailClip(deps.cwdLabel ?? '-', Math.max(1, w - 5)), { tone: 'subdued' }),
  );
  const sourceRow = hstackSurface(1,
    inlineSurface(deps.ctx, sourceLabel(model.source), { tone: 'primary' }),
    ...headerParts(model, deps.ctx),
  );
  const ruleRow = textSurface(shellRule(deps.ctx, w), w, 1);
  return vstackSurface(titleRow, cwdRow, sourceRow, ruleRow);
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
  return boxSurface(textSurface(options.body, innerWidth, innerHeight), {
    ctx: options.ctx,
    title: options.title,
    width: options.width,
  });
}

/**
 * Wrap text to the requested width and line budget.
 *
 * @param {string[]} lines
 * @param {number} width
 * @param {number} maxLines
 * @returns {string[]}
 */
function limitWrappedLines(lines, width, maxLines) {
  if (maxLines <= 0) {
    return [];
  }
  if (lines.length <= maxLines) {
    return lines;
  }
  const capped = lines.slice(0, maxLines);
  capped[maxLines - 1] = `${clipToWidth(capped[maxLines - 1], Math.max(1, width - 1))}…`;
  return capped;
}

/**
 * Build one titled sidebar section within a line budget.
 *
 * @param {{ title: string, body: string, width: number, bodyLines: number, ctx: BijouContext, tone?: 'brand' | 'accent' | 'info' | 'warning' | 'subdued' }} options
 * @returns {string[]}
 */
function sidebarSection(options) {
  const lines = options.body.length === 0 ? [''] : options.body.split('\n');
  return [
    sectionHeading(options.ctx, options.title, options.tone ?? 'brand'),
    ...limitWrappedLines(lines, options.width, Math.max(1, options.bodyLines)),
  ];
}

/**
 * Treemap sidebar text for loading/error/empty report states.
 *
 * @param {DashModel} model
 * @returns {string | null}
 */
function treemapSidebarStateText(model) {
  if (model.treemapStatus === 'loading') {
    return `Overview\nLoading ${model.treemapScope} treemap...`;
  }
  if (model.treemapStatus === 'error') {
    return `Overview\nFailed to load treemap\n\n${model.treemapError ?? 'unknown error'}`;
  }
  if (!model.treemapReport) {
    return 'Overview\nTreemap has not been loaded yet.';
  }
  return null;
}

/**
 * Compose the full set of sidebar sections for the treemap view.
 *
 * @param {{ sections: ReturnType<typeof renderRepoTreemapSidebar>, width: number, height: number, ctx: BijouContext }} options
 * @returns {string}
 */
function composeTreemapSidebarText(options) {
  const sectionBlocks = [
    sidebarSection({
      title: 'Overview',
      body: options.sections.overview,
      ctx: options.ctx,
      tone: 'brand',
      width: options.width,
      bodyLines: 4,
    }),
    sidebarSection({
      title: 'Focused Region',
      body: options.sections.focused,
      ctx: options.ctx,
      tone: 'accent',
      width: options.width,
      bodyLines: 3,
    }),
    sidebarSection({
      title: 'Legend',
      body: options.sections.legend,
      ctx: options.ctx,
      tone: 'info',
      width: options.width,
      bodyLines: 6,
    }),
    sidebarSection({
      title: 'Largest Regions',
      body: options.sections.regions || 'No regions to display.',
      ctx: options.ctx,
      tone: 'warning',
      width: options.width,
      bodyLines: 4,
    }),
    sidebarSection({
      title: 'Notes',
      body: options.sections.notes || 'No notes.',
      ctx: options.ctx,
      tone: 'subdued',
      width: options.width,
      bodyLines: Math.max(2, options.height - 23),
    }),
  ];
  return sectionBlocks.flat().join('\n');
}

/**
 * Find the last whitespace boundary at or before an index.
 *
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function lastWhitespaceBoundary(text, index) {
  for (let cursor = Math.min(index, text.length - 1); cursor >= 0; cursor -= 1) {
    if (/\s/.test(text[cursor])) {
      return cursor;
    }
  }
  return -1;
}

/**
 * Wrap one paragraph to a width using whitespace boundaries when available.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wrapWhitespaceParagraph(text, width) {
  const lines = [];
  let remaining = text.trimEnd();
  if (remaining.length === 0) {
    return [''];
  }
  while (remaining.length > width) {
    let wrapIndex = Math.min(width, remaining.length);
    if (wrapIndex < remaining.length && !/\s/.test(remaining[wrapIndex])) {
      const boundary = lastWhitespaceBoundary(remaining, wrapIndex);
      if (boundary > 0) {
        wrapIndex = boundary;
      }
    }
    if (wrapIndex <= 0) {
      wrapIndex = width;
    }
    const line = remaining.slice(0, wrapIndex).trimEnd();
    lines.push(line.length > 0 ? line : remaining.slice(0, width));
    remaining = remaining.slice(wrapIndex).trimStart();
  }
  if (remaining.length > 0) {
    lines.push(remaining);
  }
  return lines;
}

/**
 * Wrap plain text on whitespace with hard-break fallback.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wrapWhitespaceText(text, width) {
  if (width <= 0) {
    return [''];
  }
  return text
    .split('\n')
    .flatMap((part) => wrapWhitespaceParagraph(part, Math.max(1, width)));
}



/**
 * Width of the toast for the current motion phase.
 *
 * @param {{ phase?: 'entering' | 'steady' | 'exiting', progress?: number }} toast
 * @param {number} baseWidth
 * @returns {number}
 */

/**
 * Render one toast box surface.
 *
 * @param {{ id: number, level: 'error' | 'warning' | 'info' | 'success', title: string, message: string, phase?: 'entering' | 'steady' | 'exiting', progress?: number }} toast
 * @param {{ width: number, ctx: BijouContext }} opts
 * @returns {Surface}
 */

/**
 * Render a soft drop shadow behind a toast.
 *
 * @param {number} width
 * @param {number} height
 * @param {BijouContext} ctx
 * @returns {Surface}
 */

/**
 * Compute horizontal slide for toast motion.
 *
 * @param {{ progress?: number }} toast
 * @returns {number}
 */

/**
 * Build drawer copy for the stats overlay.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {string}
 */
function statsDrawerBody(model, ctx) {
  if (model.statsStatus === 'loading') {
    return 'Loading source stats...';
  }
  if (model.statsStatus === 'error') {
    return `Failed to load stats\n\n${model.statsError ?? 'unknown error'}`;
  }
  return model.statsReport
    ? `${sectionHeading(ctx, 'Repository Economics', 'brand')}\n${themeText(ctx, 'Logical size, dedupe, encryption, and chunk shape at a glance.', { tone: 'subdued' })}\n\n${renderVaultStats(model.statsReport)}`
    : 'Stats have not been loaded yet.';
}

/**
 * Build drawer copy for the doctor overlay.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {string}
 */
function doctorDrawerBody(model, ctx) {
  if (model.doctorStatus === 'loading') {
    return 'Loading doctor report...';
  }
  if (model.doctorStatus === 'error') {
    return `Failed to load doctor report\n\n${model.doctorError ?? 'unknown error'}`;
  }
  if (!model.doctorReport || typeof model.doctorReport === 'string') {
    return model.doctorReport ?? 'Doctor report has not been loaded yet.';
  }
  return `${sectionHeading(ctx, 'Integrity Sweep', 'brand')}\n${themeText(ctx, 'Vault reachability, manifest health, and issue inventory.', { tone: 'subdued' })}\n\n${renderHealthDashboard(model.doctorReport, ctx)}`;
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
    title: 'Vault Metrics',
    body: statsDrawerBody(model, opts.ctx),
    width: Math.max(DRAWER_MIN_WIDTH, Math.min(DRAWER_MAX_WIDTH, opts.width - DRAWER_MARGIN)),
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
    title: 'Vault Doctor',
    body: doctorDrawerBody(model, opts.ctx),
    width: Math.max(DRAWER_MIN_WIDTH, Math.min(DRAWER_MAX_WIDTH, opts.width - DRAWER_MARGIN)),
    height: Math.max(8, opts.height),
    ctx: opts.ctx,
  });
}

/**
 * Render a boxed panel surface.
 *
 * @param {{ title: string, body: string, width: number, height: number, ctx: BijouContext }} options
 * @returns {Surface}
 */
function renderPanel(options) {
  return boxSurface(textSurface(options.body, Math.max(1, options.width - 2), Math.max(1, options.height - 2)), {
    ctx: options.ctx,
    title: options.title,
    width: options.width,
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
  if (!model.activeDrawer || model.activeDrawer === 'treemap' || model.activeDrawer === 'refs') {
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
  const width = Math.max(PALETTE_MIN_WIDTH, Math.min(PALETTE_MAX_WIDTH, opts.width - PALETTE_MARGIN));
  const body = commandPalette(model.palette, {
    width: Math.max(16, width - 2),
    ctx: opts.ctx,
  });
  return renderOverlayPanel({
    title: 'Command Deck',
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
  if (width >= 100) {
    const oidWidth = 40;
    const fixedCols = oidWidth + 10 + 7 + 10 + 9; // OID + Size + Chunks + Crypto + Format
    const slugWidth = Math.max(16, Math.min(32, width - fixedCols - 6));
    return {
      columns: [
        { header: 'Slug', width: slugWidth },
        { header: 'Tree OID', width: oidWidth },
        { header: 'Size', width: 10, align: 'right' },
        { header: 'Chunks', width: 7, align: 'right' },
        { header: 'Crypto', width: 10 },
        { header: 'Format', width: 9 },
      ],
      indexes: [0, 1, 2, 3, 4, 5],
    };
  }
  if (width >= 64) {
    const fixedCols = 10 + 7 + 10 + 9; // Size + Chunks + Crypto + Format
    const slugWidth = Math.max(20, Math.min(40, width - fixedCols - 4));
    return {
      columns: [
        { header: 'Slug', width: slugWidth },
        { header: 'Size', width: 10, align: 'right' },
        { header: 'Chunks', width: 7, align: 'right' },
        { header: 'Crypto', width: 10 },
        { header: 'Format', width: 9 },
      ],
      indexes: [0, 2, 3, 4, 5],
    };
  }
  if (width >= 48) {
    return {
      columns: [
        { header: 'Slug', width: Math.max(14, width - 23) },
        { header: 'Size', width: 8, align: 'right' },
        { header: 'Profile', width: 11 },
      ],
      indexes: [0, 2, 6],
    };
  }
  return {
    columns: [
      { header: 'Slug', width: Math.max(14, width - 12) },
      { header: 'State', width: 10 },
    ],
    indexes: [0, 6],
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
 * Render a navigable table with the focused row highlighted via inverse styling.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {string}
 */
function renderHighlightedTable(model, opts) {
  const state = tableViewState(model, { width: opts.width, height: opts.height });
  const ctx = opts.ctx;
  const tableText = navigableTable(state, { ctx, focusIndicator: '\u25b8' });
  const lines = tableText.split('\n');
  const focusLine = state.focusRow - state.scrollY + 1;
  if (focusLine >= 0 && focusLine < lines.length && ctx.style?.inverse) {
    lines[focusLine] = ctx.style.inverse(lines[focusLine]);
  }
  return lines.join('\n');
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
    themeText(opts.ctx, clipToWidth(model.filtering ? `filter /${model.filterText}\u2588` : model.filterText ? `filter ${model.filterText}` : 'filter all', innerWidth), { tone: 'accent' }),
    themeText(opts.ctx, clipToWidth(`${model.filtered.length} assets  focus row ${model.table.rows.length ? model.table.focusRow + 1 : 0}`, innerWidth), { tone: 'subdued' }),
  ];
  const tableHeight = Math.max(1, innerHeight - metaLines.length);

  if (model.table.rows.length === 0) {
    metaLines.push(model.status === 'loading'
      ? themeText(opts.ctx, 'Loading...', { tone: 'info' })
      : model.error
      ? themeText(opts.ctx, `Error: ${model.error}`, { tone: 'danger' })
      : themeText(opts.ctx, 'No entries', { tone: 'subdued' }));
  } else {
    metaLines.push(renderHighlightedTable(model, { width: innerWidth, height: tableHeight, ctx: opts.ctx }));
  }

  const content = metaLines.join('\n');
  return boxSurface(textSurface(content, innerWidth, innerHeight), {
    ctx: opts.ctx,
    title: 'Entries Ledger',
    width: opts.width,
    height: opts.height,
  });
}

/**
 * Inspector pane title with focus indicator.
 *
 * @param {DashModel} model
 * @returns {string}
 */
function inspectorTitle() {
  return 'Manifest Inspector';
}

/**
 * Render the detail pane entry summary header (slug, tree oid, badges).
 *
 * @param {{ slug: string, treeOid: string }} entry
 * @param {import('../../src/domain/value-objects/Manifest.js').ManifestData | null} manifestData
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderEntrySummary(entry, manifestData, ctx) {
  const parts = [
    `${themeText(ctx, 'asset', { tone: 'accent' })} ${themeText(ctx, entry.slug, { tone: 'primary', bold: true })}`,
    `${themeText(ctx, 'tree', { tone: 'subdued' })}  ${themeText(ctx, `${entry.treeOid.slice(0, 12)}...`, { tone: 'secondary' })}`,
  ];
  if (manifestData) {
    const badges = renderBadgeRow(manifestData, ctx);
    if (badges) { parts.push(badges); }
  }
  return parts.join('\n');
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
    return boxSurface(content, { ctx: opts.ctx, title: inspectorTitle(), width: opts.width });
  }

  const manifest = model.manifestCache.get(entry.slug);
  const m = manifest ? (manifest.toJSON ? manifest.toJSON() : manifest) : null;
  const summary = renderEntrySummary(entry, m, opts.ctx);
  const summaryLines = summary.split('\n').length;
  content.blit(textSurface(summary, innerWidth, Math.min(summaryLines, innerHeight)), 0, 0);

  if (!manifest) {
    const loadingText = entry.slug === model.loadingSlug
      ? themeText(opts.ctx, 'Loading manifest...', { tone: 'info' })
      : themeText(opts.ctx, 'Manifest not loaded yet.', { tone: 'subdued' });
    content.blit(textSurface(loadingText, innerWidth, Math.max(1, innerHeight - 3)), 0, 3);
    return boxSurface(content, { ctx: opts.ctx, title: inspectorTitle(), width: opts.width });
  }

  const manifestBody = model.detailAccordion
    ? interactiveAccordion(model.detailAccordion, { ctx: opts.ctx })
    : renderManifestView({ manifest: manifest.toJSON ? manifest.toJSON() : manifest, ctx: opts.ctx });
  const manifestLines = Math.max(1, manifestBody.split('\n').length);
  const manifestSurface = parseAnsiToSurface(manifestBody, innerWidth, manifestLines);
  const bodyTop = summaryLines + 1;
  const bodyHeight = Math.max(1, innerHeight - bodyTop);

  if (model.detailPager && manifestLines > bodyHeight) {
    const pagerState = { ...model.detailPager, width: innerWidth, height: bodyHeight };
    const paged = pagerSurface(manifestSurface, pagerState, { showScrollbar: true, scrollbarMode: 'overlay', showStatus: true });
    content.blit(paged, 0, bodyTop);
  } else {
    content.blit(manifestSurface, 0, bodyTop, 0, 0, innerWidth, bodyHeight);
  }

  return boxSurface(content, { ctx: opts.ctx, title: inspectorTitle(), width: opts.width });
}

/**
 * Return the selected ref item from the refs browser.
 *
 * @param {DashModel} model
 * @returns {import('./dashboard-cmds.js').RefInventoryItem | undefined}
 */
function selectedRef(model) {
  return model.refsItems[model.refsTable.focusRow];
}

/**
 * Build human-readable metadata for a ref row.
 *
 * @param {import('./dashboard-cmds.js').RefInventoryItem} item
 * @returns {string}
 */
function refMetaText(item) {
  return `${item.namespace}  ${item.resolution}  ${item.entryCount} entries  ${item.oid.slice(0, 12)}`;
}

/**
 * Wrap and prefix a line collection.
 *
 * @param {string[]} lines
 * @param {string} text
 * @param {{ width: number, prefix?: string }} options
 */
function pushWrappedText(lines, text, options) {
  const prefix = options.prefix ?? '';
  const width = options.width;
  const wrapped = wrapWhitespaceText(text, Math.max(1, width - prefix.length));
  for (const line of wrapped) {
    lines.push(`${prefix}${line}`);
  }
}

/**
 * Render the visible lines for one ref row.
 *
 * @param {import('./dashboard-cmds.js').RefInventoryItem} item
 * @param {boolean} focused
 * @param {number} width
 * @returns {string[]}
 */
function renderRefRowLines(item, focused, width) {
  const lines = [];
  pushWrappedText(lines, item.ref, { width, prefix: focused ? '▸ ' : '  ' });
  pushWrappedText(lines, refMetaText(item), { width, prefix: '  ' });
  return lines;
}

/**
 * Render refs-browser status text.
 *
 * @param {DashModel} model
 * @param {number} width
 * @returns {string}
 */
function renderRefsListStatusBody(model, width) {
  if (model.refsStatus === 'loading') {
    return wrapWhitespaceText('Loading refs...', width).join('\n');
  }
  if (model.refsStatus === 'error') {
    return wrapWhitespaceText(`Failed to load refs\n\n${model.refsError ?? 'unknown error'}`, width).join('\n');
  }
  return wrapWhitespaceText('No refs found.', width).join('\n');
}

/**
 * Build a visible refs-list viewport.
 *
 * @param {{ items: import('./dashboard-cmds.js').RefInventoryItem[], focusRow: number, startIndex: number, width: number, height: number, ctx: BijouContext }} options
 * @returns {{ lines: string[], visibleFocus: boolean }}
 */
function buildRefsViewport(options) {
  const lines = [themeText(options.ctx, `${options.items.length} refs  focus row ${options.focusRow + 1}`, { tone: 'subdued' })];
  let visibleFocus = false;

  for (let index = options.startIndex; index < options.items.length; index += 1) {
    const rowLines = renderRefRowLines(options.items[index], index === options.focusRow, options.width);
    const needed = rowLines.length + (index > options.startIndex ? 1 : 0);
    if (lines.length + needed > options.height && lines.length > 1) {
      break;
    }
    if (index > options.startIndex) {
      lines.push('');
    }
    const remaining = Math.max(1, options.height - lines.length);
    lines.push(...rowLines.slice(0, remaining));
    if (index === options.focusRow) {
      visibleFocus = true;
    }
    if (lines.length >= options.height) {
      break;
    }
  }

  return { lines, visibleFocus };
}

/**
 * Render the refs-browser list body with whitespace-aware wrapping.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ width: number, height: number }} size
 * @returns {string}
 */
/**
 * Resolve the scroll start index that keeps the focused row visible.
 *
 * Variable-height ref rows mean the model's scrollY is an approximation.
 * This selector adjusts it so the focused row is guaranteed visible.
 *
 * @param {{ items: import('./dashboard-cmds.js').RefInventoryItem[], focusRow: number, scrollY: number }} state
 * @param {{ width: number, height: number, ctx: BijouContext }} size
 * @returns {number}
 */
function resolveRefsScrollStart(state, size) {
  const focusRow = Math.max(0, Math.min(state.focusRow, state.items.length - 1));
  let start = Math.max(0, Math.min(state.scrollY, state.items.length - 1));
  let viewport = buildRefsViewport({ ...state, focusRow, startIndex: start, ...size });
  while (!viewport.visibleFocus && start < focusRow) {
    start += 1;
    viewport = buildRefsViewport({ ...state, focusRow, startIndex: start, ...size });
  }
  return start;
}

function renderRefsListBody(model, deps, size) {
  if (model.refsStatus !== 'ready') {
    return renderRefsListStatusBody(model, size.width);
  }

  const focusRow = Math.max(0, Math.min(model.refsTable.focusRow, model.refsItems.length - 1));
  const start = resolveRefsScrollStart(
    { items: model.refsItems, focusRow, scrollY: model.refsTable.scrollY },
    { width: size.width, height: size.height, ctx: deps.ctx },
  );
  const viewport = buildRefsViewport({
    items: model.refsItems,
    focusRow,
    startIndex: start,
    width: size.width,
    height: size.height,
    ctx: deps.ctx,
  });

  return viewport.lines.join('\n');
}

/**
 * Build ref namespace counts.
 *
 * @param {import('./dashboard-cmds.js').RefInventoryItem[]} refsItems
 * @returns {Map<string, number>}
 */
function refNamespaceCounts(refsItems) {
  const counts = new Map();
  for (const ref of refsItems) {
    counts.set(ref.namespace, (counts.get(ref.namespace) ?? 0) + 1);
  }
  return counts;
}

/**
 * Append inventory summary lines to the refs sidebar.
 *
 * @param {{ lines: string[], model: DashModel, ctx: BijouContext, width: number, namespaceCounts: Map<string, number> }} options
 */
function appendRefsInventory(options) {
  options.lines.push(sectionHeading(options.ctx, 'Inventory', 'brand'));
  pushWrappedText(
    options.lines,
    `refs ${options.model.refsItems.length} under ${options.namespaceCounts.size} namespaces`,
    { width: options.width },
  );
  pushWrappedText(options.lines, `current ${sourceLabel(options.model.source)}`, { width: options.width });
}

/**
 * Append selected-ref detail lines to the refs sidebar.
 *
 * @param {{ lines: string[], current: import('./dashboard-cmds.js').RefInventoryItem, ctx: BijouContext, width: number }} options
 */
function appendSelectedRefDetails(options) {
  options.lines.push('', sectionHeading(options.ctx, 'Selected Ref', 'accent'));
  pushWrappedText(options.lines, `ref ${options.current.ref}`, { width: options.width });
  pushWrappedText(
    options.lines,
    options.current.detail,
    { width: options.width },
  );
  pushWrappedText(options.lines, `namespace ${options.current.namespace}`, { width: options.width });
  pushWrappedText(
    options.lines,
    `status ${options.current.browsable ? 'browsable' : 'opaque'}  kind ${options.current.resolution}  entries ${options.current.entryCount}`,
    { width: options.width },
  );
  if (options.current.browsable) {
    options.lines.push('');
    pushWrappedText(options.lines, 'Press enter to switch source to this ref.', { width: options.width });
  }
  options.lines.push('');
  pushWrappedText(options.lines, `oid ${options.current.oid}`, { width: options.width });
  if (options.current.previewSlugs.length > 0) {
    options.lines.push('', sectionHeading(options.ctx, 'Preview', 'info'));
    for (const slug of options.current.previewSlugs) {
      pushWrappedText(options.lines, slug, { width: options.width, prefix: '- ' });
    }
  }
}

/**
 * Append namespace summary lines to the refs sidebar.
 *
 * @param {{ lines: string[], namespaceCounts: Map<string, number>, ctx: BijouContext, width: number }} options
 */
function appendNamespaceSummary(options) {
  if (options.namespaceCounts.size === 0) {
    return;
  }
  options.lines.push('', sectionHeading(options.ctx, 'Namespaces', 'warning'));
  for (const [namespace, count] of Array.from(options.namespaceCounts.entries()).slice(0, 8)) {
    pushWrappedText(options.lines, `${namespace} (${count})`, { width: options.width, prefix: '- ' });
  }
}

/**
 * Render the refs-browser detail sidebar.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @param {number} width
 * @returns {string}
 */
function renderRefsDetailBody(model, ctx, width) {
  const current = selectedRef(model);
  const namespaceCounts = refNamespaceCounts(model.refsItems);

  const sidebarLines = [];
  appendRefsInventory({ lines: sidebarLines, model, ctx, width, namespaceCounts });

  if (current) {
    appendSelectedRefDetails({ lines: sidebarLines, current, ctx, width });
  } else if (model.refsStatus === 'ready') {
    sidebarLines.push('');
    pushWrappedText(sidebarLines, 'Select a ref to inspect it.', { width });
  }

  appendNamespaceSummary({ lines: sidebarLines, namespaceCounts, ctx, width });
  return sidebarLines.join('\n');
}

/**
 * Render the full-screen refs browser.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderRefsView(model, deps, options) {
  const maxSidebarWidth = Math.max(22, options.width - 25);
  const sidebarWidth = Math.min(maxSidebarWidth, Math.max(30, Math.min(46, Math.floor(options.width * REFS_SIDEBAR_RATIO))));
  const listWidth = Math.max(18, options.width - sidebarWidth - 1);
  const viewHeight = options.height;
  const listPanel = renderPanel({
    title: 'Ref Index',
    body: renderRefsListBody(model, deps, {
      width: Math.max(8, listWidth - 2),
      height: Math.max(4, viewHeight - 2),
    }),
    width: listWidth,
    height: viewHeight,
    ctx: deps.ctx,
  });
  const detailPanel = renderPanel({
    title: 'Ref Dispatch',
    body: renderRefsDetailBody(model, deps.ctx, Math.max(8, sidebarWidth - 2)),
    width: sidebarWidth,
    height: viewHeight,
    ctx: deps.ctx,
  });

  return hstackSurface(0, listPanel, renderDividerSurface(options.height), detailPanel);
}

/**
 * Render the body content of the treemap map panel.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ mapWidth: number, mapHeight: number }} size
 * @returns {string}
 */
function renderTreemapMapBody(model, deps, size) {
  if (model.treemapStatus === 'loading') {
    return `Loading ${model.treemapScope} treemap...`;
  }
  if (model.treemapStatus === 'error') {
    return `Failed to load treemap\n\n${model.treemapError ?? 'unknown error'}`;
  }
  if (model.treemapReport && model.treemapScope === 'source' && model.treemapReport.summary.sourceEntries === 0) {
    return [
      'No CAS entries were resolved for the current source.',
      '',
      sourceLabel(model.source),
      '',
      'Press r to browse refs or T to return to the repository view.',
    ].join('\n');
  }
  if (model.treemapReport) {
    return renderRepoTreemapMap(model.treemapReport, {
      ctx: deps.ctx,
      width: Math.max(8, size.mapWidth - 2),
      height: Math.max(4, size.mapHeight - 2),
      selectedTileId: selectedTreemapTile(model)?.id ?? null,
    });
  }
  return 'Treemap has not been loaded yet.';
}

/**
 * Compose sidebar copy for the full-screen treemap view.
 *
 * @param {{ model: DashModel, deps: DashDeps, width: number, height: number }} options
 * @returns {string}
 */
function renderTreemapSidebarText(options) {
  const stateText = treemapSidebarStateText(options.model);
  if (stateText) {
    return stateText;
  }
  const sections = renderRepoTreemapSidebar(options.model.treemapReport, {
    ctx: options.deps.ctx,
    width: Math.max(16, options.width),
    height: options.height,
    selectedTileId: selectedTreemapTile(options.model)?.id ?? null,
  });
  return composeTreemapSidebarText({
    sections,
    ctx: options.deps.ctx,
    width: options.width,
    height: options.height,
  });
}

/**
 * Render the full-screen treemap view.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderTreemapView(model, deps, options) {
  const maxSidebarWidth = Math.max(18, options.width - 17);
  const sidebarWidth = Math.min(maxSidebarWidth, Math.max(24, Math.min(42, Math.floor(options.width * TREEMAP_SIDEBAR_RATIO))));
  const mapWidth = Math.max(16, options.width - sidebarWidth - 1);
  const mapHeight = options.height;
  const sidebarHeight = options.height;

  const mapTitle = `${model.treemapScope === 'repository' ? 'Repository Atlas' : 'Source Atlas'} · ${treemapLevelLabel(model)}`;
  const mapPanel = renderPanel({
    title: mapTitle,
    body: renderTreemapMapBody(model, deps, { mapWidth, mapHeight }),
    width: mapWidth,
    height: mapHeight,
    ctx: deps.ctx,
  });
  const sidebarPanel = renderPanel({
    title: 'Atlas Briefing',
    body: renderTreemapSidebarText({
      model,
      deps,
      width: Math.max(8, sidebarWidth - 2),
      height: Math.max(4, sidebarHeight - 2),
    }),
    width: sidebarWidth,
    height: sidebarHeight,
    ctx: deps.ctx,
  });

  return hstackSurface(0, mapPanel, renderDividerSurface(options.height), sidebarPanel);
}

/**
 * Human-readable view mode label for the status bar.
 *
 * @param {DashModel} model
 * @returns {string}
 */
function viewModeLabel(model) {
  if (model.activeDrawer === 'treemap') {
    return model.treemapScope === 'repository' ? 'atlas:repo' : 'atlas:source';
  }
  if (model.activeDrawer === 'refs') {
    return 'refs';
  }
  return model.viewMode === 'detail' ? 'entries:inspector' : 'entries:ledger';
}

/**
 * Build the left section of the status bar.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {string}
 */
function statusBarLeft(model, ctx) {
  const parts = [];
  const selected = selectedEntry(model);
  if (model.viewMode === 'detail' && selected) {
    parts.push(themeText(ctx, `inspecting ${selected.slug}`, { tone: 'accent' }));
    parts.push(themeText(ctx, `tree ${selected.treeOid.slice(0, 12)}`, { tone: 'secondary' }));
  } else {
    parts.push(themeText(ctx, model.metadata?.encryption ? 'encrypted' : 'plain', { tone: model.metadata?.encryption ? 'warning' : 'subdued' }));
    parts.push(themeText(ctx, `${model.entries.length} entries`, { tone: 'secondary' }));
    if (selected && model.activeDrawer !== 'treemap' && model.activeDrawer !== 'refs') {
      parts.push(themeText(ctx, selected.slug, { tone: 'accent' }));
    }
  }
  return parts.join(themeText(ctx, ' | ', { tone: 'subdued' }));
}

/**
 * Build the right section of the status bar.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {string}
 */
function statusBarRight(model, ctx) {
  const parts = [];
  parts.push(themeText(ctx, viewModeLabel(model), { tone: 'brand' }));
  if (model.gitBranch) {
    parts.push(themeText(ctx, model.gitBranch, { tone: 'info' }));
  }
  return parts.join(themeText(ctx, ' | ', { tone: 'subdued' }));
}

/**
 * Build the condensed keybinding hints line for the footer.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {string}
 */
function footerHints(model, ctx) {
  if (model.activeDrawer === 'treemap') {
    return `${kbd('j/k', { ctx })} move  ${kbd('+/-', { ctx })} drill  ${kbd('T', { ctx })} scope  ${kbd('esc', { ctx })} back  ${kbd('?', { ctx })} help  ${kbd('q', { ctx })} quit`;
  }
  if (model.activeDrawer === 'refs') {
    return `${kbd('j/k', { ctx })} move  ${kbd('enter', { ctx })} switch  ${kbd('esc', { ctx })} back  ${kbd('?', { ctx })} help  ${kbd('q', { ctx })} quit`;
  }
  if (model.viewMode === 'detail') {
    return `${kbd('j/k', { ctx })} section  ${kbd('space', { ctx })} toggle  ${kbd('esc', { ctx })} back  ${kbd('?', { ctx })} help  ${kbd('q', { ctx })} quit`;
  }
  return `${kbd('j/k', { ctx })} move  ${kbd('enter', { ctx })} inspect  ${kbd('/', { ctx })} filter  ${kbd('t', { ctx })} treemap  ${kbd('?', { ctx })} help  ${kbd('q', { ctx })} quit`;
}

/**
 * Render the footer surface with a status bar and condensed keybinding hints.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @param {number} width
 * @returns {Surface}
 */
function renderFooterSurface(model, ctx, width) {
  const barWidth = Math.max(1, width);
  const bar = statusBarSurface({
    left: statusBarLeft(model, ctx),
    right: statusBarRight(model, ctx),
    width: barWidth,
  });
  const ruleSurface = textSurface(shellRule(ctx, barWidth), barWidth, 1);
  const hintsSurface = textSurface(footerHints(model, ctx), barWidth, 1);
  return vstackSurface(bar, ruleSurface, hintsSurface);
}

/**
 * Render the body with a split explorer layout.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderBody(model, deps, options) {
  let bodySurface;
  if (model.activeDrawer === 'treemap') {
    bodySurface = renderTreemapView(model, deps, options);
  } else if (model.activeDrawer === 'refs') {
    bodySurface = renderRefsView(model, deps, options);
  } else if (model.viewMode === 'detail') {
    bodySurface = renderDetailPane(model, { width: model.columns, height: options.height, ctx: deps.ctx });
  } else {
    bodySurface = renderListPane(model, { width: model.columns, height: options.height, ctx: deps.ctx });
  }
  if (model.viewTransition) {
    // Return base surface for now to make tests pass; we will add Bijou shaders next.
  }
  return bodySurface;
}

/**
 * Render the help overlay surface.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ width: number, height: number }} opts
 * @returns {Surface | null}
 */
function renderHelpSurface(model, deps, opts) {
  if (!model.showHelp) {
    return null;
  }
  const body = helpView(deps.keyMap, { title: 'Keybindings Reference' });
  const panelWidth = Math.max(HELP_MIN_WIDTH, Math.min(HELP_MAX_WIDTH, opts.width - HELP_MARGIN));
  const lines = body.split('\n');
  const panelHeight = Math.max(8, Math.min(lines.length + 2, opts.height));
  return renderOverlayPanel({
    title: 'Help',
    body,
    width: panelWidth,
    height: panelHeight,
    ctx: deps.ctx,
  });
}

/**
 * Render any active operator overlays over the dashboard body.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 * @returns {void}
 */
/**
 * Render the Merkle DAG overlay if active.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderDagOverlay(model, deps, options) {
  if (!model.dagPane) {
    return;
  }
  const dagSurface = dagPane(model.dagPane, { ctx: deps.ctx });
  const dagBox = boxSurface(dagSurface, {
    ctx: deps.ctx,
    title: 'Merkle DAG',
    width: Math.min(options.screen.width, dagSurface.width + 2),
    height: Math.min(options.height, dagSurface.height + 2),
  });
  const dx = centerX(options.screen.width, dagBox.width);
  const dy = topThirdY(options.top, options.height, dagBox.height);
  options.screen.blit(dagBox, dx, dy);
}

/**
 * Render the quit confirmation modal if active.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderQuitModal(model, deps, options) {
  if (!model.quitConfirm) {
    return;
  }
  const body = [
    themeText(deps.ctx, 'Are you sure you want to quit?', { tone: 'primary', bold: true }),
    '',
    `  ${themeText(deps.ctx, 'q / y', { tone: 'accent' })}  ${themeText(deps.ctx, 'Confirm quit', { tone: 'secondary' })}`,
    `  ${themeText(deps.ctx, 'any', { tone: 'accent' })}    ${themeText(deps.ctx, 'Cancel', { tone: 'secondary' })}`,
  ].join('\n');
  const innerW = 36;
  const content = parseAnsiToSurface(body, innerW, 4);
  const modal = boxSurface(content, { ctx: deps.ctx, title: 'Quit', width: innerW + 2, height: 6 });
  const mx = centerX(options.screen.width, modal.width);
  const my = topThirdY(options.top, options.height, modal.height);
  options.screen.blit(modal, mx, my);
}

/**
 * Render the store wizard overlay if active.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderWizardOverlay(model, deps, options) {
  if (!model.storeWizard) {
    return;
  }
  const wizard = renderWizardSurface(model.storeWizard, {
    width: options.screen.width,
    height: options.height,
    ctx: deps.ctx,
  });
  const wx = centerX(options.screen.width, wizard.width);
  const wy = topThirdY(options.top, options.height, wizard.height);
  options.screen.blit(wizard, wx, wy);
}

/**
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

  renderDagOverlay(model, deps, options);
  renderWizardOverlay(model, deps, options);

  const palette = renderPaletteSurface(model, {
    width: options.screen.width,
    height: options.height,
    ctx: deps.ctx,
  });
  if (palette) {
    const x = centerX(options.screen.width, palette.width);
    const y = topThirdY(options.top, options.height, palette.height);
    options.screen.blit(palette, x, y);
  }

  const help = renderHelpSurface(model, deps, {
    width: options.screen.width,
    height: options.height,
  });
  if (help) {
    const hx = centerX(options.screen.width, help.width);
    const hy = topThirdY(options.top, options.height, help.height);
    options.screen.blit(help, hx, hy);
  }

  renderNotifications(model, deps, options);
  renderQuitModal(model, deps, options);
}

/**
 * Render notification overlays if any are active.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderNotifications(model, deps, options) {
  if (!hasNotifications(model.notifications)) {
    return;
  }
  const notificationOverlays = renderNotificationStack(model.notifications, {
    screenWidth: options.screen.width,
    screenHeight: options.screen.height,
    region: { col: 0, row: options.top, width: options.screen.width, height: options.height },
    ctx: deps.ctx,
    margin: 1,
    gap: 1,
  });
  for (const overlay of notificationOverlays) {
    if (overlay.surface) {
      options.screen.blit(overlay.surface, overlay.col, overlay.row);
    } else {
      const overlaySurface = textSurface(overlay.content, options.screen.width, options.screen.height);
      options.screen.blit(overlaySurface, overlay.col, overlay.row);
    }
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
  if (model.phase === 'title' || model.phase === 'password') {
    return renderTitleScreen(model, deps);
  }

  const width = Math.max(1, model.columns);
  const height = Math.max(1, model.rows);
  const margin = width >= 80 ? 2 : 1;
  const contentWidth = width - (margin * 2);

  const header = renderHeaderSurface(model, deps, contentWidth);
  const footer = renderFooterSurface(model, deps.ctx, contentWidth);
  const bodyTop = header.height;
  const bodyHeight = Math.max(1, height - header.height - footer.height);

  const bodySurface = renderBody(model, deps, { width: contentWidth, height: bodyHeight });
  
  // Compose shell with horizontal margins
  const shell = vstackSurface(
    hstackSurface(margin, header),
    hstackSurface(margin, bodySurface),
    hstackSurface(margin, footer)
  );

  renderOverlays(model, deps, { top: bodyTop, height: bodyHeight, screen: shell });

  return shell;
}

/**
 * Render the full-screen title/password screen.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {Surface}
 */
function renderTitleScreen(model, deps) {
  const width = Math.max(1, model.columns);
  const height = Math.max(1, model.rows);
  const screen = createSurface(width, height);
  const ctx = deps.ctx;
  const innerW = Math.min(56, width);
  const spacer = createSurface(1, 1);

  screen.blit(canvas(width, height, bakSneppenShader, {
    time: (model.titleTimeMs ?? 0) / 1000,
    resolution: 'quad',
    uniforms: { entryCount: model.vaultEntryCount }
  }), 0, 0);

  const surfaces = [
    textSurface(themeText(ctx, 'git-cas', { tone: 'brand', bold: true }), innerW, 1),
    textSurface(themeText(ctx, 'content-addressable storage', { tone: 'secondary' }), innerW, 1),
    spacer,
  ];

  if (model.phase === 'title') {
    surfaces.push(textSurface(themeText(ctx, model.promptEnter ? 'Vault is ready.' : 'Checking vault...', { tone: model.promptEnter ? 'success' : 'subdued' }), innerW, 1));
    if (model.promptEnter) {
      surfaces.push(spacer, textSurface(themeText(ctx, 'enter to continue  |  escape to quit', { tone: 'subdued' }), innerW, 1));
    }
  } else {
    surfaces.push(textSurface(themeText(ctx, 'Vault is encrypted. Enter passphrase to unlock.', { tone: 'warning' }), innerW, 1), spacer);
    const mask = '\u2022'.repeat(model.passphrase.length);
    surfaces.push(hstackSurface(1, createSurface(2, 1), textSurface(themeText(ctx, 'Passphrase:', { tone: 'accent' }), 11, 1), textSurface(`${mask}\u2588`, Math.max(1, innerW - 14), 1)));
    if (model.authError) {
      surfaces.push(spacer, hstackSurface(1, createSurface(2, 1), textSurface(themeText(ctx, model.authError, { tone: 'danger' }), Math.max(1, innerW - 3), 1)));
    }
    surfaces.push(spacer, textSurface(themeText(ctx, 'enter to unlock  |  escape to quit', { tone: 'subdued' }), innerW, 1));
  }

  const content = vstackSurface(...surfaces);
  const panel = boxSurface(content, { width: innerW + 4, padding: { left: 2, right: 2, top: 1, bottom: 1 }, ctx });
  screen.blit(panel, Math.max(0, Math.floor((width - panel.width) / 2)), Math.max(0, Math.floor((height - panel.height) / 3)));

  return screen;
}
