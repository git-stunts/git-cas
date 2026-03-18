/**
 * Manifest anatomy view — rich visual breakdown of a manifest.
 */

import { box, badge, table, tree, headerBox, surfaceToString } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';

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
  const renderBadge = (label, options = {}) => surfaceToString(badge(label, { ...options, ctx }), ctx.style);
  const badges = [renderBadge(`v${m.version}`)];
  if (m.encryption) {
    badges.push(renderBadge('encrypted', { variant: 'warning' }));
  }
  if (m.compression) {
    badges.push(renderBadge(m.compression.algorithm, { variant: 'info' }));
  }
  if (m.subManifests?.length) {
    badges.push(renderBadge('merkle', { variant: 'info' }));
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
  return `${headerBox('Encryption', { ctx })}\n${box(rows.join('\n'), { ctx })}`;
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
  return `${headerBox(`Chunks (${chunks.length})`, { ctx })}\n${chunkTable}${suffix}`;
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
    `  slug      ${m.slug}`,
    `  filename  ${m.filename}`,
    `  size      ${formatBytes(m.size)}`,
    `  chunks    ${m.chunks?.length ?? 0}`,
  ];
  return `${headerBox('Metadata', { ctx })}\n${box(meta.join('\n'), { ctx })}`;
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
  return `${headerBox(`Sub-manifests (${subs.length})`, { ctx })}\n${tree(nodes, { ctx })}`;
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
  const sections = [renderBadges(m, ctx), renderMetadataSection(m, ctx)];

  if (m.encryption) {
    sections.push(renderEncryptionSection(m.encryption, ctx));
  }
  if (m.compression) {
    sections.push(`${headerBox('Compression', { ctx })}\n${box(`  algorithm  ${m.compression.algorithm}`, { ctx })}`);
  }
  if (m.subManifests?.length) {
    sections.push(renderSubManifestsSection(m, ctx));
  }
  if (m.chunks?.length) {
    sections.push(renderChunksSection(m.chunks, ctx));
  }

  return `${sections.join('\n\n')}\n`;
}
