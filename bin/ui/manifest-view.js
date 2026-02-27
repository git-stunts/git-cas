/**
 * Manifest anatomy view — rich visual breakdown of a manifest.
 */

import { box, badge, table, tree, headerBox } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';

/**
 * Format bytes as human-readable string.
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
 */
function renderBadges(m, ctx) {
  const badges = [badge(`v${m.version}`, { ctx })];
  if (m.encryption) {
    badges.push(badge('encrypted', { variant: 'warning', ctx }));
  }
  if (m.compression) {
    badges.push(badge(m.compression.algorithm, { variant: 'info', ctx }));
  }
  if (m.subManifests?.length) {
    badges.push(badge('merkle', { variant: 'info', ctx }));
  }
  return badges.join(' ');
}

/**
 * Build the encryption section.
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
 */
function renderChunksSection(chunks, ctx) {
  const displayChunks = chunks.slice(0, 20);
  const chunkRows = displayChunks.map(c => [
    String(c.index),
    formatBytes(c.size),
    `${c.digest.slice(0, 12)}...`,
    `${c.blob.slice(0, 12)}...`,
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
 */
function renderSubManifestsSection(m, ctx) {
  const nodes = m.subManifests.map((sm, i) => ({
    label: `sub-${i}  ${sm.chunkCount} chunks  start: ${sm.startIndex}  oid: ${sm.oid.slice(0, 8)}...`,
  }));
  return `${headerBox(`Sub-manifests (${m.subManifests.length})`, { ctx })}\n${tree(nodes, { ctx })}`;
}

/**
 * Render a full manifest anatomy view.
 *
 * @param {Object} options
 * @param {Object} options.manifest - The manifest (from readManifest).
 * @param {Object} [options.ctx] - Optional bijou context override.
 * @returns {string}
 */
export function renderManifestView({ manifest, ctx = getCliContext() }) {
  const m = manifest.toJSON ? manifest.toJSON() : manifest;
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
