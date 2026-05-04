/**
 * Pure render functions for the V6 git-cas cockpit.
 */

import { boxSurface, createSurface, parseAnsiToSurface } from '@flyingrobots/bijou';
import {
  canvas,
  commandPaletteSurface,
  drawer,
  hstackSurface,
  modal,
  navigableTableSurface,
  placeSurface,
  renderNotificationStack,
  statusBarSurface,
  vstackSurface,
} from '@flyingrobots/bijou-tui';
import { renderRepoTreemapMap, renderRepoTreemapSidebar } from './repo-treemap.js';
import { shellRule, themeText } from './theme.js';
import { renderChunkTable, renderMerkleExplorer } from './blocks/merkle-explorer.js';
import { renderHealthDashboard } from './blocks/health-dashboard.js';
import { renderOperationFeed } from './blocks/operation-feed.js';
import { renderWizardSurface } from './store-wizard.js';
import { organicFlowShader } from './shaders/organic-flow.js';
import { shortShaStatus } from './components/short-sha.js';

/** @typedef {import('./dashboard.js').DashModel} DashModel */
/** @typedef {import('./dashboard.js').DashDeps} DashDeps */
/** @typedef {import('./dashboard.js').DashSource} DashSource */

const BG = '#25313a';
const HELP_WIDTH = 58;

function sourceLabel(source) {
  if (source.type === 'vault') { return 'vault'; }
  if (source.type === 'ref') { return `ref ${source.ref}`; }
  return `oid ${source.treeOid}`;
}

function textSurface(content, width, height) {
  return parseAnsiToSurface(content, Math.max(1, width), Math.max(1, height));
}

function blank(width, height) {
  return createSurface(Math.max(1, width), Math.max(1, height), { char: ' ', bg: BG });
}

function verticalRail(ctx, height) {
  return textSurface(Array.from({ length: Math.max(1, height) }, () =>
    themeText(ctx, '│', { tone: 'accent', bold: true })).join('\n'), 1, height);
}

function panel({ title, body, width, height, ctx, active = false }) {
  const safeWidth = Math.max(4, width);
  const safeHeight = Math.max(3, height);
  const innerWidth = Math.max(1, safeWidth - 2);
  const innerHeight = Math.max(1, safeHeight - 2);
  const bodySurface = typeof body === 'string'
    ? textSurface(body, innerWidth, innerHeight)
    : placeSurface(body, { width: innerWidth, height: innerHeight });
  const boxed = boxSurface(bodySurface, {
    ctx,
    title,
    width: safeWidth,
    borderToken: ctx.theme.theme.border.secondary,
    bgToken: ctx.theme.theme.surface.primary,
  });
  const placed = placeSurface(boxed, { width: safeWidth, height: safeHeight });
  if (active) { placed.blit(verticalRail(ctx, safeHeight), 0, 0); }
  return placed;
}

function metricLine(model, ctx) {
  if (model.statsStatus === 'ready' && model.statsReport) {
    return [
      `${themeText(ctx, 'entries', { tone: 'accent' })} ${model.statsReport.entries}`,
      `${themeText(ctx, 'dedup', { tone: 'accent' })} ${model.statsReport.dedupRatio.toFixed(2)}x`,
      `${themeText(ctx, 'logical', { tone: 'accent' })} ${formatSize(model.statsReport.totalLogicalSize)}`,
      `${themeText(ctx, 'encrypted', { tone: 'accent' })} ${model.statsReport.encryptedEntries}`,
    ].join('  ');
  }
  return [
    `${themeText(ctx, 'entries', { tone: 'accent' })} ${model.entries.length}`,
    `${themeText(ctx, 'loaded manifests', { tone: 'accent' })} ${model.manifestCache.size}`,
    `${themeText(ctx, 'source', { tone: 'accent' })} ${sourceLabel(model.source)}`,
  ].join('  ');
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) { return '-'; }
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}K`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)}M`; }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function workspaceTabs(model, ctx) {
  const tabs = [
    ['explorer', '1 Explorer'],
    ['atlas', '2 Atlas'],
    ['operations', '3 Operations'],
  ];
  return tabs.map(([id, label]) => {
    const active = model.workspace === id;
    return themeText(ctx, active ? `▌ ${label}` : `  ${label}`, { tone: active ? 'brand' : 'secondary', bold: active });
  }).join('  ');
}

