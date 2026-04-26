/**
 * Vault history as a color-coded timeline.
 */

import { timeline, paginator } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';

/**
 * @typedef {{ oid: string, operation: string, slug: string | null }} VaultCommitEvent
 */

/**
 * Parse a vault commit line into structured data.
 * Input format: "eff5569 vault: add photos/beach"
 *
 * This is git-log output parsing — an infrastructure/adapter concern
 * exported here for convenience. Callers doing their own git interaction
 * should use this to normalize raw log lines before passing to the view.
 *
 * @param {string} line
 * @returns {VaultCommitEvent | null}
 */
export function parseCommitLine(line) {
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

/**
 * Parse raw git log output into structured vault commit events.
 *
 * @param {string} gitLogOutput - Raw output from `git log --oneline`.
 * @returns {VaultCommitEvent[]}
 */
export function parseGitLog(gitLogOutput) {
  return gitLogOutput
    .split('\n')
    .filter(Boolean)
    .map(parseCommitLine)
    .filter(/** @returns {e is VaultCommitEvent} */ (e) => e !== null);
}

/** @type {Record<string, string>} */
const STATUS_MAP = {
  init: 'info',
  add: 'success',
  update: 'warning',
  remove: 'error',
  unknown: 'pending',
};

/**
 * Render vault history as a color-coded timeline from pre-parsed events.
 *
 * @param {VaultCommitEvent[]} events - Pre-parsed vault commit events.
 * @param {Object} [options]
 * @param {number} [options.page] - Current page (1-based).
 * @param {number} [options.perPage] - Entries per page (default 20).
 * @returns {string}
 */
export function renderTimeline(events, options = {}) {
  const ctx = getCliContext();
  const perPage = options.perPage ?? 20;
  const page = options.page ?? 1;

  if (events.length === 0) {
    return 'No history\n';
  }

  const totalPages = Math.ceil(events.length / perPage);
  const start = (page - 1) * perPage;
  const pageEvents = events.slice(start, start + perPage);

  const timelineData = pageEvents.map(({ oid, operation, slug }) => ({
    label: slug ? `vault: ${operation} ${slug}` : `vault: ${operation}`,
    description: oid,
    status: /** @type {import('@flyingrobots/bijou').BaseStatusKey} */ (STATUS_MAP[operation] || 'pending'),
  }));

  let output = timeline(timelineData, { ctx });

  if (totalPages > 1) {
    output += `\n${paginator({ current: page, total: totalPages, ctx })}`;
  }

  return output;
}

/**
 * Render vault history from raw git log output (convenience wrapper).
 *
 * Parses the raw log, then delegates to renderTimeline.
 *
 * @param {string} gitLogOutput - Raw output from `git log --oneline`.
 * @param {Object} [options]
 * @param {number} [options.page] - Current page (1-based).
 * @param {number} [options.perPage] - Entries per page (default 20).
 * @returns {string}
 */
export function renderHistoryTimeline(gitLogOutput, options = {}) {
  return renderTimeline(parseGitLog(gitLogOutput), options);
}
