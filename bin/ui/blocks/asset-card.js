/**
 * AssetCard block — structured component for asset metadata display.
 *
 * Takes manifest data and returns a formatted string with badges,
 * key metadata, and consistent layout. Reusable across the dashboard
 * detail pane, CLI inspect, and CLI vault info.
 */

import { badge, surfaceToString } from '@flyingrobots/bijou';
import { hstackSurface } from '@flyingrobots/bijou-tui';
import { themeText } from '../theme.js';

/**
 * @typedef {import('../../../src/domain/value-objects/Manifest.js').ManifestData} ManifestData
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 */

/**
 * Format bytes as human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

/**
 * Build status badges for an asset.
 *
 * @param {ManifestData} manifest
 * @param {BijouContext} ctx
 * @returns {import('@flyingrobots/bijou').Surface[]}
 */
export function buildAssetBadges(manifest, ctx) {
  const badges = [];
  if (Number.isFinite(manifest.version)) {
    badges.push(badge(`v${manifest.version}`, { variant: 'brand', ctx }));
  }
  if (manifest.encryption) {
    badges.push(badge('encrypted', { variant: 'warning', ctx }));
  }
  if (manifest.compression) {
    badges.push(badge(manifest.compression.algorithm, { variant: 'info', ctx }));
  }
  if (manifest.subManifests?.length) {
    badges.push(badge('merkle', { variant: 'accent', ctx }));
  }
  return badges;
}

/**
 * Render the badge row as a string.
 *
 * @param {ManifestData} manifest
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderBadgeRow(manifest, ctx) {
  const badges = buildAssetBadges(manifest, ctx);
  if (badges.length === 0) {
    return '';
  }
  return surfaceToString(hstackSurface(1, ...badges), ctx.style);
}

/**
 * Build a compact asset summary (slug, size, chunk count, crypto status).
 *
 * @param {ManifestData} manifest
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderAssetSummary(manifest, ctx) {
  const crypto = manifest.encryption ? 'encrypted' : 'plaintext';
  const compression = manifest.compression?.algorithm ?? 'none';
  const chunks = manifest.chunks?.length ?? 0;
  const subs = manifest.subManifests?.length ?? 0;
  const lines = [
    `${themeText(ctx, 'slug', { tone: 'accent' })}      ${manifest.slug}`,
    `${themeText(ctx, 'size', { tone: 'accent' })}      ${formatBytes(manifest.size)}`,
    `${themeText(ctx, 'chunks', { tone: 'accent' })}    ${chunks}${subs > 0 ? ` (${subs} sub-manifests)` : ''}`,
    `${themeText(ctx, 'crypto', { tone: 'accent' })}    ${crypto}`,
    `${themeText(ctx, 'compress', { tone: 'accent' })}  ${compression}`,
  ];
  return lines.join('\n');
}

/**
 * Render a full asset card: badges + summary.
 *
 * @param {ManifestData} manifest
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderAssetCard(manifest, ctx) {
  const badgeRow = renderBadgeRow(manifest, ctx);
  const summary = renderAssetSummary(manifest, ctx);
  return badgeRow ? `${badgeRow}\n\n${summary}` : summary;
}
