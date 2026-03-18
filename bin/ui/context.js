/**
 * Shared bijou context configured for CLI use (writes to stderr).
 */

import { createBijou } from '@flyingrobots/bijou';
import { nodeRuntime, nodeIO, chalkStyle } from '@flyingrobots/bijou-node';

/** @type {import('@flyingrobots/bijou').BijouContext | null} */
let ctx = null;

/**
 * Returns a bijou context that writes to stderr instead of stdout.
 * Stdout is reserved for structured output (OIDs, JSON).
 *
 * @returns {import('@flyingrobots/bijou').BijouContext}
 */
export function getCliContext() {
  if (ctx) {
    return ctx;
  }
  const runtime = nodeRuntime();
  const noColor = runtime.env('NO_COLOR') !== undefined;
  ctx = createBijou({
    runtime,
    io: stderrIO(),
    style: chalkStyle(noColor),
  });
  return ctx;
}

/**
 * Detect the display mode for full-screen CLI TUI flows.
 *
 * Unlike Bijou's default detection, NO_COLOR only disables styling here.
 * It must not downgrade a real TTY session out of interactive mode.
 *
 * @param {import('@flyingrobots/bijou').RuntimePort} runtime
 * @returns {'interactive' | 'pipe' | 'static' | 'accessible'}
 */
export function detectCliTuiMode(runtime) {
  if (runtime.env('BIJOU_ACCESSIBLE') === '1') {
    return 'accessible';
  }
  if (runtime.env('TERM') === 'dumb') {
    return 'pipe';
  }
  if (!runtime.stdoutIsTTY || !runtime.stdinIsTTY) {
    return 'pipe';
  }
  if (runtime.env('CI') !== undefined) {
    return 'static';
  }
  return 'interactive';
}

/**
 * Returns a bijou context for interactive CLI TUI flows.
 *
 * This keeps NO_COLOR behavior for styling while preserving interactive mode
 * on real TTYs.
 *
 * @param {{
 *   runtime?: import('@flyingrobots/bijou').RuntimePort,
 *   io?: import('@flyingrobots/bijou').IOPort,
 *   style?: import('@flyingrobots/bijou').StylePort,
 * }} [options]
 * @returns {import('@flyingrobots/bijou').BijouContext}
 */
export function createCliTuiContext(options = {}) {
  const runtime = options.runtime || nodeRuntime();
  const noColor = runtime.env('NO_COLOR') !== undefined;
  const base = createBijou({
    runtime,
    io: options.io || nodeIO(),
    style: options.style || chalkStyle(noColor),
  });
  return {
    ...base,
    mode: detectCliTuiMode(runtime),
  };
}

/**
 * @returns {import('@flyingrobots/bijou').IOPort}
 */
function stderrIO() {
  return {
    /** @param {string} data */
    write(data) {
      process.stderr.write(data);
    },
    question() {
      throw new Error('question() not supported in CLI context');
    },
    rawInput() {
      throw new Error('rawInput() not supported in CLI context');
    },
    /** @param {(cols: number, rows: number) => void} callback */
    onResize(callback) {
      const handler = () => {
        callback(process.stderr.columns ?? 80, process.stderr.rows ?? 24);
      };
      process.stderr.on('resize', handler);
      return { dispose() { process.stderr.removeListener('resize', handler); } };
    },
    /**
     * @param {() => void} callback
     * @param {number} ms
     */
    setInterval(callback, ms) {
      const id = globalThis.setInterval(callback, ms);
      return { dispose() { globalThis.clearInterval(id); } };
    },
    readFile() { throw new Error('readFile() not supported'); },
    readDir() { throw new Error('readDir() not supported'); },
    /** @param {string[]} segments */
    joinPath(...segments) { return segments.join('/'); },
  };
}
