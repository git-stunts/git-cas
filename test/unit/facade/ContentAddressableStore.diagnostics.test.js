import { describe, expect, it, vi } from 'vitest';
import ContentAddressableStore, {
  GitRepositoryInspectionAdapter,
  RepositoryDoctor,
  RepositoryInspectionPort,
} from '../../../index.js';

function emptyStream() {
  return {
    finished: Promise.resolve({ code: 0, stderr: '' }),
    async *[Symbol.asyncIterator]() {},
  };
}

describe('ContentAddressableStore diagnostics', () => {
  it('exposes a machine-readable, non-mutating repository doctor capability', async () => {
    const plumbing = {
      execute: vi.fn().mockResolvedValue('0\n'),
      executeStream: vi.fn().mockImplementation(() => Promise.resolve(emptyStream())),
      inspectPrunableObjects: vi.fn().mockImplementation(() => Promise.resolve(emptyStream())),
    };
    const cas = new ContentAddressableStore({
      plumbing,
      clock: { now: () => new Date('2026-07-13T12:00:00.000Z') },
    });

    await expect(cas.diagnostics.doctor()).resolves.toMatchObject({
      version: 1,
      healthy: true,
      repository: {
        objects: {
          total: { objectCount: 0, logicalBytes: 0, physicalBytes: 0 },
          anchored: { objectCount: 0, physicalBytes: 0 },
          orphaned: { objectCount: 0 },
          volatile: { objectCount: 0 },
        },
        evidence: { mutatesRepository: false },
      },
    });
    expect(plumbing.inspectPrunableObjects).toHaveBeenCalledTimes(1);
  });

  it('exports the diagnostics domain and adapter boundaries', () => {
    expect(RepositoryDoctor).toBeTypeOf('function');
    expect(GitRepositoryInspectionAdapter).toBeTypeOf('function');
    expect(RepositoryInspectionPort).toBeTypeOf('function');
  });
});
