/**
 * Vault history as a color-coded timeline.
 */

import { timeline, paginator } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';

/**
 * Parse a vault commit line into structured data.
 * Input format: "eff5569 vault: add photos/beach"
 *
 * @param {string} line
 * @returns {{ oid: string, operation: string, slug: string|null }|null}
 */
function parseCommitLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return null;
  }

  const oid = trimmed.slice(0, spaceIdx);
  const message = trimmed.slice(spaceIdx + 1);

  const match = message.match(/^vault:\s*(init|add|update|remove)\s*(.*)$/);
  if (!match) {
    return { oid, operation: 'unknown', slug: message };
  }

  return { oid, operation: match[1], slug: match[2] || null };
}

const STATUS_MAP = {
  init: 'info',
  add: 'success',
  update: 'warning',
  remove: 'error',
  unknown: 'pending',
};

/**
 * Render vault history as a color-coded timeline.
 *
 * @param {string} gitLogOutput - Raw output from `git log --oneline`.
 * @param {Object} [options]
 * @param {number} [options.page] - Current page (1-based).
 * @param {number} [options.perPage] - Entries per page (default 20).
 * @returns {string}
 */
export function renderHistoryTimeline(gitLogOutput, options = {}) {
  const ctx = getCliContext();
  const perPage = options.perPage ?? 20;
  const page = options.page ?? 1;

  const lines = gitLogOutput.split('\n').filter(Boolean);
  if (lines.length === 0) {
    return 'No history\n';
  }

  const totalPages = Math.ceil(lines.length / perPage);
  const start = (page - 1) * perPage;
  const pageLines = lines.slice(start, start + perPage);

  const events = pageLines
    .map(parseCommitLine)
    .filter(Boolean)
    .map(({ oid, operation, slug }) => ({
      label: slug ? `vault: ${operation} ${slug}` : `vault: ${operation}`,
      description: oid,
      status: STATUS_MAP[operation] || 'pending',
    }));

  let output = timeline(events, { ctx });

  if (totalPages > 1) {
    output += `\n${paginator({ current: page, total: totalPages, ctx })}`;
  }

  return output;
}