function renderHeaderSurface(model, deps, width) {
  const left = themeText(deps.ctx, ' git-cas cockpit', { tone: 'brand', bold: true });
  const center = workspaceTabs(model, deps.ctx);
  const right = model.gitBranch ? themeText(deps.ctx, model.gitBranch, { tone: 'info' }) : themeText(deps.ctx, model.status, { tone: 'secondary' });
  const first = statusBarSurface({ left, center, right, width });
  const economics = statusBarSurface({
    left: ` ${metricLine(model, deps.ctx)}`,
    right: themeText(deps.ctx, sourceLabel(model.source), { tone: 'primary' }),
    width,
  });
  const filter = model.filtering
    ? `${themeText(deps.ctx, 'filter', { tone: 'accent' })} /${model.filterText}█`
    : `${themeText(deps.ctx, 'filter', { tone: 'accent' })} ${model.filterText ? `/${model.filterText}` : 'none'}`;
  const third = statusBarSurface({
    left: ` ${filter}`,
    right: model.error ? themeText(deps.ctx, model.error, { tone: 'danger' }) : '',
    width,
  });
  const rule = textSurface(shellRule(deps.ctx, width), width, 1);
  return vstackSurface(first, economics, third, rule);
}

function renderFooterSurface(model, ctx, width) {
  const left = model.quitConfirm
    ? themeText(ctx, 'Quit? y/enter confirm, n/escape cancel', { tone: 'warning' })
    : themeText(ctx, '? help  / filter  ctrl+p palette  F2 settings  q quit', { tone: 'subdued' });
  const rightByWorkspace = {
    explorer: model.focusPane === 'detail'
      ? 'tab focus  j/k chunk  u/d page  enter ledger'
      : 'tab focus  j/k rows  enter detail  m merkle',
    atlas: 'j/k focus  +/- drill  t scope  i ignored',
    operations: 'n store  s stats  x doctor',
  };
  const detailStatus = selectedShaFooter(model);
  const footer = statusBarSurface({
    left: ` ${left}`,
    right: detailStatus
      ? themeText(ctx, detailStatus, { tone: 'info' })
      : themeText(ctx, rightByWorkspace[model.workspace], { tone: 'secondary' }),
    width,
  });
  return vstackSurface(textSurface(shellRule(ctx, width), width, 1), footer);
}

export function tableSchema(width) {
  if (width >= 110) {
    const slugWidth = Math.max(18, Math.min(36, width - 82));
    return {
      columns: [
        { header: 'Slug', width: slugWidth },
        { header: 'Tree OID', width: 14 },
        { header: 'Size', width: 10 },
        { header: 'Chunks', width: 8 },
        { header: 'Crypto', width: 10 },
        { header: 'Format', width: 12 },
        { header: 'State', width: 8 },
      ],
      indexes: [0, 1, 2, 3, 4, 5, 6],
    };
  }
  if (width >= 72) {
    const slugWidth = Math.max(18, Math.min(34, width - 48));
    return {
      columns: [
        { header: 'Slug', width: slugWidth },
        { header: 'Size', width: 10 },
        { header: 'Chunks', width: 8 },
        { header: 'Crypto', width: 10 },
        { header: 'State', width: 8 },
      ],
      indexes: [0, 2, 3, 4, 6],
    };
  }
  return {
    columns: [
      { header: 'Slug', width: Math.max(12, width - 14) },
      { header: 'State', width: 8 },
    ],
    indexes: [0, 6],
  };
}

export function renderDashboard(model, deps) {
  if (model.phase === 'title' || model.phase === 'password') {
    return renderTitleScreen(model, deps);
  }

  const width = Math.max(1, model.columns);
  const height = Math.max(1, model.rows);
  const screen = createSurface(width, height, { char: ' ', bg: BG });
  const header = renderHeaderSurface(model, deps, width);
  const footer = renderFooterSurface(model, deps.ctx, width);
  const bodyHeight = Math.max(1, height - header.height - footer.height);
  const body = renderBody(model, deps, { width: Math.max(1, width - 1), height: bodyHeight });

  screen.blit(vstackSurface(header, hstackSurface(0, verticalRail(deps.ctx, bodyHeight), body), footer), 0, 0);
  renderOverlays(model, deps, { screen, width, height });
  return screen;
}

