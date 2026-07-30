/**
 * Animated progress bar for store/restore operations.
 * Wires CasService EventEmitter events to a bijou progress bar on stderr.
 */

import { statSync } from 'node:fs';
import { CLEAR_LINE_RETURN, cursorGuard, progressBar } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';

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
 * @typedef {import('../actions.js')} ActionsModule
 * @typedef {{ on(event: string, fn: Function): void, removeListener(event: string, fn: Function): void }} Observer
 * @typedef {{ attach(observer: Observer): void, detach(): void }} ProgressTracker
 */

/**
 * Create a progress tracker for store operations.
 *
 * @param {Object} options
 * @param {string} options.filePath - Path to the file being stored.
 * @param {number} options.chunkSize - Chunk size in bytes.
 * @param {boolean} [options.quiet] - Suppress all progress output.
 * @param {number} [options.fileSize] - Pre-computed file size (avoids stat).
 * @param {import('@flyingrobots/bijou').BijouContext} [options.ctx] - Context override.
 * @returns {ProgressTracker}
 */
export function createStoreProgress({
  filePath,
  chunkSize,
  quiet,
  fileSize: providedSize,
  ctx: providedCtx,
}) {
  if (quiet) {
    return { attach() {}, detach() {} };
  }

  const ctx = providedCtx || getCliContext();
  if (ctx.mode === 'pipe') {
    return { attach() {}, detach() {} };
  }

  const fileSize = providedSize ?? statSync(filePath).size;
  const totalChunks = fileSize === 0 ? 0 : Math.ceil(fileSize / chunkSize);

  if (totalChunks === 0) {
    return { attach() {}, detach() {} };
  }

  return createProgressTracker({ ctx, totalChunks, event: 'chunk:stored', label: 'Storing' });
}

/**
 * Create a progress tracker for restore operations.
 *
 * @param {Object} options
 * @param {number} options.totalChunks - Number of chunks to restore.
 * @param {boolean} [options.quiet] - Suppress all progress output.
 * @param {import('@flyingrobots/bijou').BijouContext} [options.ctx] - Context override.
 * @returns {ProgressTracker}
 */
export function createRestoreProgress({ totalChunks, quiet, ctx: providedCtx }) {
  if (quiet || totalChunks === 0) {
    return { attach() {}, detach() {} };
  }

  const ctx = providedCtx || getCliContext();
  if (ctx.mode === 'pipe') {
    return { attach() {}, detach() {} };
  }

  return createProgressTracker({ ctx, totalChunks, event: 'chunk:restored', label: 'Restoring' });
}

/**
 * @typedef {Object} TrackerState
 * @property {number} chunksProcessed
 * @property {number} bytesProcessed
 * @property {number | null} startTime
 * @property {Observer | null} service
 * @property {((evt: { size: number }) => void) | null} handler
 * @property {import('@flyingrobots/bijou').CursorHideHandle | null} cursorHandle
 */

/**
 * Handle a single chunk event (shared by store/restore).
 *
 * @param {{ size: number }} evt
 * @param {TrackerState} state
 * @param {{ ctx: import('@flyingrobots/bijou').BijouContext, totalChunks: number, label: string, width: number }} deps
 */
function handleChunkEvent({ size }, state, deps) {
  if (!state.startTime) {
    state.startTime = Date.now();
  }
  state.chunksProcessed++;
  state.bytesProcessed += size;
  renderProgress(state, deps);
}

/**
 * Render the current tracker state without mutating its counters.
 *
 * @param {TrackerState} state
 * @param {{ ctx: import('@flyingrobots/bijou').BijouContext, totalChunks: number, label: string, width: number }} deps
 */
function renderProgress(state, deps) {
  const pct = (state.chunksProcessed / deps.totalChunks) * 100;
  const elapsed = state.startTime ? (Date.now() - state.startTime) / 1000 : 0;
  const throughput = elapsed > 0 ? state.bytesProcessed / elapsed : 0;
  if (deps.ctx.mode === 'interactive') {
    const status = `  ${deps.label} ${state.chunksProcessed}/${deps.totalChunks}  ${formatBytes(throughput)}/s  `;
    const barStr = progressBar(pct, { width: deps.width, showPercent: false, ctx: deps.ctx });
    deps.ctx.io.writeError(`${CLEAR_LINE_RETURN}${status}${barStr}`);
  } else if (
    state.chunksProcessed === 1 ||
    state.chunksProcessed === deps.totalChunks ||
    state.chunksProcessed % 10 === 0
  ) {
    deps.ctx.io.writeError(
      `${deps.label} ${state.chunksProcessed}/${deps.totalChunks}  ${Math.round(pct)}%\n`
    );
  }
}

function releaseTracker(state) {
  state.cursorHandle?.dispose();
  state.cursorHandle = null;
  state.service = null;
  state.handler = null;
}

function attachProgress(svc, state, deps) {
  state.service = svc;
  state.handler = (/** @type {{ size: number }} */ evt) => handleChunkEvent(evt, state, deps);
  try {
    if (deps.ctx.mode === 'interactive') {
      state.cursorHandle = cursorGuard(deps.ctx.io).hide();
      renderProgress(state, deps);
    }
    state.service.on(deps.event, state.handler);
  } catch (error) {
    releaseTracker(state);
    throw error;
  }
}

function detachProgress(state, deps) {
  try {
    if (state.service && state.handler) {
      state.service.removeListener(deps.event, state.handler);
    }
    const elapsed = state.startTime ? (Date.now() - state.startTime) / 1000 : 0;
    const throughput = elapsed > 0 ? state.bytesProcessed / elapsed : 0;
    if (deps.ctx.mode === 'interactive') {
      deps.ctx.io.writeError(
        `${CLEAR_LINE_RETURN}  ${deps.label} ${state.chunksProcessed}/${deps.totalChunks} done  ${formatBytes(throughput)}/s\n`
      );
    } else {
      deps.ctx.io.writeError(`${deps.label} ${state.chunksProcessed}/${deps.totalChunks} done\n`);
    }
  } finally {
    releaseTracker(state);
  }
}

/**
 * Internal: builds the progress tracker object.
 *
 * @param {{ ctx: import('@flyingrobots/bijou').BijouContext, totalChunks: number, event: string, label: string }} params
 * @returns {ProgressTracker}
 */
function createProgressTracker({ ctx, totalChunks, event, label }) {
  const width = Math.min(40, (ctx.runtime.columns || 80) - 30);
  /** @type {TrackerState} */
  const state = {
    chunksProcessed: 0,
    bytesProcessed: 0,
    startTime: null,
    service: null,
    handler: null,
    cursorHandle: null,
  };
  const deps = { ctx, totalChunks, event, label, width };

  return {
    /** @param {Observer} svc */
    attach(svc) {
      attachProgress(svc, state, deps);
    },
    detach() {
      detachProgress(state, deps);
    },
  };
}
