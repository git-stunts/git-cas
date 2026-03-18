import { describe, it, expect } from 'vitest';

import { detectCliTuiMode } from '../../../bin/ui/context.js';

function makeRuntime(overrides = {}) {
  return {
    env: (key) => overrides.env?.[key],
    stdoutIsTTY: overrides.stdoutIsTTY ?? true,
    stdinIsTTY: overrides.stdinIsTTY ?? true,
    columns: overrides.columns ?? 80,
    rows: overrides.rows ?? 24,
  };
}

describe('detectCliTuiMode', () => {
  it('uses accessible mode when BIJOU_ACCESSIBLE=1', () => {
    const mode = detectCliTuiMode(makeRuntime({
      env: { BIJOU_ACCESSIBLE: '1', TERM: 'xterm-256color' },
    }));

    expect(mode).toBe('accessible');
  });

  it('falls back to pipe when TERM is dumb', () => {
    const mode = detectCliTuiMode(makeRuntime({
      env: { TERM: 'dumb' },
    }));

    expect(mode).toBe('pipe');
  });

  it('stays interactive on a TTY when NO_COLOR is set', () => {
    const mode = detectCliTuiMode(makeRuntime({
      env: { NO_COLOR: '1', TERM: 'xterm-256color' },
    }));

    expect(mode).toBe('interactive');
  });

  it('falls back to pipe when stdout is not a TTY', () => {
    const mode = detectCliTuiMode(makeRuntime({
      env: { TERM: 'xterm-256color' },
      stdoutIsTTY: false,
    }));

    expect(mode).toBe('pipe');
  });

  it('falls back to static in CI on a TTY', () => {
    const mode = detectCliTuiMode(makeRuntime({
      env: { CI: 'true', TERM: 'xterm-256color' },
    }));

    expect(mode).toBe('static');
  });
});
