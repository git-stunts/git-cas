/**
 * Shared bijou context configured for CLI use (writes to stderr).
 */

import { createBijou } from '@flyingrobots/bijou';
import { chalkStyle, createNodeContext, nodeIO, nodeRuntime } from '@flyingrobots/bijou-node';
import { GIT_CAS_THEME } from './theme.js';

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
  ctx = createNodeContext({
    theme: GIT_CAS_THEME,
    nodeIO: {
      stdout: process.stderr,
      stderr: process.stderr,
    },
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
  const base =
    options.runtime || options.style
      ? createBijou({
          runtime,
          io: options.io || nodeIO(),
          style: options.style || chalkStyle({ noColor }),
          theme: GIT_CAS_THEME,
        })
      : createNodeContext({
          theme: GIT_CAS_THEME,
          ...(options.io ? { io: options.io } : {}),
        });
  return {
    ...base,
    mode: detectCliTuiMode(runtime),
  };
}
