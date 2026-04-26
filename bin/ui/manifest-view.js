/**
 * Manifest anatomy view — rich visual breakdown of a manifest.
 */

import { box } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';
import { renderBadgeRow } from './blocks/asset-card.js';
import { renderChunkTable, renderSubManifestTree } from './blocks/merkle-explorer.js';
import { sectionHeading, themeText } from './theme.js';

/**
 * @typedef {import('../../src/domain/value-objects/Manifest.js').ManifestData} ManifestData
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou').AccordionSection} AccordionSection
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
 * Format key-value pairs with aligned themed labels.
 *
 * @param {[string, string][]} rows
 * @param {BijouContext} ctx
 * @returns {string}
 */
function formatKv(rows, ctx) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `  ${themeText(ctx, k.padEnd(maxKey), { tone: 'accent' })}  ${v}`).join('\n');
}

// Badge rendering delegated to blocks/asset-card.js (renderBadgeRow)

/**
 * Build the encryption section body.
 *
 * @param {NonNullable<ManifestData['encryption']>} enc
 * @param {BijouContext} ctx
 * @returns {string}
 */
function encryptionBody(enc, ctx) {
  /** @type {[string, string][]} */
  const rows = [['algorithm', enc.algorithm]];
  if (enc.kdf) {
    rows.push(['kdf', enc.kdf.algorithm]);
    if (enc.kdf.iterations) {
      rows.push(['iterations', enc.kdf.iterations.toLocaleString()]);
    }
    if (enc.kdf.cost) {
      rows.push(['cost', String(enc.kdf.cost)]);
    }
  }
  if (enc.nonce) {
    rows.push(['nonce', `${enc.nonce.slice(0, 16)}...`]);
  }
  if (enc.tag) {
    rows.push(['tag', `${enc.tag.slice(0, 16)}...`]);
  }
  return box(formatKv(rows, ctx), { ctx });
}

/**
 * Build the encryption section (headed).
 *
 * @param {NonNullable<ManifestData['encryption']>} enc
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderEncryptionSection(enc, ctx) {
  return `${sectionHeading(ctx, 'Encryption Profile', 'warning')}\n${encryptionBody(enc, ctx)}`;
}

/**
 * Build the chunks section body.
 *
 * @param {ManifestData['chunks']} chunks
 * @param {BijouContext} ctx
 * @returns {string}
 */
/**
 * Build the chunks section (headed). Delegates to MerkleExplorer block.
 *
 * @param {ManifestData} m
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderChunksSection(m, ctx) {
  const chunks = m.chunks || [];
  return `${sectionHeading(ctx, `Chunk Ledger (${chunks.length})`, 'info')}\n${renderChunkTable(m, ctx)}`;
}

/**
 * Build the metadata section body.
 *
 * @param {ManifestData} m
 * @param {BijouContext} ctx
 * @returns {string}
 */
function metadataBody(m, ctx) {
  const rows = [
    ['slug', m.slug ?? '-'],
    ['filename', m.filename ?? '-'],
    ['size', formatBytes(m.size)],
    ['chunks', String(m.chunks?.length ?? 0)],
  ];
  return box(formatKv(rows, ctx), { ctx });
}

/**
 * Build the metadata section (headed).
 *
 * @param {ManifestData} m
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderMetadataSection(m, ctx) {
  return `${sectionHeading(ctx, 'Asset Metadata', 'brand')}\n${metadataBody(m, ctx)}`;
}

/**
 * Build the sub-manifests section body.
 *
 * @param {ManifestData} m
 * @param {BijouContext} ctx
 * @returns {string}
 */
/**
 * Build the sub-manifests section (headed). Delegates to MerkleExplorer block.
 *
 * @param {ManifestData} m
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderSubManifestsSection(m, ctx) {
  const subs = m.subManifests || [];
  return `${sectionHeading(ctx, `Merkle Branches (${subs.length})`, 'accent')}\n${renderSubManifestTree(m, ctx)}`;
}

/**
 * Render a full manifest anatomy view.
 *
 * @param {Object} options
 * @param {ManifestData} options.manifest - Pre-normalized manifest data.
 * @param {BijouContext} [options.ctx] - Optional bijou context override.
 * @returns {string}
 */
export function renderManifestView({ manifest, ctx = getCliContext() }) {
  const m = manifest;
  const badges = renderBadgeRow(m, ctx);
  const sections = [themeText(ctx, 'Manifest Ledger', { tone: 'brand' })];
  if (badges) {
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
    sections.push(renderChunksSection(m, ctx));
  }

  return `${sections.join('\n\n')}\n`;
}

/**
 * Build structured accordion sections from manifest data.
 *
 * Each section has a title and content string. Metadata is expanded by
 * default; all other sections are collapsed. Only sections relevant to the
 * manifest are included (e.g. no encryption section for plaintext assets).
 *
 * @param {Object} options
 * @param {ManifestData} options.manifest - Pre-normalized manifest data.
 * @param {BijouContext} [options.ctx] - Optional bijou context override.
 * @returns {AccordionSection[]}
 */
export function buildManifestSections({ manifest, ctx = getCliContext() }) {
  const m = manifest;
  /** @type {AccordionSection[]} */
  const sections = [
    { title: 'Asset Metadata', content: metadataBody(m, ctx), expanded: true },
  ];
  if (m.encryption) {
    sections.push({ title: 'Encryption Profile', content: encryptionBody(m.encryption, ctx) });
  }
  if (m.compression) {
    sections.push({ title: 'Compression Profile', content: box(`  algorithm  ${m.compression.algorithm}`, { ctx }) });
  }
  if (m.subManifests?.length) {
    sections.push({ title: `Merkle Branches (${m.subManifests.length})`, content: renderSubManifestTree(m, ctx) });
  }
  if (m.chunks?.length) {
    sections.push({ title: `Chunk Ledger (${m.chunks.length})`, content: renderChunkTable(m, ctx) });
  }
  return sections;
}
