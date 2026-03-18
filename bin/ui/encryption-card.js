/**
 * Encryption info card — visual summary of vault crypto configuration.
 */

import { box, badge, headerBox, surfaceToString } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';

/**
 * Render an encryption info card for the vault.
 *
 * @param {Object} options
 * @param {import('../../index.js').VaultMetadata | null} options.metadata - Vault metadata (from getVaultMetadata()).
 * @param {boolean} [options.unlocked] - Whether a key/passphrase was provided.
 * @returns {string}
 */
export function renderEncryptionCard({ metadata, unlocked = false }) {
  const ctx = getCliContext();

  if (!metadata?.encryption) {
    return box('No encryption configured', { ctx });
  }

  const { encryption } = metadata;
  const { kdf } = encryption;

  const status = unlocked
    ? surfaceToString(badge('unlocked', { variant: 'success', ctx }), ctx.style)
    : surfaceToString(badge('locked', { variant: 'error', ctx }), ctx.style);

  const rows = [
    `  cipher      ${encryption.cipher}`,
    `  kdf         ${kdf.algorithm}`,
  ];

  if (kdf.algorithm === 'pbkdf2') {
    rows.push(`  iterations  ${/** @type {number} */ (kdf.iterations).toLocaleString()}`);
  } else if (kdf.algorithm === 'scrypt') {
    rows.push(`  cost        ${kdf.cost}`);
    rows.push(`  blockSize   ${kdf.blockSize}`);
    rows.push(`  parallel    ${kdf.parallelization}`);
  }

  rows.push(`  key length  ${kdf.keyLength} bytes`);
  rows.push(`  salt        ${kdf.salt.slice(0, 12)}...`);
  rows.push(`  status      ${status}`);

  const content = rows.join('\n');
  return `${headerBox('Encryption', { ctx })}\n${box(content, { ctx })}`;
}
