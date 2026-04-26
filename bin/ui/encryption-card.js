/**
 * Encryption info card — visual summary of vault crypto configuration.
 */

import { badge, surfaceToString } from '@flyingrobots/bijou';
import { hstackSurface } from '@flyingrobots/bijou-tui';
import { getCliContext } from './context.js';
import { inlineSurface, sectionHeading, themeText } from './theme.js';

/**
 * Build key-value rows for the encryption profile.
 *
 * @param {{ cipher: string, kdf: any }} encryption
 * @returns {[string, string][]}
 */
function buildKdfRows(encryption) {
  const { kdf } = encryption;
  /** @type {[string, string][]} */
  const rows = [
    ['cipher', encryption.cipher],
    ['kdf', kdf.algorithm],
  ];
  if (kdf.algorithm === 'pbkdf2') {
    rows.push(['iterations', /** @type {number} */ (kdf.iterations).toLocaleString()]);
  } else if (kdf.algorithm === 'scrypt') {
    rows.push(['cost', String(kdf.cost)]);
    rows.push(['blockSize', String(kdf.blockSize)]);
    rows.push(['parallel', String(kdf.parallelization)]);
  }
  rows.push(['key length', `${kdf.keyLength} bytes`]);
  rows.push(['salt', `${kdf.salt.slice(0, 12)}...`]);
  return rows;
}

/**
 * Format key-value rows with aligned columns.
 *
 * @param {[string, string][]} rows
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @returns {string}
 */
function formatKvRows(rows, ctx) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => {
    const label = themeText(ctx, k.padEnd(maxKey), { tone: 'accent' });
    return `  ${label}  ${v}`;
  }).join('\n');
}

/**
 * Render an encryption info card for the vault.
 *
 * @param {Object} options
 * @param {import('../../index.js').VaultMetadata | null} options.metadata
 * @param {boolean} [options.unlocked]
 * @returns {string}
 */
export function renderEncryptionCard({ metadata, unlocked = false }) {
  const ctx = getCliContext();

  if (!metadata?.encryption) {
    return 'No encryption configured';
  }

  const rows = buildKdfRows(metadata.encryption);
  const kvBody = formatKvRows(rows, ctx);
  const statusBadge = badge(unlocked ? 'unlocked' : 'locked', {
    variant: unlocked ? 'success' : 'danger',
    ctx,
  });
  const statusRow = hstackSurface(1,
    inlineSurface(ctx, 'status', { tone: 'accent' }),
    statusBadge,
  );

  return [
    themeText(ctx, 'Vault Envelope', { tone: 'brand' }),
    themeText(ctx, 'Cipher, KDF shape, and unlock posture.', { tone: 'subdued' }),
    sectionHeading(ctx, 'Encryption Profile', 'warning'),
    kvBody,
    surfaceToString(statusRow, ctx.style),
  ].join('\n');
}
