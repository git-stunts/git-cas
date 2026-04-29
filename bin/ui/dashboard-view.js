/**
 * Pure render functions for the vault dashboard.
 */

import { boxSurface, createSurface, parseAnsiToSurface } from '@flyingrobots/bijou';
import { canvas, commandPalette, hasNotifications, helpView, hstackSurface, navigableTable, renderNotificationStack, vstackSurface } from '@flyingrobots/bijou-tui';
import { renderRepoTreemapMap } from './repo-treemap.js';
import { inlineSurface, shellRule, themeText } from './theme.js';
import { renderManifestView } from './manifest-view.js';
import { organicFlowShader } from './shaders/organic-flow.js';

/**
 * @typedef {import('./dashboard.js').DashModel} DashModel
 * @typedef {import('./dashboard.js').DashDeps} DashDeps
 * @typedef {import('./dashboard.js').DashSource} DashSource
 */

const HELP_MAX_WIDTH = 60;
const HELP_MARGIN = 4;
const REFS_SIDEBAR_RATIO = 0.35;
const TREEMAP_SIDEBAR_RATIO = 0.32;

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
 * Position an overlay at roughly the top-third of the screen.
 *
 * @param {number} top
 * @param {number} containerHeight
 * @param {number} overlayHeight
 * @returns {number}
 */
function topThirdY(top, containerHeight, overlayHeight) {
  return Math.max(top, top + Math.floor((containerHeight - overlayHeight) / 3));
}

/**
 * Clips a path from the left so the leaf part is always visible.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function tailClip(text, width) {
  if (text.length <= width) {
    return text;
  }
  return `...${text.slice(text.length - (width - 3))}`;
}

/**
 * Return labels for the active source filters.
 *
 * @param {DashModel} model
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @returns {import('@flyingrobots/bijou').Surface[]}
 */
function headerParts(model, ctx) {
  const parts = [];
  if (model.gitBranch) {
    parts.push(inlineSurface(ctx, model.gitBranch, { tone: 'info' }));
  }
  if (model.filterText) {
    parts.push(inlineSurface(ctx, `/${model.filterText}`, { tone: 'accent' }));
  }
  return parts;
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
 * Render the main dashboard shell.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {import('@flyingrobots/bijou').Surface}
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

  // Final root surface filled with theme background to ensure total coverage
  const screen = createSurface(width, height);
  const themeBg = '#1d252b';
  screen.fill({ char: ' ', bg: themeBg });
  screen.blit(shell, 0, 0);

  renderOverlays(model, deps, { top: bodyTop, height: bodyHeight, screen });

  return screen;
}

/**
 * Render the full-screen title/password screen.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {import('@flyingrobots/bijou').Surface}
 */
function renderTitleScreen(model, deps) {
  const { columns: width, rows: height } = model;
  const screen = createSurface(width, height);
  const { ctx } = deps;
  const innerW = Math.min(56, width);
  const themeBg = '#1d252b';

  screen.fill({ char: ' ', bg: themeBg });
  screen.blit(canvas(width, height, organicFlowShader, {
    time: (model.titleTimeMs ?? 0) / 1000,
    resolution: 'braille',
    uniforms: { entryCount: model.vaultEntryCount, width, height }
  }), 0, 0);

  if (model.showPerfHud) {
    const fpsText = ` ${model.fps} FPS `;
    const hud = parseAnsiToSurface(fpsText, fpsText.length, 1);
    hud.fill({ char: ' ', bg: '#000000', fg: '#ffffff' });
    screen.blit(hud, 0, 0);
  }

  const surfaces = [
    textSurface(themeText(ctx, 'git-cas', { tone: 'brand', bold: true }), innerW, 1),
    textSurface(themeText(ctx, 'content-addressable storage', { tone: 'secondary' }), innerW, 1),
    createSurface(1, 1),
  ];

  if (model.phase === 'title') {
    const status = model.promptEnter ? 'Vault is ready.' : 'Checking vault...';
    const tone = model.promptEnter ? 'success' : 'subdued';
    surfaces.push(textSurface(themeText(ctx, status, { tone }), innerW, 1));
    if (model.promptEnter) {
      surfaces.push(createSurface(1, 1), textSurface(themeText(ctx, 'enter to continue  |  escape to quit', { tone: 'subdued' }), innerW, 1));
    }
  } else {
    surfaces.push(textSurface(themeText(ctx, 'Vault is encrypted. Enter passphrase to unlock.', { tone: 'warning' }), innerW, 1), createSurface(1, 1));
    const mask = '\u2022'.repeat(model.passphrase.length);
    surfaces.push(hstackSurface(1, createSurface(2, 1), textSurface(themeText(ctx, 'Passphrase:', { tone: 'accent' }), 11, 1), textSurface(`${mask}\u2588`, Math.max(1, innerW - 14), 1)));
    if (model.authError) {
      surfaces.push(createSurface(1, 1), hstackSurface(1, createSurface(2, 1), textSurface(themeText(ctx, model.authError, { tone: 'danger' }), Math.max(1, innerW - 3), 1)));
    }
    surfaces.push(createSurface(1, 1), textSurface(themeText(ctx, 'enter to unlock  |  escape to quit', { tone: 'subdued' }), innerW, 1));
  }

  const panel = boxSurface(vstackSurface(...surfaces), { width: innerW + 4, padding: { left: 2, right: 2, top: 1, bottom: 1 }, ctx });
  screen.blit(panel, Math.max(0, Math.floor((width - panel.width) / 2)), Math.max(0, Math.floor((height - panel.height) / 3)));
  return screen;
}