function renderTitleScreen(model, deps) {
  const { columns: width, rows: height } = model;
  const screen = createSurface(width, height, { char: ' ', bg: BG });
  const { ctx } = deps;
  const innerW = Math.min(56, width);

  screen.blit(canvas(width, height, organicFlowShader, {
    time: (model.titleTimeMs ?? 0) / 1000,
    resolution: 'braille',
    uniforms: { entryCount: model.vaultEntryCount, width, height },
  }), 0, 0);

  if (model.showPerfHud) {
    const fpsText = ` ${model.fps} FPS `;
    const hud = parseAnsiToSurface(fpsText, fpsText.length, 1);
    hud.fill({ char: ' ', bg: '#000000', fg: '#ffffff' });
    screen.blit(hud, 0, 0);
  }

  const surfaces = titlePanelSurfaces(model, ctx, innerW);

  const titlePanel = boxSurface(vstackSurface(...surfaces), {
    width: innerW + 4,
    padding: { left: 2, right: 2, top: 1, bottom: 1 },
    ctx,
    borderToken: ctx.theme.theme.border.primary,
    bgToken: ctx.theme.theme.surface.overlay,
  });
  screen.blit(titlePanel, Math.max(0, Math.floor((width - titlePanel.width) / 2)), Math.max(0, Math.floor((height - titlePanel.height) / 3)));
  return screen;
}

function titlePanelSurfaces(model, ctx, width) {
  const heading = [
    textSurface(themeText(ctx, 'git-cas', { tone: 'brand', bold: true }), width, 1),
    textSurface(themeText(ctx, 'content-addressable storage', { tone: 'secondary' }), width, 1),
    createSurface(1, 1),
  ];
  return model.phase === 'title'
    ? heading.concat(titlePhaseSurfaces(model, ctx, width))
    : heading.concat(passwordPhaseSurfaces(model, ctx, width));
}

function titlePhaseSurfaces(model, ctx, width) {
  const status = model.promptEnter ? 'Vault is ready.' : 'Checking vault...';
  const tone = model.promptEnter ? 'success' : 'subdued';
  const surfaces = [textSurface(themeText(ctx, status, { tone }), width, 1)];
  if (model.promptEnter) {
    surfaces.push(createSurface(1, 1), textSurface(themeText(ctx, 'enter to continue  |  escape to quit', { tone: 'subdued' }), width, 1));
  }
  return surfaces;
}

function passwordPhaseSurfaces(model, ctx, width) {
  const mask = '•'.repeat(model.passphrase.length);
  const surfaces = [
    textSurface(themeText(ctx, 'Vault is encrypted. Enter passphrase to unlock.', { tone: 'warning' }), width, 1),
    createSurface(1, 1),
    hstackSurface(1, createSurface(2, 1), textSurface(themeText(ctx, 'Passphrase:', { tone: 'accent' }), 11, 1), textSurface(`${mask}█`, Math.max(1, width - 14), 1)),
  ];
  if (model.authError) {
    surfaces.push(createSurface(1, 1), hstackSurface(1, createSurface(2, 1), textSurface(themeText(ctx, model.authError, { tone: 'danger' }), Math.max(1, width - 3), 1)));
  }
  surfaces.push(createSurface(1, 1), textSurface(themeText(ctx, 'enter to unlock  |  escape to quit', { tone: 'subdued' }), width, 1));
  return surfaces;
}

function renderBody(model, deps, options) {
  if (model.workspace === 'atlas') { return renderAtlasWorkspace(model, deps, options); }
  if (model.workspace === 'operations') { return renderOperationsWorkspace(model, deps, options); }
  return renderExplorerWorkspace(model, deps, options);
}

function renderExplorerWorkspace(model, deps, options) {
  if (options.width < 88) {
    const ledgerHeight = Math.max(8, Math.floor(options.height * 0.52));
    const detailHeight = Math.max(4, options.height - ledgerHeight - 1);
    return vstackSurface(
      renderLedgerPanel(model, deps.ctx, { width: options.width, height: ledgerHeight }),
      blank(options.width, 1),
      renderInspectorPanel(model, deps.ctx, { width: options.width, height: detailHeight }),
    );
  }
  const gap = 2;
  const ledgerWidth = Math.max(36, Math.floor(options.width * 0.47));
  const inspectorWidth = Math.max(24, options.width - ledgerWidth - gap);
  return hstackSurface(
    gap,
    renderLedgerPanel(model, deps.ctx, { width: ledgerWidth, height: options.height }),
    renderInspectorPanel(model, deps.ctx, { width: inspectorWidth, height: options.height }),
  );
}

