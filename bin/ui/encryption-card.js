/**
 * Encryption info card — visual summary of vault crypto configuration.
 */

import { badge, createSurface, parseAnsiToSurface } from '@flyingrobots/bijou';
import { hstackSurface, vstackSurface } from '@flyingrobots/bijou-tui';
import { getCliContext } from './context.js';
import { sectionHeading, themeText } from './theme.js';

function textSurface(text, width) {
  return parseAnsiToSurface(text, Math.max(1, width), 1);
}

function stripAnsiLength(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

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
 * Render an encryption info card for the vault.
 *
 * @param {Object} options
 * @param {import('../../index.js').VaultMetadata | null} options.metadata
 * @param {boolean} [options.unlocked]
 * @returns {import('@flyingrobots/bijou').Surface}
 */
export function renderEncryptionCard({ metadata, unlocked = false }) {
  const ctx = getCliContext();

  if (!metadata?.encryption) {
    return textSurface('No encryption configured', 26);
  }

  const rows = buildKdfRows(metadata.encryption);
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  
  const kvSurfaces = rows.map(([k, v]) => {
    const label = themeText(ctx, k.padEnd(maxKey), { tone: 'accent' });
    return hstackSurface(2,
      createSurface(2, 1),
      textSurface(label, stripAnsiLength(label)),
      textSurface(v, stripAnsiLength(v))
    );
  });

  const statusBadge = badge(unlocked ? 'unlocked' : 'locked', {
    variant: unlocked ? 'success' : 'danger',
    ctx,
  });
  
  const statusLabel = themeText(ctx, 'status'.padEnd(maxKey), { tone: 'accent' });
  const statusRow = hstackSurface(2,
    createSurface(2, 1),
    textSurface(statusLabel, stripAnsiLength(statusLabel)),
    statusBadge,
  );

  const headingText = sectionHeading(ctx, 'Encryption Profile', 'warning');

  return vstackSurface(
    textSurface(themeText(ctx, 'Vault Envelope', { tone: 'brand' }), 14),
    textSurface(themeText(ctx, 'Cipher, KDF shape, and unlock posture.', { tone: 'subdued' }), 38),
    textSurface(headingText, stripAnsiLength(headingText)),
    ...kvSurfaces,
    statusRow
  );
}
