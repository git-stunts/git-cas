/**
 * Vault list filtering and table formatting utilities.
 */

/**
 * Convert a simple glob pattern to a RegExp.
 *
 * @param {string} pattern - Glob pattern (supports *, **, ?).
 * @param {string} str - String to test.
 * @returns {boolean}
 */
export function matchGlob(pattern, str) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(str);
}

/**
 * Filter vault entries by an optional glob pattern.
 *
 * @param {Array<{slug: string, treeOid: string}>} entries
 * @param {string} [pattern]
 * @returns {Array<{slug: string, treeOid: string}>}
 */
export function filterEntries(entries, pattern) {
  if (!pattern) {
    return entries;
  }
  return entries.filter(e => matchGlob(pattern, e.slug));
}

/**
 * Format entries as an aligned table with header (for TTY output).
 *
 * @param {Array<{slug: string, treeOid: string}>} entries
 * @returns {string}
 */
export function formatTable(entries) {
  if (entries.length === 0) {
    return '';
  }
  const maxSlug = Math.max('SLUG'.length, ...entries.map(e => e.slug.length));
  const header = `${'SLUG'.padEnd(maxSlug)}  TREE OID`;
  const rows = entries.map(e => `${e.slug.padEnd(maxSlug)}  ${e.treeOid}`);
  return `${header}\n${rows.join('\n')}\n`;
}

/**
 * Format entries as tab-separated rows (for piped output).
 *
 * @param {Array<{slug: string, treeOid: string}>} entries
 * @returns {string}
 */
export function formatTabSeparated(entries) {
  return entries.map(e => `${e.slug}\t${e.treeOid}\n`).join('');
}
