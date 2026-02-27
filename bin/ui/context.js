/**
 * Shared bijou context configured for CLI use (writes to stderr).
 */

import { createBijou } from '@flyingrobots/bijou';
import { nodeRuntime, chalkStyle } from '@flyingrobots/bijou-node';

let ctx = null;

/**
 * Returns a bijou context that writes to stderr instead of stdout.
 * Stdout is reserved for structured output (OIDs, JSON).
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

function stderrIO() {
  return {
    write(data) {
      process.stderr.write(data);
    },
    question() {
      throw new Error('question() not supported in CLI context');
    },
    rawInput() {
      throw new Error('rawInput() not supported in CLI context');
    },
    onResize(callback) {
      const handler = () => {
        callback(process.stderr.columns ?? 80, process.stderr.rows ?? 24);
      };
      process.stderr.on('resize', handler);
      return { dispose() { process.stderr.removeListener('resize', handler); } };
    },
    setInterval(callback, ms) {
      const id = globalThis.setInterval(callback, ms);
      return { dispose() { globalThis.clearInterval(id); } };
    },
    readFile() { throw new Error('readFile() not supported'); },
    readDir() { throw new Error('readDir() not supported'); },
    joinPath(...segments) { return segments.join('/'); },
  };
}