function renderLedgerPanel(model, ctx, box) {
  const { width, height } = box;
  const schema = tableSchema(Math.max(20, width - 2));
  const projectedRows = model.table.rows.map((row) => schema.indexes.map((index) => row[index] ?? ''));
  const tableSurface = navigableTableSurface({
    columns: schema.columns,
    rows: projectedRows,
    focusRow: model.table.focusRow,
    scrollY: model.table.scrollY,
    height: Math.max(1, height - 5),
  }, { ctx });
  return panel({ title: 'Asset Ledger', body: tableSurface, width, height, ctx, active: model.focusPane === 'ledger' });
}

function selectedEntry(model) {
  return model.filtered[Math.min(model.table.focusRow, Math.max(0, model.filtered.length - 1))] ?? null;
}

function manifestData(manifest) {
  return manifest?.toJSON ? manifest.toJSON() : manifest;
}

function selectedManifest(model) {
  const entry = selectedEntry(model);
  return entry ? manifestData(model.manifestCache.get(entry.slug)) : null;
}

function selectedChunk(model) {
  const chunks = selectedManifest(model)?.chunks ?? [];
  const index = Math.max(0, Math.min(model.chunkFocus ?? 0, Math.max(0, chunks.length - 1)));
  return chunks[index] ?? null;
}

function selectedShaFooter(model) {
  if (model.workspace !== 'explorer' || model.focusPane !== 'detail') { return null; }
  const chunk = selectedChunk(model);
  if (!chunk) { return null; }
  const digest = shortShaStatus('digest', chunk.digest);
  const blob = shortShaStatus('blob', chunk.blob);
  return [`#${chunk.index}`, digest, blob].filter(Boolean).join('  ');
}

function renderInspectorPanel(model, ctx, box) {
  const { width, height } = box;
  const entry = selectedEntry(model);
  const manifest = selectedManifest(model);
  if (!entry) {
    return panel({ title: 'Inspector', body: 'No asset selected.', width, height, ctx, active: model.focusPane === 'detail' });
  }
  if (model.explorerMode === 'merkle') {
    return panel({
      title: `Merkle Lens [${model.merkleMode}]`,
      body: renderMerkleBody({ model, manifest, ctx, box: { width, height } }),
      width,
      height,
      ctx,
      active: model.focusPane === 'detail',
    });
  }
  if (model.explorerMode === 'manifest') {
    const body = manifest
      ? renderManifestDetail({ model, manifest, ctx, box: { width, height } })
      : `Loading manifest for ${entry.slug}...\n${entry.treeOid}`;
    return panel({ title: 'Manifest Ledger', body, width, height, ctx, active: model.focusPane === 'detail' });
  }
  return panel({ title: 'Inspector', body: renderInspectorBody(entry, manifest, ctx), width, height, ctx, active: model.focusPane === 'detail' });
}

function renderInspectorBody(entry, manifest, ctx) {
  const lines = [
    `${themeText(ctx, 'slug', { tone: 'accent' })}       ${entry.slug}`,
    `${themeText(ctx, 'tree', { tone: 'accent' })}       ${entry.treeOid}`,
  ];
  if (!manifest) {
    lines.push('', themeText(ctx, 'manifest pending', { tone: 'subdued' }));
    return lines.join('\n');
  }
  lines.push(
    `${themeText(ctx, 'size', { tone: 'accent' })}       ${formatSize(manifest.size)}`,
    `${themeText(ctx, 'chunks', { tone: 'accent' })}     ${manifest.chunks?.length ?? 0}`,
    `${themeText(ctx, 'crypto', { tone: 'accent' })}     ${manifest.encryption ? 'encrypted' : 'plaintext'}`,
    `${themeText(ctx, 'compress', { tone: 'accent' })}   ${manifest.compression?.algorithm ?? 'none'}`,
    `${themeText(ctx, 'format', { tone: 'accent' })}     ${manifest.formatVersion ?? manifest.version ?? '-'}`,
    '',
    themeText(ctx, 'enter detail  |  tab detail focus  |  ctrl+p digest search', { tone: 'subdued' }),
  );
  return lines.join('\n');
}

