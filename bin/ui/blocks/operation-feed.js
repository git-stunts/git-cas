/**
 * OperationFeed block — persistent operation history with progress tracking.
 *
 * Tracks store/restore operations with status, duration, and progress.
 * Complements the transient toast notification system with a persistent
 * log accessible via a keybinding.
 */

import { badge, surfaceToString } from '@flyingrobots/bijou';
import { hstackSurface } from '@flyingrobots/bijou-tui';
import { themeText } from '../theme.js';

/**
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 */

/**
 * @typedef {'pending' | 'running' | 'done' | 'error'} OpStatus
 */

/**
 * @typedef {Object} OperationEntry
 * @property {string} id
 * @property {'store' | 'restore'} type
 * @property {string} slug
 * @property {OpStatus} status
 * @property {number} startTime
 * @property {number | null} endTime
 * @property {number} chunksTotal
 * @property {number} chunksProcessed
 * @property {string | null} error
 */

/**
 * @typedef {Object} OperationFeedState
 * @property {OperationEntry[]} entries
 * @property {number} maxEntries
 */

/**
 * Create an empty feed state.
 *
 * @param {{ maxEntries?: number }} [opts]
 * @returns {OperationFeedState}
 */
export function createFeedState(opts = {}) {
  return { entries: [], maxEntries: opts.maxEntries ?? 50 };
}

/**
 * Start tracking a new operation.
 *
 * @param {OperationFeedState} state
 * @param {{ type: 'store' | 'restore', slug: string, chunksTotal?: number }} op
 * @returns {OperationFeedState}
 */
export function feedStartOp(state, op) {
  const entry = {
    id: `${op.type}-${op.slug}-${Date.now()}`,
    type: op.type,
    slug: op.slug,
    status: /** @type {OpStatus} */ ('running'),
    startTime: Date.now(),
    endTime: null,
    chunksTotal: op.chunksTotal ?? 0,
    chunksProcessed: 0,
    error: null,
  };
  const entries = [entry, ...state.entries].slice(0, state.maxEntries);
  return { ...state, entries };
}

/**
 * Update progress for a running operation.
 *
 * @param {OperationFeedState} state
 * @param {string} id
 * @param {number} chunksProcessed
 * @returns {OperationFeedState}
 */
export function feedUpdateProgress(state, id, chunksProcessed) {
  const entries = state.entries.map((e) =>
    e.id === id ? { ...e, chunksProcessed } : e,
  );
  return { ...state, entries };
}

/**
 * Mark an operation as completed.
 *
 * @param {OperationFeedState} state
 * @param {string} id
 * @returns {OperationFeedState}
 */
export function feedCompleteOp(state, id) {
  const entries = state.entries.map((e) =>
    e.id === id ? { ...e, status: /** @type {OpStatus} */ ('done'), endTime: Date.now() } : e,
  );
  return { ...state, entries };
}

/**
 * Mark an operation as failed.
 *
 * @param {OperationFeedState} state
 * @param {string} id
 * @param {string} error
 * @returns {OperationFeedState}
 */
export function feedFailOp(state, id, error) {
  const entries = state.entries.map((e) =>
    e.id === id ? { ...e, status: /** @type {OpStatus} */ ('error'), endTime: Date.now(), error } : e,
  );
  return { ...state, entries };
}

/**
 * Format a duration in ms to human-readable.
 *
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/** @type {Record<OpStatus, 'info' | 'success' | 'danger' | 'warning'>} */
const STATUS_VARIANTS = {
  pending: 'info',
  running: 'warning',
  done: 'success',
  error: 'danger',
};

/**
 * Render a single operation entry.
 *
 * @param {OperationEntry} entry
 * @param {BijouContext} ctx
 * @returns {string}
 */
function renderFeedEntry(entry, ctx) {
  const statusBadge = badge(entry.status, { variant: STATUS_VARIANTS[entry.status], ctx });
  const typeBadge = badge(entry.type, { variant: 'neutral', ctx });
  const header = surfaceToString(hstackSurface(1, statusBadge, typeBadge), ctx.style);
  const slug = themeText(ctx, entry.slug, { tone: 'primary' });
  const duration = entry.endTime
    ? formatDuration(entry.endTime - entry.startTime)
    : formatDuration(Date.now() - entry.startTime);
  const progress = entry.chunksTotal > 0
    ? `  ${entry.chunksProcessed}/${entry.chunksTotal} chunks`
    : '';
  const error = entry.error
    ? `\n  ${themeText(ctx, entry.error, { tone: 'danger' })}`
    : '';
  return `${header}  ${slug}  ${duration}${progress}${error}`;
}

/**
 * Render the full operation feed.
 *
 * @param {OperationFeedState} state
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderOperationFeed(state, ctx) {
  if (state.entries.length === 0) {
    return themeText(ctx, 'No operations recorded.', { tone: 'subdued' });
  }
  const title = themeText(ctx, `Operations (${state.entries.length})`, { tone: 'brand', bold: true });
  const entries = state.entries.map((e) => renderFeedEntry(e, ctx));
  return [title, '', ...entries].join('\n');
}