/**
 * Create a simple one-line text surface.
 *
 * @param {string} content
 * @param {number} width
 * @param {number} height
 * @returns {import('@flyingrobots/bijou').Surface}
 */
function textSurface(content, width, height) {
  return parseAnsiToSurface(content, width, height);
}

/**
 * Render the dashboard header area.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {number} width
 * @returns {import('@flyingrobots/bijou').Surface}
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
 * Render a simple themed panel with a title and body.
 *
 * @param {{ title: string, body: string | import('@flyingrobots/bijou').Surface, width: number, height: number, ctx: import('@flyingrobots/bijou').BijouContext }} options
 * @returns {import('@flyingrobots/bijou').Surface}
 */
function renderPanel(options) {
  const body = typeof options.body === 'string'
    ? textSurface(options.body, Math.max(1, options.width - 2), Math.max(1, options.height - 2))
    : options.body;
  return boxSurface(body, {
    ctx: options.ctx,
    title: options.title,
    width: options.width,
  });
}

/**
 * Render the dashboard footer area.
 *
 * @param {DashModel} model
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @param {number} width
 * @returns {import('@flyingrobots/bijou').Surface}
 */
function renderFooterSurface(model, ctx, width) {
  const w = Math.max(1, width);
  const statusLine = model.activeDrawer ? 'Press escape to close drawer.' : 'Press ? for help.';
  const helpHint = inlineSurface(ctx, statusLine, { tone: 'subdued' });
  const keyHints = hstackSurface(1,
    inlineSurface(ctx, 'q', { tone: 'accent' }), inlineSurface(ctx, 'quit', { tone: 'subdued' }),
    inlineSurface(ctx, '/', { tone: 'accent' }), inlineSurface(ctx, 'filter', { tone: 'subdued' }),
  );

  return vstackSurface(
    textSurface(shellRule(ctx, w), w, 1),
    hstackSurface(1, helpHint, createSurface(1, 1), keyHints)
  );
}

/**
 * Render the central dashboard body.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ width: number, height: number }} options
 * @returns {import('@flyingrobots/bijou').Surface}
 */
function renderBody(model, deps, options) {
  if (model.activeDrawer === 'treemap') {
    return renderTreemapView(model, deps, options);
  }
  if (model.activeDrawer === 'refs') {
    return renderRefsView(model, deps, options);
  }
  if (model.viewMode === 'detail') {
    return renderDetailPane(model, { width: options.width, height: options.height, ctx: deps.ctx });
  }
  return renderListPane(model, { width: options.width, height: options.height, ctx: deps.ctx });
}

/**
 * Render the asset list pane.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: import('@flyingrobots/bijou').BijouContext }} options
 * @returns {import('@flyingrobots/bijou').Surface}
 */
function renderListPane(model, options) {
  return navigableTable(model.table, {
    width: options.width,
    height: options.height,
    ctx: options.ctx,
  });
}

