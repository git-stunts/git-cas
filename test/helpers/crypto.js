import { createHash } from 'node:crypto';

/**
 * Generate a deterministic SHA-256 hex digest from a seed string.
 * @param {string} seed
 * @returns {string} 64-char hex digest
 */
export function digestOf(seed) {
  return createHash('sha256').update(seed).digest('hex');
}
