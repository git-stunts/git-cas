import { setTimeout as delay } from 'node:timers/promises';

/**
 * @param {unknown} err
 * @returns {err is NodeJS.ErrnoException}
 */
function isBrokenPipeError(err) {
  return Boolean(err && typeof err === 'object' && /** @type {NodeJS.ErrnoException} */ (err).code === 'EPIPE');
}

/**
 * Install stdout/stderr error handlers that exit cleanly when the downstream
 * consumer closes the pipe before the CLI finishes writing.
 *
 * @param {Object} [options]
 * @param {{ on(event: string, listener: (...args: any[]) => void): any, removeListener(event: string, listener: (...args: any[]) => void): any }} [options.stdout]
 * @param {{ on(event: string, listener: (...args: any[]) => void): any, removeListener(event: string, listener: (...args: any[]) => void): any }} [options.stderr]
 * @param {(code?: number) => never} [options.exit]
 * @param {() => number} [options.getExitCode]
 * @returns {{ dispose(): void }}
 */
export function installBrokenPipeHandlers({
  stdout = process.stdout,
  stderr = process.stderr,
  exit = process.exit,
  getExitCode = () => process.exitCode || 0,
} = {}) {
  const onError = (/** @type {unknown} */ err) => {
    if (isBrokenPipeError(err)) {
      exit(getExitCode());
    }
  };

  stdout.on('error', onError);
  stderr.on('error', onError);

  return {
    dispose() {
      stdout.removeListener('error', onError);
      stderr.removeListener('error', onError);
    },
  };
}

/**
 * Flush stdout/stderr before exit so the CLI does not hang on open handles in
 * containerized test environments.
 *
 * @param {Object} [options]
 * @param {{ write(chunk: string, callback?: () => void): boolean }} [options.stdout]
 * @param {{ write(chunk: string, callback?: () => void): boolean }} [options.stderr]
 * @param {(code?: number) => void} [options.exit]
 * @param {number} [options.code]
 * @returns {Promise<void>}
 */
export async function flushStdioAndExit({
  stdout = process.stdout,
  stderr = process.stderr,
  exit = process.exit,
  code = process.exitCode || 0,
} = {}) {
  await flushStream(stdout);
  await flushStream(stderr);
  exit(code);
}

/**
 * @param {{ write(chunk: string, callback?: () => void): boolean }} stream
 * @returns {Promise<void>}
 */
async function flushStream(stream) {
  try {
    await new Promise((resolve) => {
      stream.write('', resolve);
    });
  } catch (err) {
    if (!isBrokenPipeError(err)) {
      throw err;
    }
  }

  // Give stream error handlers one turn to observe late EPIPE events before exit.
  await delay(0);
}

export { isBrokenPipeError };
