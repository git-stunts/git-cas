/**
 * Manifest anatomy view — rich visual breakdown of a manifest.
 */

import { box, table, tree } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';
import { chipText, sectionHeading, themeText } from './theme.js';

/**
 * @typedef {import('../../src/domain/value-objects/Manifest.js').ManifestData} ManifestData
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
 * Build the header badges line.
 *
 * @param {ManifestData} m
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderBadges(m, ctx) {
  const renderBadge = (label, tone = 'neutral') => chipText(ctx, label, tone);
  const badges = [];
  if (Number.isFinite(m.version)) {
    badges.push(renderBadge(`v${m.version}`, 'brand'));
  }
  if (m.encryption) {
    badges.push(renderBadge('encrypted', 'warning'));
  }
  if (m.compression) {
    badges.push(renderBadge(m.compression.algorithm, 'info'));
  }
  if (m.subManifests?.length) {
    badges.push(renderBadge('merkle', 'accent'));
  }
  return badges.join(' ');
}

/**
 * Build the encryption section.
 *
 * @param {NonNullable<ManifestData['encryption']>} enc
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderEncryptionSection(enc, ctx) {
  const rows = [`  algorithm  ${enc.algorithm}`];
  if (enc.kdf) {
    rows.push(`  kdf        ${enc.kdf.algorithm}`);
    if (enc.kdf.iterations) {
      rows.push(`  iterations ${enc.kdf.iterations.toLocaleString()}`);
    }
    if (enc.kdf.cost) {
      rows.push(`  cost       ${enc.kdf.cost}`);
    }
  }
  if (enc.nonce) {
    rows.push(`  nonce      ${enc.nonce.slice(0, 16)}...`);
  }
  if (enc.tag) {
    rows.push(`  tag        ${enc.tag.slice(0, 16)}...`);
  }
  return `${sectionHeading(ctx, 'Encryption Profile', 'warning')}\n${box(rows.join('\n'), { ctx })}`;
}

/**
 * Build the chunks section.
 *
 * @param {ManifestData['chunks']} chunks
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderChunksSection(chunks, ctx) {
  const displayChunks = chunks.slice(0, 20);
  const chunkRows = displayChunks.map((/** @type {{ index: number, size: number, digest: string, blob?: string }} */ c) => [
    String(c.index),
    formatBytes(c.size),
    typeof c.digest === 'string' ? `${c.digest.slice(0, 12)}...` : '-',
    typeof c.blob === 'string' ? `${c.blob.slice(0, 12)}...` : '-',
  ]);
  const chunkTable = table({
    columns: [{ header: '#' }, { header: 'Size' }, { header: 'Digest' }, { header: 'Blob' }],
    rows: chunkRows,
    ctx,
  });
  const suffix = chunks.length > 20
    ? `\n  ...and ${chunks.length - 20} more`
    : '';
  return `${sectionHeading(ctx, `Chunk Ledger (${chunks.length})`, 'info')}\n${chunkTable}${suffix}`;
}

/**
 * Build the metadata section.
 *
 * @param {ManifestData} m
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderMetadataSection(m, ctx) {
  const meta = [
    `  slug      ${m.slug ?? '-'}`,
    `  filename  ${m.filename ?? '-'}`,
    `  size      ${formatBytes(m.size)}`,
    `  chunks    ${m.chunks?.length ?? 0}`,
  ];
  return `${sectionHeading(ctx, 'Asset Metadata', 'brand')}\n${box(meta.join('\n'), { ctx })}`;
}

/**
 * Build the sub-manifests section.
 *
 * @param {ManifestData} m
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderSubManifestsSection(m, ctx) {
  const subs = m.subManifests || [];
  const nodes = subs.map((/** @type {import('../../src/domain/value-objects/Manifest.js').SubManifestRef} */ sm, /** @type {number} */ i) => ({
    label: `sub-${i}  ${sm.chunkCount} chunks  start: ${sm.startIndex}  oid: ${sm.oid.slice(0, 8)}...`,
  }));
  return `${sectionHeading(ctx, `Merkle Branches (${subs.length})`, 'accent')}\n${tree(nodes, { ctx })}`;
}

/**
 * Render a full manifest anatomy view.
 *
 * @param {Object} options
 * @param {ManifestData | { toJSON(): ManifestData }} options.manifest - The manifest (Manifest instance or plain ManifestData).
 * @param {BijouContext} [options.ctx] - Optional bijou context override.
 * @returns {string}
 */
export function renderManifestView({ manifest, ctx = getCliContext() }) {
  const m = /** @type {ManifestData} */ ('toJSON' in manifest ? manifest.toJSON() : manifest);
  const badges = renderBadges(m, ctx);
  const sections = [themeText(ctx, 'Manifest Ledger', { tone: 'brand' })];
  if (badges.length > 0) {
    sections.push(badges);
  }
  sections.push(renderMetadataSection(m, ctx));

  if (m.encryption) {
    sections.push(renderEncryptionSection(m.encryption, ctx));
  }
  if (m.compression) {
    sections.push(`${sectionHeading(ctx, 'Compression Profile', 'info')}\n${box(`  algorithm  ${m.compression.algorithm}`, { ctx })}`);
  }
  if (m.subManifests?.length) {
    sections.push(renderSubManifestsSection(m, ctx));
  }
  if (m.chunks?.length) {
    sections.push(renderChunksSection(m.chunks, ctx));
  }

  return `${sections.join('\n\n')}\n`;
}
