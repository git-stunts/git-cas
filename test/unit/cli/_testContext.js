/**
 * Shared test context factory for CLI UI tests.
 */
import { createTestContext } from '@flyingrobots/bijou/adapters/test';

export function makeRuntime(runtime = {}) {
  return { columns: 80, rows: 24, ...runtime };
}

export function makeInteractiveRuntime(runtime = {}) {
  return makeRuntime({
    env: { TERM: 'xterm-256color' },
    stdoutIsTTY: true,
    stdinIsTTY: true,
    ...runtime,
  });
}

export function makePipeRuntime(runtime = {}) {
  return makeRuntime({
    env: { TERM: 'xterm-256color' },
    stdoutIsTTY: false,
    stdinIsTTY: false,
    ...runtime,
  });
}

export function makeCtx(mode = 'interactive', runtime = {}) {
  return createTestContext({ mode, noColor: true, runtime });
}
