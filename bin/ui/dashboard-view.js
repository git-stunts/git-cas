/**
 * Pure render functions for the vault dashboard.
 */

import { badge } from '@flyingrobots/bijou';
import { flex, viewport } from '@flyingrobots/bijou-tui';
import { renderManifestView } from './manifest-view.js';

/**
 * Format bytes as compact string.
 */
function formatSize(bytes) {
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}K`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)}M`; }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`; }

/**
 * Format manifest stats for the list.
 */
function formatStats(manifest) {
  const m = manifest.toJSON ? manifest.toJSON() : manifest;
  return `${formatSize(m.size)}  ${m.chunks?.length ?? 0}c`;
}

/**
 * Render a single list item.
 */
function renderListItem(entry, index, model) {
  const prefix = index === model.cursor ? '> ' : '  ';
  const manifest = model.manifestCache.get(entry.slug);
  const stats = manifest ? formatStats(manifest) : '...';
  return `${prefix}${entry.slug}  ${stats}`;
}

/**
 * Compute visible window for cursor scrolling.
 */
function visibleRange(cursor, total, height) {
  const start = Math.max(0, Math.min(cursor - Math.floor(height / 2), total - height));
  return { start: Math.max(0, start), end: Math.min(Math.max(0, start) + height, total) };
}

/**
 * Render the header line.
 */
function renderHeader(model, ctx) {
  const parts = [];
  if (model.metadata?.encryption) {
    parts.push(badge('encrypted', { variant: 'warning', ctx }));
  }
  parts.push(`${model.entries.length} entries`);
  parts.push('refs/cas/vault');
  return parts.join('  ');
}

/**
 * Render the list pane.
 */
function renderListPane(model, size) {
  const filterLine = model.filtering ? `/${model.filterText}\u2588` : '';
  const listHeight = model.filtering ? size.height - 1 : size.height;
  const items = model.filtered;

  if (items.length === 0) {
    const msg = model.status === 'loading' ? 'Loading...' : 'No entries';
    return padToHeight(msg, listHeight, filterLine);
  }

  const { start, end } = visibleRange(model.cursor, items.length, listHeight);
  const lines = [];
  for (let i = start; i < end; i++) {
    lines.push(renderListItem(items[i], i, model));
  }
  return padToHeight(lines.join('\n'), listHeight, filterLine);
}

/**
 * Pad content to target height, optionally appending a suffix line.
 */
function padToHeight(content, height, suffix) {
  const lines = content.split('\n');
  while (lines.length < height) { lines.push(''); }
  return suffix ? `${lines.join('\n')}\n${suffix}` : lines.join('\n');
}

/**
 * Render the detail pane with viewport scrolling.
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
 */
function renderBody(model, deps, size) {
  const listBasis = Math.floor(size.width * 0.35);
  return flex(
    { direction: 'row', width: size.width, height: size.height, gap: 1 },
    { content: (_w, h) => renderListPane(model, { height: h }), basis: listBasis },
    { content: (w, h) => renderDetailPane(model, { width: w, height: h, ctx: deps.ctx }), flex: 1 },
  );
}

/**
 * Render the full dashboard layout.
 */
export function renderDashboard(model, deps) {
  return flex(
    { direction: 'column', width: model.columns, height: model.rows },
    { content: renderHeader(model, deps.ctx), basis: 1 },
    { content: (w, _h) => '\u2500'.repeat(w), basis: 1 },
    { content: (w, h) => renderBody(model, deps, { width: w, height: h }), flex: 1 },
    { content: (w, _h) => '\u2500'.repeat(w), basis: 1 },
    { content: 'j/k Navigate  enter Load  / Filter  J/K Scroll  q Quit', basis: 1 },
  );
}