/**
 * Render the asset detail pane.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: import('@flyingrobots/bijou').BijouContext }} options
 * @returns {import('@flyingrobots/bijou').Surface}
 */
function renderDetailPane(model, options) {
  const content = renderManifestView({
    manifest: model.manifestCache.get(model.table.rows[model.table.focusRow][0]),
    ctx: options.ctx,
  });
  return renderPanel({
    title: 'Asset Detail',
    body: content,
    width: options.width,
    height: options.height,
    ctx: options.ctx,
  });
}

/**
 * Render the treemap full-screen view.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ width: number, height: number }} options
 * @returns {import('@flyingrobots/bijou').Surface}
 */
function renderTreemapView(model, deps, options) {
  const maxSidebarWidth = Math.max(18, options.width - 17);
  const sidebarWidth = Math.min(maxSidebarWidth, Math.max(24, Math.min(42, Math.floor(options.width * TREEMAP_SIDEBAR_RATIO))));
  const mapWidth = Math.max(16, options.width - sidebarWidth - 1);
  const mapHeight = options.height;

  const mapPanel = renderPanel({
    title: 'Repository Atlas',
    body: renderRepoTreemapMap(model.treemapReport, { ctx: deps.ctx, width: mapWidth - 2, height: mapHeight - 2 }),
    width: mapWidth,
    height: mapHeight,
    ctx: deps.ctx,
  });
  const sidebarPanel = renderPanel({
    title: 'Atlas Briefing',
    body: 'Treemap Sidebar Content Placeholder',
    width: sidebarWidth,
    height: mapHeight,
    ctx: deps.ctx,
  });

  return hstackSurface(0, mapPanel, textSurface('│', 1, options.height), sidebarPanel);
}

/**
 * Render the refs browser full-screen view.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ width: number, height: number }} options
 * @returns {import('@flyingrobots/bijou').Surface}
 */
function renderRefsView(model, deps, options) {
  const maxSidebarWidth = Math.max(22, options.width - 25);
  const sidebarWidth = Math.min(maxSidebarWidth, Math.max(30, Math.min(46, Math.floor(options.width * REFS_SIDEBAR_RATIO))));
  const listWidth = Math.max(18, options.width - sidebarWidth - 1);

  const listPanel = renderPanel({
    title: 'Ref Index',
    body: navigableTable(model.refsTable, { width: listWidth - 2, height: options.height - 2, ctx: deps.ctx }),
    width: listWidth,
    height: options.height,
    ctx: deps.ctx,
  });
  const detailPanel = renderPanel({
    title: 'Ref Dispatch',
    body: 'Ref Details Placeholder',
    width: sidebarWidth,
    height: options.height,
    ctx: deps.ctx,
  });

  return hstackSurface(0, listPanel, textSurface('│', 1, options.height), detailPanel);
}

/**
 * Render overlays (palette, help, notifications) over the main screen.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: import('@flyingrobots/bijou').Surface }} options
 */
function renderOverlays(model, deps, options) {
  if (model.palette) {
    const palette = commandPalette(model.palette, { width: Math.min(80, options.screen.width - 4), ctx: deps.ctx });
    const paletteSurface = typeof palette === 'string' ? textSurface(palette, Math.min(80, options.screen.width - 4), 10) : palette;
    options.screen.blit(paletteSurface, centerX(options.screen.width, paletteSurface.width), topThirdY(0, options.screen.height, paletteSurface.height));
  }
  if (model.showHelp) {
    const help = helpView({ width: Math.min(HELP_MAX_WIDTH, options.screen.width - HELP_MARGIN), ctx: deps.ctx });
    const helpSurface = typeof help === 'string' ? textSurface(help, Math.min(HELP_MAX_WIDTH, options.screen.width - HELP_MARGIN), 20) : help;
    options.screen.blit(helpSurface, centerX(options.screen.width, helpSurface.width), topThirdY(0, options.screen.height, helpSurface.height));
  }
  if (hasNotifications(model.notifications)) {
    const stack = renderNotificationStack(model.notifications, { width: 32, ctx: deps.ctx });
    const stackSurface = typeof stack === 'string' ? textSurface(stack, 32, 10) : stack;
    options.screen.blit(stackSurface, options.screen.width - stackSurface.width - 1, 1);
  }
}
