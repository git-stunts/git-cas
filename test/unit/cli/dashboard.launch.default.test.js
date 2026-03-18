import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRuntime, mockIO, plainStyle } from '@flyingrobots/bijou/adapters/test';

const runMock = vi.fn().mockResolvedValue(undefined);

function mockCas(entries = []) {
  return {
    listVault: vi.fn().mockResolvedValue(entries),
    getVaultMetadata: vi.fn().mockResolvedValue(null),
    readManifest: vi.fn().mockResolvedValue(null),
  };
}

beforeEach(() => {
  vi.resetModules();
  runMock.mockClear();
});

describe('launchDashboard default context path', () => {
  it('stays interactive on a tty when NO_COLOR is set', async () => {
    vi.doMock('@flyingrobots/bijou-tui', async () => {
      const actual = await vi.importActual('@flyingrobots/bijou-tui');
      return { ...actual, run: runMock };
    });

    vi.doMock('@flyingrobots/bijou-node', async () => {
      const actual = await vi.importActual('@flyingrobots/bijou-node');
      return {
        ...actual,
        nodeRuntime: () => mockRuntime({
          env: { NO_COLOR: '1', TERM: 'xterm-256color' },
          stdoutIsTTY: true,
          stdinIsTTY: true,
          columns: 111,
          rows: 42,
        }),
        nodeIO: () => mockIO(),
        chalkStyle: () => plainStyle(),
      };
    });

    const { launchDashboard } = await import('../../../bin/ui/dashboard.js');
    const cas = mockCas();

    await launchDashboard(cas);

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(cas.listVault).not.toHaveBeenCalled();

    const [app] = runMock.mock.calls[0];
    const [model] = app.init();
    expect(model.columns).toBe(111);
    expect(model.rows).toBe(42);
  });
});
