import { describe, it, expect, vi } from 'vitest';
import { createTestContext } from '@flyingrobots/bijou/adapters/test';
import launchDashboard from '../../../bin/ui/dashboard.js';

describe('launchDashboard runtime wiring', () => {
  it('uses injected runtime dimensions for the first frame', async () => {
    const cas = {
      listVault: vi.fn().mockResolvedValue([]),
      getVaultMetadata: vi.fn().mockResolvedValue({}),
    };
    const runMock = vi.fn();
    const tickMock = vi.fn();
    const ctx = createTestContext({
      mode: 'interactive',
      runtime: {
        columns: 120,
        rows: 40,
        stdoutIsTTY: true,
        stdinIsTTY: true,
        env: () => undefined,
      },
    });

    await launchDashboard(cas, { ctx, runApp: runMock, tick: tickMock });

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.any(Function),
      }),
      expect.objectContaining({ ctx })
    );

    const [model] = runMock.mock.calls[0][0].init();
    expect(model.columns).toBe(120);
    expect(model.rows).toBe(40);
  });
});

describe('launchDashboard lower modes', () => {
  it('retains the tab-separated static fallback outside a TTY', async () => {
    const cas = {
      listVault: vi.fn().mockResolvedValue([{ slug: 'alpha', treeOid: 'abc123' }]),
      getVaultMetadata: vi.fn().mockResolvedValue({}),
    };
    const output = { write: vi.fn() };
    const ctx = createTestContext({
      mode: 'static',
      runtime: { stdoutIsTTY: false, stdinIsTTY: false, env: () => undefined },
    });

    await launchDashboard(cas, { ctx, output });

    expect(output.write).toHaveBeenCalledOnce();
    expect(output.write.mock.calls[0][0]).toContain('alpha');
    expect(output.write.mock.calls[0][0]).toContain('abc123');
  });
});
