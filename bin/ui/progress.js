/**
 * Animated progress bar for store/restore operations.
 * Wires CasService EventEmitter events to a bijou progress bar on stderr.
 */

import { statSync } from 'node:fs';
import { createAnimatedProgressBar } from '@flyingrobots/bijou';
import { getCliContext } from './context.js';

/**
 * Format bytes as human-readable string.
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
 * Create a progress tracker for store operations.
 *
 * @param {Object} options
 * @param {string} options.filePath - Path to the file being stored.
 * @param {number} options.chunkSize - Chunk size in bytes.
 * @param {boolean} [options.quiet] - Suppress all progress output.
 * @returns {{ attach(observer: { on(event: string, fn: Function): void, removeListener(event: string, fn: Function): void }): void, detach(): void }}
 */
export function createStoreProgress({ filePath, chunkSize, quiet, fileSize: providedSize, ctx: providedCtx }) {
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
 * @returns {{ attach(observer: { on(event: string, fn: Function): void, removeListener(event: string, fn: Function): void }): void, detach(): void }}
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
 * Internal: builds the progress tracker object.
 */
function createProgressTracker({ ctx, totalChunks, event, label }) {
  const width = Math.min(40, (ctx.runtime.columns || 80) - 30);
  const bar = createAnimatedProgressBar({ width, showPercent: false, ctx });

  let chunksProcessed = 0;
  let bytesProcessed = 0;
  let startTime = null;
  let service = null;
  let handler = null;

  function onChunk({ size }) {
    if (!startTime) {
      startTime = Date.now();
    }
    chunksProcessed++;
    bytesProcessed += size;

    const pct = (chunksProcessed / totalChunks) * 100;
    const elapsed = (Date.now() - startTime) / 1000;
    const throughput = elapsed > 0 ? bytesProcessed / elapsed : 0;

    if (ctx.mode === 'interactive') {
      const status = `  ${label} ${chunksProcessed}/${totalChunks}  ${formatBytes(throughput)}/s  `;
      process.stderr.write(`\r\x1b[K${status}`);
      bar.update(pct);
    } else if (chunksProcessed === 1 || chunksProcessed === totalChunks || chunksProcessed % 10 === 0) {
      ctx.io.write(`${label} ${chunksProcessed}/${totalChunks}  ${Math.round(pct)}%\n`);
    }
  }

  return {
    attach(svc) {
      service = svc;
      handler = onChunk;
      bar.start();
      service.on(event, handler);
    },
    detach() {
      if (service && handler) {
        service.removeListener(event, handler);
      }
      const elapsed = startTime ? (Date.now() - startTime) / 1000 : 0;
      const throughput = elapsed > 0 ? bytesProcessed / elapsed : 0;
      const msg = `  ${label} ${chunksProcessed}/${totalChunks} done  ${formatBytes(throughput)}/s`;
      bar.stop(msg);
    },
  };
}