function pageSizeForDetail(height) {
  return Math.max(1, height - 15);
}

function renderManifestDetail({ model, manifest, ctx, box }) {
  const chunks = manifest.chunks ?? [];
  const lines = [
    themeText(ctx, 'Asset', { tone: 'accent', bold: true }),
    `${themeText(ctx, 'slug', { tone: 'accent' })}       ${manifest.slug ?? '-'}`,
    `${themeText(ctx, 'filename', { tone: 'accent' })}   ${manifest.filename ?? '-'}`,
    `${themeText(ctx, 'size', { tone: 'accent' })}       ${formatSize(manifest.size)}`,
    `${themeText(ctx, 'crypto', { tone: 'accent' })}     ${manifest.encryption ? 'encrypted' : 'plaintext'}`,
    `${themeText(ctx, 'chunks', { tone: 'accent' })}     ${chunks.length}`,
    '',
    themeText(ctx, `Chunk Ledger (${chunks.length})`, { tone: 'info', bold: true }),
  ];
  if (chunks.length === 0) { return lines.concat('No chunks.').join('\n'); }
  return lines.concat(renderChunkTable(manifest, ctx, {
    selectedIndex: Math.min(model.chunkFocus ?? 0, chunks.length - 1),
    pageSize: pageSizeForDetail(box.height),
    width: Math.max(24, box.width - 4),
  })).join('\n');
}

function renderMerkleBody({ model, manifest, ctx, box }) {
  if (!manifest) { return 'No manifest loaded.'; }
  const tabs = ['table', 'tree', 'dag']
    .map((item) => item === model.merkleMode ? `[${item}]` : ` ${item} `)
    .join(' ');
  if (model.merkleMode !== 'table') {
    return `${themeText(ctx, tabs, { tone: 'accent' })}\n\n${renderMerkleExplorer(manifest, model.merkleMode, ctx)}`;
  }
  return `${themeText(ctx, tabs, { tone: 'accent' })}\n\n${renderChunkTable(manifest, ctx, {
    selectedIndex: Math.min(model.chunkFocus ?? 0, (manifest.chunks?.length ?? 1) - 1),
    pageSize: pageSizeForDetail(box.height),
    width: Math.max(24, box.width - 4),
  })}`;
}

function renderAtlasWorkspace(model, deps, options) {
  const gap = options.width >= 76 ? 2 : 1;
  const sidebarWidth = Math.min(44, Math.max(28, Math.floor(options.width * 0.34)));
  const mapWidth = Math.max(20, options.width - sidebarWidth - gap);
  if (!model.treemapReport) {
    const body = model.treemapStatus === 'error'
      ? `Atlas unavailable\n\n${model.treemapError}`
      : 'Loading repository atlas...';
    return panel({ title: 'Repository Atlas', body, width: options.width, height: options.height, ctx: deps.ctx });
  }
  const selected = model.treemapReport.tiles?.[model.treemapFocus]?.id ?? null;
  const map = renderRepoTreemapMap(model.treemapReport, {
    ctx: deps.ctx,
    width: Math.max(12, mapWidth - 2),
    height: Math.max(4, options.height - 2),
    selectedTileId: selected,
  });
  const sidebar = renderRepoTreemapSidebar(model.treemapReport, {
    ctx: deps.ctx,
    width: Math.max(16, sidebarWidth - 2),
    height: Math.max(4, options.height - 2),
    selectedTileId: selected,
  });
  const briefing = [
    themeText(deps.ctx, 'Overview', { tone: 'accent', bold: true }),
    sidebar.overview,
    '',
    themeText(deps.ctx, 'Focused Region', { tone: 'accent', bold: true }),
    sidebar.focused,
    '',
    themeText(deps.ctx, 'Legend', { tone: 'accent', bold: true }),
    sidebar.legend,
    '',
    themeText(deps.ctx, 'Largest Regions', { tone: 'accent', bold: true }),
    sidebar.regions,
    '',
    sidebar.notes,
  ].filter(Boolean).join('\n');
  return hstackSurface(
    gap,
    panel({ title: 'Repository Atlas', body: map, width: mapWidth, height: options.height, ctx: deps.ctx }),
    panel({ title: 'Atlas Briefing', body: briefing, width: sidebarWidth, height: options.height, ctx: deps.ctx }),
  );
}

