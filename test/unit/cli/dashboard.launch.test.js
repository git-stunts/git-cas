import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeCtx } from './_testContext.js';

const runMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@flyingrobots/bijou-tui', async () => {
  const actual = await vi.importActual('@flyingrobots/bijou-tui');
  return { ...actual, run: runMock };
});

const { launchDashboard } = await import('../../../bin/ui/dashboard.js');

function mockCas(entries = []) {
  return {
    listVault: vi.fn().mockResolvedValue(entries),
    getVaultMetadata: vi.fn().mockResolvedValue(null),
    readManifest: vi.fn().mockResolvedValue(null),
  };
}

beforeEach(() => {
  runMock.mockClear();
});

describe('launchDashboard', () => {
  it('uses the interactive runtime when the context is interactive', async () => {
    const cas = mockCas();
    const ctx = makeCtx('interactive');

    await launchDashboard(cas, { ctx, runApp: runMock });

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(cas.listVault).not.toHaveBeenCalled();
  });

  it('falls back to a static list when the context is non-interactive', async () => {
    const cas = mockCas([{ slug: 'alpha', treeOid: 'deadbeef' }]);
    const ctx = makeCtx('pipe');
    const output = { write: vi.fn() };

    await launchDashboard(cas, { ctx, runApp: runMock, output });

    expect(runMock).not.toHaveBeenCalled();
    expect(cas.listVault).toHaveBeenCalledTimes(1);
    expect(output.write).toHaveBeenCalledWith('alpha\tdeadbeef\n');
  });
});
