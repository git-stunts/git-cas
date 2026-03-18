/**
 * Pure render functions for the vault dashboard.
 */

import { badge, boxV3, createSurface, parseAnsiToSurface, kbd } from '@flyingrobots/bijou';
import { renderManifestView } from './manifest-view.js';

/**
 * @typedef {import('./dashboard.js').DashModel} DashModel
 * @typedef {import('./dashboard.js').DashDeps} DashDeps
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou').Surface} Surface
 * @typedef {import('../../src/domain/value-objects/Manifest.js').default} Manifest
 */

/**
 * Format bytes as compact string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}K`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)}M`; }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/**
 * Format manifest stats for the list.
 *
 * @param {Manifest} manifest
 * @returns {string}
 */
function formatStats(manifest) {
  const m = manifest.toJSON ? manifest.toJSON() : manifest;
  return `${formatSize(m.size)}  ${m.chunks?.length ?? 0}c`;
}

/**
 * Safely clip text to a pane width.
 *
 * @returns {string}
 */
function clip(text, width) {
  return width > 0 ? text.slice(0, width) : '';
}

/**
 * Compute visible window for cursor scrolling.
 *
 * @param {number} cursor
 * @param {number} total
 * @param {number} height
 * @returns {{ start: number, end: number }}
 */
function visibleRange(cursor, total, height) {
  const start = Math.max(0, Math.min(cursor - Math.floor(height / 2), total - height));
  return { start: Math.max(0, start), end: Math.min(Math.max(0, start) + height, total) };
}

/**
 * Convert text to a fixed-size surface.
 *
 * @param {string} text
 * @param {number} width
 * @param {number} height
 * @returns {Surface}
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
 * Render the header surface.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {Surface}
 */
function renderHeaderSurface(model, ctx) {
  const surface = createSurface(Math.max(1, model.columns), 3);
  surface.blit(textSurface('git-cas vault explorer', surface.width, 1), 0, 0);

  const parts = [
    badge(`${model.filtered.length}/${model.entries.length || model.filtered.length} visible`, { variant: 'info', ctx }),
  ];
  if (model.metadata?.encryption) {
    parts.push(badge('encrypted', { variant: 'warning', ctx }));
  }
  if (model.filtering || model.filterText) {
    parts.push(badge(model.filtering ? 'filtering' : `filter ${model.filterText}`, { variant: 'accent', ctx }));
  }
  const selected = model.filtered[model.cursor];
  if (selected) {
    parts.push(badge(`selected ${selected.slug}`, { variant: 'primary', ctx }));
  }
  blitInline(surface, {
    x: 0,
    y: 1,
    parts: ['refs/cas/vault', ...parts],
    maxWidth: surface.width,
  });
  surface.blit(textSurface('─'.repeat(surface.width), surface.width, 1), 0, 2);
  return surface;
}

/**
 * Format list rows for the explorer pane.
 *
 * @param {{ slug: string, treeOid: string }} entry
 * @param {number} index
 * @param {DashModel} model
 * @returns {string}
 */
function renderListItem(entry, index, model) {
  const manifest = model.manifestCache.get(entry.slug);
  const m = manifest && (manifest.toJSON ? manifest.toJSON() : manifest);
  const prefix = index === model.cursor ? '>' : ' ';
  const status = manifest
    ? [
      m.encryption ? 'enc' : 'clr',
      m.compression ? m.compression.algorithm : 'raw',
      m.subManifests?.length ? 'merkle' : 'single',
    ].join(' ')
    : 'loading';
  return `${prefix} ${entry.slug}  ${manifest ? formatStats(manifest) : '...'}  ${status}`;
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
  const infoLine = model.filtering ? `filter /${model.filterText}\u2588` : model.filterText ? `filter ${model.filterText}` : 'filter all';
  const lines = [clip(infoLine, innerWidth), ''];
  const visibleHeight = Math.max(0, innerHeight - lines.length);

  if (model.filtered.length === 0) {
    lines.push(model.status === 'loading' ? 'Loading...' : model.error ? `Error: ${model.error}` : 'No entries');
  } else {
    const { start, end } = visibleRange(model.cursor, model.filtered.length, Math.max(1, visibleHeight));
    for (let i = start; i < end; i++) {
      lines.push(clip(renderListItem(model.filtered[i], i, model), innerWidth));
    }
  }

  return boxV3(textSurface(lines.join('\n'), innerWidth, innerHeight), {
    ctx: opts.ctx,
    title: 'Entries',
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
  const entry = model.filtered[model.cursor];

  if (!entry) {
    content.blit(textSurface('Select an entry to inspect it.', innerWidth, innerHeight), 0, 0);
    return boxV3(content, { ctx: opts.ctx, title: 'Inspector', width: opts.width });
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
    return boxV3(content, { ctx: opts.ctx, title: 'Inspector', width: opts.width });
  }

  const manifestBody = renderManifestView({ manifest, ctx: opts.ctx });
  const manifestLines = Math.max(1, manifestBody.split('\n').length);
  const manifestSurface = parseAnsiToSurface(manifestBody, innerWidth, manifestLines);
  const bodyTop = 3;
  const bodyHeight = Math.max(1, innerHeight - bodyTop);
  content.blit(manifestSurface, 0, bodyTop, 0, model.detailScroll, innerWidth, bodyHeight);

  return boxV3(content, { ctx: opts.ctx, title: 'Inspector', width: opts.width });
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
    `${kbd('j/k', { ctx })} move  ${kbd('enter', { ctx })} inspect  ${kbd('/', { ctx })} filter  ${kbd('J/K', { ctx })} scroll  ${kbd('q', { ctx })} quit`,
  ];
  return textSurface(lines.join('\n'), width, 2);
}

/**
 * Render the body with a split explorer layout.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ top: number, height: number, screen: Surface }} options
 */
function renderBody(model, deps, options) {
  const gap = model.columns >= 72 ? 1 : 0;
  const listWidth = Math.max(24, Math.min(Math.floor(model.columns * 0.37), model.columns - 28 - gap));
  const detailWidth = Math.max(24, model.columns - listWidth - gap);
  const listPane = renderListPane(model, { width: listWidth, height: options.height, ctx: deps.ctx });
  const detailPane = renderDetailPane(model, { width: detailWidth, height: options.height, ctx: deps.ctx });
  options.screen.blit(listPane, 0, options.top);
  options.screen.blit(detailPane, listWidth + gap, options.top);
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
  const header = renderHeaderSurface(model, deps.ctx);
  const footer = renderFooterSurface(deps.ctx, width);
  const bodyTop = header.height;
  const bodyHeight = Math.max(1, height - header.height - footer.height);

  screen.blit(header, 0, 0);
  renderBody(model, deps, { top: bodyTop, height: bodyHeight, screen });
  screen.blit(footer, 0, Math.max(0, height - footer.height));

  return screen;
}