function renderOperationsWorkspace(model, deps, options) {
  if (options.width < 100) {
    const topHeight = Math.max(8, Math.floor(options.height / 2));
    return vstackSurface(
      renderEconomicsPanel(model, deps.ctx, { width: options.width, height: topHeight }),
      renderOpsDetailPanel(model, deps.ctx, { width: options.width, height: Math.max(4, options.height - topHeight) }),
    );
  }
  const gap = 2;
  const leftWidth = Math.max(30, Math.floor((options.width - gap) * 0.42));
  const rightWidth = Math.max(30, options.width - leftWidth - gap);
  return hstackSurface(
    gap,
    renderEconomicsPanel(model, deps.ctx, { width: leftWidth, height: options.height }),
    renderOpsDetailPanel(model, deps.ctx, { width: rightWidth, height: options.height }),
  );
}

function renderEconomicsPanel(model, ctx, box) {
  const { width, height } = box;
  const body = model.statsStatus === 'ready' && model.statsReport
    ? renderStats(model.statsReport, ctx)
    : `${themeText(ctx, 'Vault Economics', { tone: 'brand', bold: true })}\n\nStats are ${model.statsStatus}. Press s to refresh.`;
  return panel({ title: 'Vault Economics', body, width, height, ctx });
}

function renderStats(stats, ctx) {
  const chunking = Object.entries(stats.chunkingStrategies ?? {})
    .map(([strategy, count]) => `${strategy}:${count}`)
    .join(', ') || '-';
  return [
    `${themeText(ctx, 'entries', { tone: 'accent' })}          ${stats.entries}`,
    `${themeText(ctx, 'logical size', { tone: 'accent' })}     ${formatSize(stats.totalLogicalSize)}`,
    `${themeText(ctx, 'chunk refs', { tone: 'accent' })}       ${stats.totalChunkRefs}`,
    `${themeText(ctx, 'unique chunks', { tone: 'accent' })}    ${stats.uniqueChunks}`,
    `${themeText(ctx, 'duplicate refs', { tone: 'accent' })}   ${stats.duplicateChunkRefs}`,
    `${themeText(ctx, 'dedup ratio', { tone: 'accent' })}      ${stats.dedupRatio.toFixed(2)}x`,
    `${themeText(ctx, 'encrypted', { tone: 'accent' })}        ${stats.encryptedEntries}`,
    `${themeText(ctx, 'compressed', { tone: 'accent' })}       ${stats.compressedEntries}`,
    `${themeText(ctx, 'chunking', { tone: 'accent' })}         ${chunking}`,
  ].join('\n');
}

function renderOpsDetailPanel(model, ctx, box) {
  const { width, height } = box;
  const doctor = model.doctorStatus === 'ready' && model.doctorReport
    ? (typeof model.doctorReport === 'string' ? model.doctorReport : renderHealthDashboard(model.doctorReport, ctx))
    : `Doctor status: ${model.doctorStatus}\nPress x to run a sweep.`;
  const feed = renderOperationFeed(model.operationFeed, ctx);
  return panel({
    title: 'Operations Deck',
    body: `${doctor}\n\n${themeText(ctx, 'Operation Feed', { tone: 'accent', bold: true })}\n${feed}`,
    width,
    height,
    ctx,
  });
}

