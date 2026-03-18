/**
 * Pure render functions for the vault dashboard.
 */

import { badge, surfaceToString } from '@flyingrobots/bijou';
import { flex, viewport } from '@flyingrobots/bijou-tui';
import { renderManifestView } from './manifest-view.js';

/**
 * @typedef {import('./dashboard.js').DashModel} DashModel
 * @typedef {import('./dashboard.js').DashDeps} DashDeps
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
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
 * Render a single list item.
 *
 * @param {{ slug: string, treeOid: string }} entry
 * @param {number} index
 * @param {{ model: DashModel, width?: number }} opts
 * @returns {string}
 */
function renderListItem(entry, index, opts) {
  const prefix = index === opts.model.cursor ? '> ' : '  ';
  const manifest = opts.model.manifestCache.get(entry.slug);
  const stats = manifest ? formatStats(manifest) : '...';
  const line = `${prefix}${entry.slug}  ${stats}`;
  return opts.width ? line.slice(0, opts.width) : line;
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
 * Render the header line.
 *
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderHeader(model, ctx) {
  const parts = [];
  if (model.metadata?.encryption) {
    parts.push(surfaceToString(badge('encrypted', { variant: 'warning', ctx }), ctx.style));
  }
  parts.push(`${model.entries.length} entries`);
  parts.push('refs/cas/vault');
  return parts.join('  ');
}

/**
 * Render the list pane.
 *
 * @param {DashModel} model
 * @param {{ height: number, width?: number }} size
 * @returns {string}
 */
function renderListPane(model, size) {
  const clamp = (/** @type {string} */ s) => (typeof size.width === 'number' && size.width > 0 ? s.slice(0, size.width) : s);
  const filterLine = model.filtering ? clamp(`/${model.filterText}\u2588`) : '';
  const listHeight = model.filtering ? size.height - 1 : size.height;
  const items = model.filtered;

  if (items.length === 0) {
    const msg = clamp(
      model.status === 'loading'
        ? 'Loading...'
        : model.error
          ? `Error: ${model.error}`
          : 'No entries',
    );
    return padToHeight(msg, listHeight, filterLine);
  }

  const { start, end } = visibleRange(model.cursor, items.length, listHeight);
  const lines = [];
  for (let i = start; i < end; i++) {
    lines.push(renderListItem(items[i], i, { model, width: size.width }));
  }
  return padToHeight(lines.join('\n'), listHeight, filterLine);
}

/**
 * Pad content to target height, optionally appending a suffix line.
 *
 * @param {string} content
 * @param {number} height
 * @param {string} suffix
 * @returns {string}
 */
function padToHeight(content, height, suffix) {
  const lines = content.split('\n');
  while (lines.length < height) { lines.push(''); }
  return suffix ? `${lines.join('\n')}\n${suffix}` : lines.join('\n');
}

/**
 * Render the detail pane with viewport scrolling.
 *
 * @param {DashModel} model
 * @param {{ width: number, height: number, ctx: BijouContext }} opts
 * @returns {string}
 */
function renderDetailPane(model, opts) {
  const entry = model.filtered[model.cursor];
  if (!entry) { return ''; }
  const manifest = model.manifestCache.get(entry.slug);
  if (!manifest) { return 'Loading manifest...'; }
  const content = renderManifestView({ manifest, ctx: opts.ctx });
  return viewport({ width: opts.width, height: opts.height, content, scrollY: model.detailScroll });
}

/**
 * Render the body with list and detail panes.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ width: number, height: number }} size
 * @returns {string}
 */
function renderBody(model, deps, size) {
  const listBasis = Math.floor(size.width * 0.35);
  return flex(
    { direction: 'row', width: size.width, height: size.height, gap: 1 },
    { content: (/** @type {number} */ w, /** @type {number} */ h) => renderListPane(model, { height: h, width: w }), basis: listBasis },
    { content: (/** @type {number} */ w, /** @type {number} */ h) => renderDetailPane(model, { width: w, height: h, ctx: deps.ctx }), flex: 1 },
  );
}

/**
 * Render the full dashboard layout.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {string}
 */
export function renderDashboard(model, deps) {
  return flex(
    { direction: 'column', width: model.columns, height: model.rows },
    { content: renderHeader(model, deps.ctx), basis: 1 },
    { content: (/** @type {number} */ w, /** @type {number} */ _h) => '\u2500'.repeat(w), basis: 1 },
    { content: (/** @type {number} */ w, /** @type {number} */ h) => renderBody(model, deps, { width: w, height: h }), flex: 1 },
    { content: (/** @type {number} */ w, /** @type {number} */ _h) => '\u2500'.repeat(w), basis: 1 },
    { content: 'j/k Navigate  enter Load  / Filter  J/K Scroll  q Quit', basis: 1 },
  );
}
