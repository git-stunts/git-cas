import { describe, expect, it, vi } from 'vitest';
import BundleService from '../../../../src/domain/services/BundleService.js';
import PageService from '../../../../src/domain/services/PageService.js';
import StagingWorkspaceRegistry from '../../../../src/domain/services/StagingWorkspaceRegistry.js';
import parseApplicationHandle from '../../../../src/domain/value-objects/ApplicationHandle.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import MemoryRefAdapter from '../../../helpers/MemoryRefAdapter.js';

const CLOCK = Object.freeze({ now: () => new Date('2026-08-23T12:00:00.000Z') });

function fixture() {
  const persistence = new MemoryPersistenceAdapter();
  const ref = new MemoryRefAdapter();
  const pages = new PageService({ persistence, maxPageSize: 4096, clock: CLOCK });
  const services = {};
  const resolveHandle = vi.fn(async (value, context) => {
    const handle = parseApplicationHandle(value);
    return handle.kind === 'page'
      ? await pages.resolveRoot(handle)
      : await services.bundles.resolveRoot(handle, context);
  });
  services.bundles = new BundleService({
    persistence,
    codec: new JsonCodec(),
    pages,
    resolveHandle,
    openHandle: (handle) => pages.open({ handle }),
    clock: CLOCK,
  });
  const registry = new StagingWorkspaceRegistry({
    persistence,
    ref,
    assets: { put: vi.fn(), putBatch: vi.fn(), adopt: vi.fn() },
    pages,
    bundles: services.bundles,
    resolveHandle,
    crypto: { randomBytes: (length) => new Uint8Array(length) },
    clock: CLOCK,
  });
  return { ref, registry, resolveHandle };
}

describe('StagingWorkspace bundle batches', () => {
  it('retains every bundle in one exact workspace generation', async () => {
    const { ref, registry, resolveHandle } = fixture();
    const updateRef = vi.spyOn(ref, 'updateRef');
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    const staged = await workspace.bundles.putOrderedBatch({
      bundles: [
        { members: [['root', Buffer.from('first')]] },
        { members: [['root', Buffer.from('second')]] },
      ],
    });

    expect(staged).toHaveLength(2);
    expect(new Set(staged.map((bundle) => bundle.witness.root.generation)).size).toBe(1);
    expect(staged.every((bundle) => bundle.state === 'retained')).toBe(true);
    expect(updateRef).toHaveBeenCalledOnce();
    expect(resolveHandle).not.toHaveBeenCalled();
  });

  it('returns no retained subset when the exact generation cannot install', async () => {
    const { ref, registry } = fixture();
    vi.spyOn(ref, 'updateRef').mockRejectedValueOnce(new Error('simulated ref failure'));
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    await expect(
      workspace.bundles.putOrderedBatch({
        bundles: [
          { members: [['root', Buffer.from('first')]] },
          { members: [['root', Buffer.from('second')]] },
        ],
      })
    ).rejects.toMatchObject({
      code: 'WORKSPACE_RETENTION_FAILED',
      meta: { method: 'putOrderedBatch', stagedCount: 2 },
    });
  });
});