function renderOverlays(model, deps, options) {
  if (model.settingsOpen) {
    blitOverlay(options.screen, renderSettingsDrawer(model, deps, options));
  }
  if (model.palette) {
    const width = Math.min(84, Math.max(24, options.width - 6));
    const palette = panel({
      title: 'Command Palette',
      body: commandPaletteSurface(model.palette, { width: width - 2, ctx: deps.ctx, showScrollbar: true }),
      width,
      height: Math.min(14, options.height - 4),
      ctx: deps.ctx,
    });
    options.screen.blit(palette, centerX(options.width, palette.width), topThirdY(options.height, palette.height));
  }
  if (model.showHelp) {
    const help = renderHelpSurface(model, deps.ctx, { width: Math.min(HELP_WIDTH, options.width - 4), height: Math.min(20, options.height - 4) });
    options.screen.blit(help, centerX(options.width, help.width), topThirdY(options.height, help.height));
  }
  if (model.storeWizard) {
    const wizard = renderWizardSurface(model.storeWizard, { width: options.width, height: options.height, ctx: deps.ctx });
    options.screen.blit(wizard, centerX(options.width, wizard.width), topThirdY(options.height, wizard.height));
  }
  if (model.quitConfirm) {
    blitOverlay(options.screen, modal({
      title: 'Quit git-cas?',
      body: 'Leave the cockpit session now?',
      hint: 'Y / Enter confirm  |  N / Esc cancel',
      width: Math.min(52, options.width - 4),
      screenWidth: options.width,
      screenHeight: options.height,
      borderToken: deps.ctx.theme.theme.border.warning,
      bgToken: deps.ctx.theme.theme.surface.overlay,
      ctx: deps.ctx,
    }));
  }
  for (const overlay of renderNotificationStack(model.notifications, {
    screenWidth: options.width,
    screenHeight: options.height,
    ctx: deps.ctx,
    margin: 1,
    gap: 1,
  })) {
    blitOverlay(options.screen, overlay);
  }
}

function vaultStatus(model) {
  if (model.metadata?.encryption && model.vaultEncryptionKey) { return 'encrypted / unlocked'; }
  if (model.metadata?.encryption) { return 'encrypted / locked'; }
  return 'plaintext vault';
}

function renderSettingsDrawer(model, deps, options) {
  const { ctx } = deps;
  const body = [
    themeText(ctx, 'Cockpit Settings', { tone: 'brand', bold: true }),
    '',
    `${themeText(ctx, 'theme', { tone: 'accent' })}        bright cockpit`,
    `${themeText(ctx, 'workspace', { tone: 'accent' })}    ${model.workspace}`,
    `${themeText(ctx, 'focus', { tone: 'accent' })}        ${model.focusPane ?? '-'}`,
    `${themeText(ctx, 'source', { tone: 'accent' })}       ${sourceLabel(model.source)}`,
    `${themeText(ctx, 'vault', { tone: 'accent' })}        ${vaultStatus(model)}`,
    `${themeText(ctx, 'short SHA', { tone: 'accent' })}   selected chunk expands in footer`,
    '',
    themeText(ctx, 'F2 closes this drawer.', { tone: 'subdued' }),
  ].join('\n');
  return drawer({
    content: body,
    anchor: 'right',
    width: Math.min(46, Math.max(28, options.width - 4)),
    screenWidth: options.width,
    screenHeight: options.height,
    title: 'Settings',
    borderToken: ctx.theme.theme.border.primary,
    bgToken: ctx.theme.theme.surface.overlay,
    ctx,
  });
}

function renderHelpSurface(model, ctx, box) {
  const lines = [
    themeText(ctx, 'Frame', { tone: 'accent', bold: true }),
    '1/e Explorer     2/a Atlas       3/o Operations',
    '? Help           F2 Settings     q Quit',
    'Esc Close overlay',
    '',
    themeText(ctx, 'Explorer', { tone: 'accent', bold: true }),
    'Tab focus        / Filter        Ctrl+P Search digest',
    'j/k rows/chunks  u/d page        Enter detail',
    'm Merkle lens    i Inspector mode',
    '',
    themeText(ctx, 'Atlas', { tone: 'accent', bold: true }),
    'j/k focus        + Drill in      - Drill out',
    't Scope          i Path mode     r Reload',
    '',
    themeText(ctx, 'Operations', { tone: 'accent', bold: true }),
    'n Store wizard   s Stats         x Doctor',
    '',
    `Active workspace: ${model.workspace}`,
  ];
  return panel({ title: 'Help', body: lines.join('\n'), width: box.width, height: box.height, ctx });
}

function blitOverlay(screen, overlay) {
  const surface = overlay.surface ?? textSurface(overlay.content, Math.max(1, overlay.content.split('\n').reduce((max, line) => Math.max(max, line.length), 0)), overlay.content.split('\n').length);
  screen.blit(surface, overlay.col, overlay.row);
}

function centerX(containerWidth, overlayWidth) {
  return Math.max(0, Math.floor((containerWidth - overlayWidth) / 2));
}

function topThirdY(containerHeight, overlayHeight) {
  return Math.max(0, Math.floor((containerHeight - overlayHeight) / 3));
}
