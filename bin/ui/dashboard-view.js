/**
 * Pure render functions for the vault dashboard.
 */

import { boxV3, createSurface, parseAnsiToSurface, kbd } from '@flyingrobots/bijou';
import { commandPalette, navigableTable, splitPaneLayout } from '@flyingrobots/bijou-tui';
import { renderRepoTreemapMap, renderRepoTreemapSidebar } from './repo-treemap.js';
import { GIT_CAS_PALETTE, chipSurface, inlineSurface, sectionHeading, shellRule, themeText } from './theme.js';
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
const TOAST_THEME = {
  error: { label: 'Error', bg: GIT_CAS_PALETTE.wine, fg: GIT_CAS_PALETTE.ivory },
  warning: { label: 'Warning', bg: [148, 82, 23], fg: GIT_CAS_PALETTE.ivory },
  info: { label: 'Info', bg: GIT_CAS_PALETTE.indigo, fg: GIT_CAS_PALETTE.ivory },
  success: { label: 'Success', bg: GIT_CAS_PALETTE.moss, fg: GIT_CAS_PALETTE.ivory },
};

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
    chipSurface(ctx, `${model.filtered.length}/${model.entries.length || model.filtered.length} visible`, 'info'),
  ];
  if (model.metadata?.encryption) {
    parts.push(chipSurface(ctx, 'encrypted', 'warning'));
  }
  if (model.filtering || model.filterText) {
    parts.push(chipSurface(ctx, model.filtering ? 'filtering' : `filter ${model.filterText}`, 'accent'));
  }
  if (model.activeDrawer === 'treemap') {
    parts.push(chipSurface(ctx, 'atlas view', 'brand'));
  } else if (model.activeDrawer === 'refs') {
    parts.push(chipSurface(ctx, 'ref index', 'brand'));
  } else {
    parts.push(chipSurface(ctx, model.splitPane.focused === 'a' ? 'entries ledger' : 'manifest inspector', 'brand'));
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
    parts.push(chipSurface(ctx, `selected ${selected.slug}`, 'accent'));
  }
  if (model.toasts.length > 0) {
    parts.push(chipSurface(ctx, `alerts ${model.toasts.length}`, 'warning'));
  }
  if (model.activeDrawer === 'treemap') {
    parts.push(chipSurface(ctx, `scope ${model.treemapScope}`, 'brand'));
    if (model.treemapScope === 'repository') {
      parts.push(chipSurface(ctx, `files ${model.treemapWorktreeMode}`, 'accent'));
    }
    parts.push(chipSurface(ctx, `level ${treemapLevelLabel(model)}`, 'info'));
    const tile = selectedTreemapTile(model);
    if (tile) {
      parts.push(chipSurface(ctx, `focus ${tile.label}`, 'warning'));
    }
  }
  if (model.activeDrawer && model.activeDrawer !== 'treemap') {
    parts.push(chipSurface(ctx, `${model.activeDrawer} drawer`, 'info'));
  }
  if (model.palette) {
    parts.push(chipSurface(ctx, 'command deck', 'warning'));
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
function renderHeaderSurface(model, deps) {
  const surface = createSurface(Math.max(1, model.columns), 4);
  blitInline(surface, {
    x: 0,
    y: 0,
    parts: [
      inlineSurface(deps.ctx, 'git-cas', { tone: 'brand' }),
      inlineSurface(deps.ctx, 'repository explorer', { tone: 'secondary' }),
    ],
    maxWidth: surface.width,
  });
  blitInline(surface, {
    x: 0,
    y: 1,
    parts: [
      inlineSurface(deps.ctx, 'cwd', { tone: 'accent' }),
      inlineSurface(deps.ctx, tailClip(deps.cwdLabel ?? '-', Math.max(1, surface.width - 5)), { tone: 'subdued' }),
    ],
    maxWidth: surface.width,
  });
  blitInline(surface, {
    x: 0,
    y: 2,
    parts: [inlineSurface(deps.ctx, sourceLabel(model.source), { tone: 'primary' }), ...headerParts(model, deps.ctx)],
    maxWidth: surface.width,
  });
  surface.blit(textSurface(shellRule(deps.ctx, surface.width), surface.width, 1), 0, 3);
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
 * Pad or clip text to a fixed width.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function padToWidth(text, width) {
  return text.length >= width ? text.slice(0, width) : `${text}${' '.repeat(width - text.length)}`;
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
  capped[maxLines - 1] = `${clip(capped[maxLines - 1], Math.max(1, width - 1))}…`;
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
function wrapToastParagraph(text, width) {
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
 * Measure an appropriate toast width for its title and message.
 *
 * @param {{ level: 'error' | 'warning' | 'info' | 'success', title: string, message: string }} toast
 * @param {number} maxWidth
 * @returns {number}
 */
function measureToastWidth(toast, maxWidth) {
  const theme = TOAST_THEME[toast.level] ?? TOAST_THEME.info;
  const titleLength = `${theme.label.toUpperCase()} // ${toast.title}`.length;
  const messageLength = toast.message
    .split('\n')
    .reduce((longest, line) => Math.max(longest, line.length), 0);
  const preferredInnerWidth = Math.max(26, Math.min(maxWidth - 2, Math.max(titleLength, messageLength + 4)));
  return Math.max(28, Math.min(maxWidth, preferredInnerWidth + 2));
}

/**
 * Wrap toast copy while preferring whitespace boundaries.
 *
 * @param {string} text
 * @param {number} width
 * @param {number} maxLines
 * @returns {string[]}
 */
function wrapToastText(text, width, maxLines) {
  const lines = text
    .split('\n')
    .flatMap((part) => wrapToastParagraph(part, Math.max(1, width)));
  return limitWrappedLines(lines, width, maxLines);
}

/**
 * Style a single toast content line.
 *
 * @param {{ text: string, theme: { bg: [number, number, number], fg: [number, number, number] }, ctx: BijouContext, width: number }} options
 * @returns {string}
 */
function styleToastLine(options) {
  return options.ctx.style.bgRgb(
    options.theme.bg[0],
    options.theme.bg[1],
    options.theme.bg[2],
    options.ctx.style.rgb(
      options.theme.fg[0],
      options.theme.fg[1],
      options.theme.fg[2],
      padToWidth(options.text, options.width),
    ),
  );
}

/**
 * Ease toast entry with a small overshoot so it pops into place.
 *
 * @param {number} progress
 * @returns {number}
 */
function easeOutBack(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  const overshoot = 1.70158;
  const shifted = clamped - 1;
  return 1 + ((overshoot + 1) * shifted * shifted * shifted) + (overshoot * shifted * shifted);
}

/**
 * Visible body line budget for the current toast animation phase.
 *
 * @param {{ phase?: 'entering' | 'steady' | 'exiting', progress?: number }} toast
 * @returns {number}
 */
function toastBodyLineBudget(toast) {
  if (toast.phase !== 'exiting') {
    return 3;
  }
  const progress = Math.max(0, Math.min(1, toast.progress ?? 1));
  if (progress > 0.66) {
    return 3;
  }
  if (progress > 0.36) {
    return 2;
  }
  if (progress > 0.16) {
    return 1;
  }
  return 0;
}

/**
 * Width of the toast for the current motion phase.
 *
 * @param {{ phase?: 'entering' | 'steady' | 'exiting', progress?: number }} toast
 * @param {number} baseWidth
 * @returns {number}
 */
function visibleToastWidth(toast, baseWidth) {
  if (toast.phase !== 'exiting') {
    return baseWidth;
  }
  const progress = Math.max(0, Math.min(1, toast.progress ?? 1));
  return Math.max(24, Math.min(baseWidth, Math.round(baseWidth * (0.56 + (progress * 0.44)))));
}

/**
 * Render one toast box surface.
 *
 * @param {{ id: number, level: 'error' | 'warning' | 'info' | 'success', title: string, message: string, phase?: 'entering' | 'steady' | 'exiting', progress?: number }} toast
 * @param {{ width: number, ctx: BijouContext }} opts
 * @returns {Surface}
 */
function renderToastSurface(toast, opts) {
  const theme = TOAST_THEME[toast.level] ?? TOAST_THEME.info;
  const baseWidth = measureToastWidth(toast, Math.max(32, Math.min(48, opts.width)));
  const width = visibleToastWidth(toast, baseWidth);
  const innerWidth = Math.max(1, width - 2);
  const bodyWidth = Math.max(1, innerWidth - 3);
  const bodyLineBudget = toastBodyLineBudget(toast);
  const bodyLines = wrapToastText(toast.message, bodyWidth, bodyLineBudget).map((line) => styleToastLine({
    text: line,
    theme,
    ctx: opts.ctx,
    width: bodyWidth,
  }));
  const titleText = padToWidth(`${theme.label.toUpperCase()} // ${toast.title}`, innerWidth);
  const chrome = opts.ctx.style.bold(opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '╔'));
  const border = opts.ctx.style.bold(opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '║'));
  const bottom = opts.ctx.style.bold(opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '╚'));
  const topLine = `${chrome}${opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '═'.repeat(innerWidth))}${opts.ctx.style.bold(opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '╗'))}`;
  const titleLine = `${border}${styleToastLine({ text: titleText, theme, ctx: opts.ctx, width: innerWidth })}${opts.ctx.style.bold(opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '║'))}`;
  const dividerLine = `${border}${opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '─'.repeat(innerWidth))}${opts.ctx.style.bold(opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '║'))}`;
  const contentLines = bodyLines.map((line) => {
    const rail = opts.ctx.style.bold(opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '▌'));
    return `${border}${rail} ${line} ${opts.ctx.style.bold(opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '║'))}`;
  });
  const bottomLine = `${bottom}${opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '═'.repeat(innerWidth))}${opts.ctx.style.bold(opts.ctx.style.rgb(theme.bg[0], theme.bg[1], theme.bg[2], '╝'))}`;
  const lines = contentLines.length > 0
    ? [topLine, titleLine, dividerLine, ...contentLines, bottomLine]
    : [topLine, titleLine, bottomLine];
  return textSurface(lines.join('\n'), width, lines.length);
}

