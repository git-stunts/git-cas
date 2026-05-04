/**
 * Compact SHA/OID presentation with a footer-friendly full-value affordance.
 */

import { themeText } from '../theme.js';

/**
 * @param {string | null | undefined} value
 * @param {number} [chars]
 * @returns {string}
 */
export function shortenSha(value, chars = 12) {
  if (typeof value !== 'string' || value.length === 0) { return '-'; }
  const safeChars = Math.max(4, Math.floor(chars));
  return value.length > safeChars ? `${value.slice(0, safeChars)}...` : value;
}

/**
 * @param {string | null | undefined} value
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @param {{ chars?: number, selected?: boolean, tone?: string }} [options]
 * @returns {string}
 */
export function renderShortSha(value, ctx, options = {}) {
  const tone = options.selected ? 'accent' : (options.tone ?? 'secondary');
  return themeText(ctx, shortenSha(value, options.chars), { tone, bold: options.selected ?? false });
}

/**
 * @param {string} label
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function shortShaStatus(label, value) {
  return typeof value === 'string' && value.length > 0 ? `${label} ${value}` : '';
}
