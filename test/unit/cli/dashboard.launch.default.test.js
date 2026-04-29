import { describe, it, expect, vi } from 'vitest';
import { createTestContext } from '@flyingrobots/bijou/adapters/test';
import launchDashboard from '../../../bin/ui/dashboard.js';

describe('launchDashboard default context path', () => {
  it('stays interactive on a tty when NO_COLOR is set', async () => {
    const cas = { listVault: vi.fn().mockResolvedValue([]), getVaultMetadata: vi.fn().mockResolvedValue({}) };
    const runMock = vi.fn();
    const tickMock = vi.fn();
    const ctx = createTestContext({ 
      mode: 'interactive',
      runtime: { stdoutIsTTY: true, stdinIsTTY: true, env: (k) => k === 'NO_COLOR' ? '1' : undefined }
    });

    await launchDashboard(cas, { ctx, runApp: runMock, tick: tickMock });
    expect(runMock).toHaveBeenCalled();
  });
});