/**
 * Render a soft drop shadow behind a toast.
 *
 * @param {number} width
 * @param {number} height
 * @param {BijouContext} ctx
 * @returns {Surface}
 */
function renderToastShadow(width, height, ctx) {
  const line = ctx.style.rgb(32, 38, 52, '░'.repeat(Math.max(1, width)));
  return textSurface(Array.from({ length: Math.max(1, height) }, () => line).join('\n'), width, height);
}

/**
 * Compute horizontal slide for toast motion.
 *
 * @param {{ progress?: number }} toast
 * @returns {number}
 */
function toastSlideOffset(toast) {
  const progress = Math.max(0, Math.min(1, toast.progress ?? 1));
  if (toast.phase === 'entering') {
    return Math.round((1 - easeOutBack(progress)) * 18);
  }
  if (toast.phase === 'exiting') {
    return Math.round((1 - progress) * 24);
  }
  return 0;
}

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
  return typeof model.doctorReport === 'string'
    ? model.doctorReport
    : model.doctorReport
    ? `${sectionHeading(ctx, 'Integrity Sweep', 'brand')}\n${themeText(ctx, 'Vault reachability, manifest health, and issue inventory.', { tone: 'subdued' })}\n\n${renderDoctorReport(model.doctorReport)}`
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
    title: 'Vault Metrics',
    body: statsDrawerBody(model, opts.ctx),
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
    title: 'Vault Doctor',
    body: doctorDrawerBody(model, opts.ctx),
    width: Math.max(32, Math.min(56, opts.width - 2)),
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
  return boxV3(textSurface(options.body, Math.max(1, options.width - 2), Math.max(1, options.height - 2)), {
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
 * Render stacked toast notifications in the lower-right corner.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderToastStack(model, deps, options) {
  const marginTop = 1;
  const marginRight = 4;
  let cursorY = options.top + marginTop;
  for (const toast of model.toasts) {
    const surface = renderToastSurface(toast, {
      width: Math.min(52, Math.max(40, Math.floor(options.screen.width * 0.44))),
      ctx: deps.ctx,
    });
    if (cursorY + surface.height > options.top + options.height) {
      break;
    }
    const slideOffset = toastSlideOffset(toast);
    const x = Math.max(0, options.screen.width - surface.width - marginRight + slideOffset);
    const shadow = renderToastShadow(surface.width, surface.height, deps.ctx);
    const shadowX = Math.max(0, x + 2);
    const shadowY = Math.min(options.top + options.height - shadow.height, cursorY + 1);
    options.screen.blit(shadow, shadowX, shadowY);
    options.screen.blit(surface, x, cursorY);
    cursorY += surface.height + 1;
  }
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
    themeText(opts.ctx, clip(model.filtering ? `filter /${model.filterText}\u2588` : model.filterText ? `filter ${model.filterText}` : 'filter all', innerWidth), { tone: 'accent' }),
    themeText(opts.ctx, clip(`${model.filtered.length} assets  focus row ${model.table.rows.length ? model.table.focusRow + 1 : 0}`, innerWidth), { tone: 'subdued' }),
  ];
  const tableHeight = Math.max(1, innerHeight - metaLines.length);

  if (model.table.rows.length === 0) {
    metaLines.push(model.status === 'loading'
      ? themeText(opts.ctx, 'Loading...', { tone: 'info' })
      : model.error
      ? themeText(opts.ctx, `Error: ${model.error}`, { tone: 'danger' })
      : themeText(opts.ctx, 'No entries', { tone: 'subdued' }));
  } else {
    const tableText = navigableTable(tableViewState(model, { width: innerWidth, height: tableHeight }), {
      ctx: opts.ctx,
      focusIndicator: model.splitPane.focused === 'a' ? '▸' : '·',
    });
    metaLines.push(tableText);
  }

  return boxV3(textSurface(metaLines.join('\n'), innerWidth, innerHeight), {
    ctx: opts.ctx,
    title: model.splitPane.focused === 'a' ? 'Entries Ledger *' : 'Entries Ledger',
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
      title: model.splitPane.focused === 'b' ? 'Manifest Inspector *' : 'Manifest Inspector',
      width: opts.width,
    });
  }

  const manifest = model.manifestCache.get(entry.slug);
  const summary = [
    `${themeText(opts.ctx, 'asset', { tone: 'accent' })} ${themeText(opts.ctx, entry.slug, { tone: 'primary', bold: true })}`,
    `${themeText(opts.ctx, 'tree', { tone: 'subdued' })}  ${themeText(opts.ctx, `${entry.treeOid.slice(0, 12)}...`, { tone: 'secondary' })}`,
  ];
  content.blit(textSurface(summary.join('\n'), innerWidth, Math.min(2, innerHeight)), 0, 0);

  if (!manifest) {
    const loadingText = entry.slug === model.loadingSlug
      ? themeText(opts.ctx, 'Loading manifest...', { tone: 'info' })
      : themeText(opts.ctx, 'Manifest not loaded yet.', { tone: 'subdued' });
    content.blit(textSurface(loadingText, innerWidth, Math.max(1, innerHeight - 3)), 0, 3);
    return boxV3(content, {
      ctx: opts.ctx,
      title: model.splitPane.focused === 'b' ? 'Manifest Inspector *' : 'Manifest Inspector',
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
    title: model.splitPane.focused === 'b' ? 'Manifest Inspector *' : 'Manifest Inspector',
    width: opts.width,
  });
}

/**
 * Choose a responsive table schema for the refs browser.
 *
 * @param {number} width
 * @returns {{ columns: { header: string, width: number, align?: 'left' | 'right' | 'center' }[], indexes: number[] }}
 */
function refTableSchema(width) {
  if (width >= 80) {
    return {
      columns: [
        { header: 'Namespace', width: 14 },
        { header: 'Ref', width: Math.max(16, width - 47) },
        { header: 'Kind', width: 10 },
        { header: 'Entries', width: 7, align: 'right' },
        { header: 'OID', width: 12 },
      ],
      indexes: [0, 1, 2, 3, 4],
    };
  }
  if (width >= 58) {
    return {
      columns: [
        { header: 'Ref', width: Math.max(18, width - 20) },
        { header: 'Kind', width: 10 },
        { header: 'Entries', width: 7, align: 'right' },
      ],
      indexes: [1, 2, 3],
    };
  }
  return {
    columns: [
      { header: 'Ref', width: Math.max(16, width - 12) },
      { header: 'CAS', width: 10 },
    ],
    indexes: [1, 2],
  };
}

/**
 * Clamp the refs table to the current pane size.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number }} size
 * @returns {import('@flyingrobots/bijou-tui').NavigableTableState}
 */
function refsTableViewState(model, size) {
  const schema = refTableSchema(size.width);
  const rows = model.refsTable.rows.map((row) => schema.indexes.map((index) => row[index] ?? ''));
  const focusRow = Math.max(0, Math.min(model.refsTable.focusRow, rows.length - 1));
  let scrollY = model.refsTable.scrollY;
  if (focusRow < scrollY) {
    scrollY = focusRow;
  } else if (focusRow >= scrollY + size.height) {
    scrollY = focusRow - size.height + 1;
  }
  return {
    ...model.refsTable,
    columns: schema.columns,
    rows,
    height: size.height,
    focusRow,
    scrollY: Math.min(scrollY, Math.max(0, rows.length - size.height)),
  };
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
 * Render the refs-browser table body.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ width: number, height: number }} size
 * @returns {string}
 */
function renderRefsListBody(model, deps, size) {
  if (model.refsStatus === 'loading') {
    return 'Loading refs...';
  }
  if (model.refsStatus === 'error') {
    return `Failed to load refs\n\n${model.refsError ?? 'unknown error'}`;
  }
  if (model.refsItems.length === 0) {
    return 'No refs found.';
  }
  return navigableTable(refsTableViewState(model, size), {
    ctx: deps.ctx,
    focusIndicator: '▸',
  });
}

/**
 * Render the refs-browser detail sidebar.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderRefsDetailBody(model, ctx) {
  const current = selectedRef(model);
  const namespaceCounts = new Map();
  for (const ref of model.refsItems) {
    namespaceCounts.set(ref.namespace, (namespaceCounts.get(ref.namespace) ?? 0) + 1);
  }

  const sidebarLines = [
    sectionHeading(ctx, 'Inventory', 'brand'),
    `refs ${model.refsItems.length} under ${namespaceCounts.size} namespaces`,
    `current ${sourceLabel(model.source)}`,
    '',
  ];

  if (current) {
    sidebarLines.push(
      sectionHeading(ctx, 'Selected Ref', 'accent'),
      `ref ${current.ref}`,
      `namespace ${current.namespace}`,
      `oid ${current.oid}`,
      `status ${current.browsable ? 'browsable' : 'opaque'}`,
      `kind ${current.resolution}`,
      `entries ${current.entryCount}`,
      '',
      current.detail,
    );
    if (current.previewSlugs.length > 0) {
      sidebarLines.push('', sectionHeading(ctx, 'Preview', 'info'), ...current.previewSlugs.map((slug) => `- ${slug}`));
    }
    sidebarLines.push('', current.browsable
      ? 'Press enter to switch source to this ref.'
      : 'This ref does not currently resolve to CAS entries.');
  } else if (model.refsStatus === 'ready') {
    sidebarLines.push('Select a ref to inspect it.');
  }

  if (namespaceCounts.size > 0) {
    sidebarLines.push(
      '',
      sectionHeading(ctx, 'Namespaces', 'warning'),
      ...Array.from(namespaceCounts.entries())
        .slice(0, 8)
        .map(([namespace, count]) => `- ${namespace} (${count})`),
    );
  }

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
  const maxSidebarWidth = Math.max(22, options.screen.width - 25);
  const sidebarWidth = Math.min(maxSidebarWidth, Math.max(30, Math.min(46, Math.floor(options.screen.width * 0.35))));
  const listWidth = Math.max(18, options.screen.width - sidebarWidth - 1);
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
    body: renderRefsDetailBody(model, deps.ctx),
    width: sidebarWidth,
    height: viewHeight,
    ctx: deps.ctx,
  });

  options.screen.blit(listPanel, 0, options.top);
  options.screen.blit(renderDividerSurface(options.height), listWidth, options.top);
  options.screen.blit(detailPanel, listWidth + 1, options.top);
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
  const maxSidebarWidth = Math.max(18, options.screen.width - 17);
  const sidebarWidth = Math.min(maxSidebarWidth, Math.max(24, Math.min(42, Math.floor(options.screen.width * 0.32))));
  const mapWidth = Math.max(16, options.screen.width - sidebarWidth - 1);
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

  options.screen.blit(mapPanel, 0, options.top);
  options.screen.blit(renderDividerSurface(options.height), mapWidth, options.top);
  options.screen.blit(sidebarPanel, mapWidth + 1, options.top);
}

/**
 * Render the footer help surface.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @param {number} width
 * @returns {Surface}
 */
function renderFooterSurface(model, ctx, width) {
  const lines = model.activeDrawer === 'treemap'
    ? [
      shellRule(ctx, width),
      `${themeText(ctx, 'atlas', { tone: 'accent' })}  ${kbd('j/k', { ctx })} regions  ${kbd('d/u', { ctx })} page  ${kbd('+', { ctx })} descend  ${kbd('-', { ctx })} ascend`,
      `${themeText(ctx, 'scope', { tone: 'brand' })}  ${kbd('T', { ctx })} scope  ${kbd('i', { ctx })} files  ${kbd('r', { ctx })} refs  ${kbd('ctrl+p', { ctx })} palette`,
      `${themeText(ctx, 'ops', { tone: 'warning' })}  ${kbd('s', { ctx })} stats  ${kbd('g', { ctx })} doctor  ${kbd('esc', { ctx })} back  ${kbd('q', { ctx })} quit`,
    ]
    : model.activeDrawer === 'refs'
      ? [
        shellRule(ctx, width),
        `${themeText(ctx, 'index', { tone: 'accent' })}  ${kbd('j/k', { ctx })} refs  ${kbd('d/u', { ctx })} page  ${kbd('enter', { ctx })} switch source`,
        `${themeText(ctx, 'inspect', { tone: 'brand' })}  ${kbd('t', { ctx })} treemap  ${kbd('s', { ctx })} stats  ${kbd('g', { ctx })} doctor  ${kbd('ctrl+p', { ctx })} palette`,
        `${themeText(ctx, 'shell', { tone: 'warning' })}  ${kbd('esc', { ctx })} back  ${kbd('q', { ctx })} quit`,
      ]
      : [
      shellRule(ctx, width),
      `${themeText(ctx, 'browse', { tone: 'accent' })}  ${kbd('j/k', { ctx })} rows  ${kbd('d/u', { ctx })} page  ${kbd('J/K', { ctx })} scroll  ${kbd('enter', { ctx })} inspect`,
      `${themeText(ctx, 'shell', { tone: 'brand' })}  ${kbd('tab', { ctx })} pane  ${kbd('H/L', { ctx })} resize  ${kbd('ctrl+p', { ctx })} palette`,
      `${themeText(ctx, 'ops', { tone: 'warning' })}  ${kbd('s', { ctx })} stats  ${kbd('g', { ctx })} doctor  ${kbd('r', { ctx })} refs  ${kbd('t', { ctx })} treemap  ${kbd('T', { ctx })} scope  ${kbd('i', { ctx })} files  ${kbd('esc', { ctx })} close  ${kbd('q', { ctx })} quit`,
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
  if (model.activeDrawer === 'treemap') {
    renderTreemapView(model, deps, options);
    return;
  }
  if (model.activeDrawer === 'refs') {
    renderRefsView(model, deps, options);
    return;
  }
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

  renderToastStack(model, deps, options);
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
  const footer = renderFooterSurface(model, deps.ctx, width);
  const bodyTop = header.height;
  const bodyHeight = Math.max(1, height - header.height - footer.height);

  screen.blit(header, 0, 0);
  renderBody(model, deps, { top: bodyTop, height: bodyHeight, screen });
  renderOverlays(model, deps, { top: bodyTop, height: bodyHeight, screen });
  screen.blit(footer, 0, Math.max(0, height - footer.height));

  return screen;
}
