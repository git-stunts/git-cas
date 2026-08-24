import { describe, expect, it, vi } from 'vitest';
import BundleService from '../../../../src/domain/services/BundleService.js';
import PageService from '../../../../src/domain/services/PageService.js';
import StagingWorkspaceRegistry from '../../../../src/domain/services/StagingWorkspaceRegistry.js';
import parseApplicationHandle from '../../../../src/domain/value-objects/ApplicationHandle.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import MemoryRefAdapter from '../../../helpers/MemoryRefAdapter.js';

const CLOCK = Object.freeze({ now: () => new Date('2026-08-24T17:00:00.000Z') });

function fixture({ withWriteScope = true } = {}) {
  const persistence = new MemoryPersistenceAdapter();
  if (!withWriteScope) {
    Object.defineProperty(persistence, 'withWriteScope', { value: undefined });
  }
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
  return { persistence, ref, registry };
}

describe('StagingWorkspace compound admission', () => {
  it('anchors dependent page and bundle waves in one exact generation', async () => {
    const { persistence, ref, registry } = fixture();
    const writeScope = vi.spyOn(persistence, 'withWriteScope');
    const updateRef = vi.spyOn(ref, 'updateRef');
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    const admitted = await workspace.batch({
      maxOperations: 2,
      operation: async (scope) => {
        const pages = await scope.pages.putBatch({
          pages: [{ source: new Uint8Array([1, 2, 3]) }],
        });
        expect(Object.isFrozen(scope)).toBe(true);
        expect(Object.isFrozen(pages)).toBe(true);
        const bundles = await scope.bundles.putOrderedBatch({
          bundles: [{ members: [['leaf/data', pages[0]]] }],
        });
        expect(Object.isFrozen(bundles)).toBe(true);
        return bundles[0];
      },
    });

    expect(admitted.value.toString()).toMatch(/^git-cas:1:bundle:/u);
    expect(admitted.retention.handles.map((handle) => handle.toString())).toHaveLength(2);
    expect(new Set(admitted.retention.witnesses.map((witness) => witness.root.generation))).toEqual(
      new Set([admitted.retention.generation])
    );
    expect(updateRef).toHaveBeenCalledOnce();
    expect(writeScope).toHaveBeenCalledOnce();
  });

});

describe('StagingWorkspace compound persistence compatibility', () => {
  it('uses direct persistence when write-scope support is absent', async () => {
    const { registry } = fixture({ withWriteScope: false });
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    const admitted = await workspace.batch({
      operation: async (scope) =>
        (
          await scope.pages.putBatch({
            pages: [{ source: new Uint8Array([1, 2, 3]) }],
          })
        )[0],
    });

    expect(admitted.value.toString()).toMatch(/^git-cas:1:page:/u);
    expect(admitted.retention.handles).toHaveLength(1);
  });
});

describe('StagingWorkspace compound retention and bounds', () => {
  it('retains prior workspace targets in the one compound generation', async () => {
    const { ref, registry } = fixture();
    const updateRef = vi.spyOn(ref, 'updateRef');
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });
    const prior = await workspace.pages.put({ source: new Uint8Array([0]) });

    const admitted = await workspace.batch({
      operation: async (scope) =>
        (
          await scope.pages.putBatch({
            pages: [{ source: new Uint8Array([1]) }],
          })
        )[0],
    });

    expect(admitted.retention.handles.map((handle) => handle.toString())).toEqual([
      prior.handle.toString(),
      admitted.value.toString(),
    ]);
    expect(updateRef).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['zero', 0],
    ['fractional', 1.5],
    ['above the hard maximum', 1025],
  ])('rejects a %s operation bound without moving the workspace ref', async (_, maxOperations) => {
    const { ref, registry } = fixture();
    const updateRef = vi.spyOn(ref, 'updateRef');
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    await expect(
      workspace.batch({
        maxOperations,
        operation: async (scope) =>
          await scope.pages.putBatch({
            pages: [{ source: new Uint8Array([1]) }],
          }),
      })
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(updateRef).not.toHaveBeenCalled();
  });
});

describe('StagingWorkspace compound admission constraints', () => {
  it('rejects an empty compound operation without moving the workspace ref', async () => {
    const { ref, registry } = fixture();
    const updateRef = vi.spyOn(ref, 'updateRef');
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    await expect(workspace.batch({ operation: async () => 'empty' })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    expect(updateRef).not.toHaveBeenCalled();
  });

  it('fails the whole admission when its operation count exceeds the bound', async () => {
    const { ref, registry } = fixture();
    const updateRef = vi.spyOn(ref, 'updateRef');
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    await expect(
      workspace.batch({
        maxOperations: 1,
        operation: async (scope) =>
          await Promise.all([
            scope.pages.putBatch({ pages: [{ source: new Uint8Array([1]) }] }),
            scope.pages.putBatch({ pages: [{ source: new Uint8Array([2]) }] }),
          ]),
      })
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(updateRef).not.toHaveBeenCalled();
  });
});

describe('StagingWorkspace compound scope lifecycle', () => {
  it('closes an escaped scope before returning its retained value', async () => {
    const { ref, registry } = fixture();
    const updateRef = vi.spyOn(ref, 'updateRef');
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });
    let escapedScope;

    const admitted = await workspace.batch({
      operation: async (scope) => {
        escapedScope = scope;
        return (
          await scope.pages.putBatch({
            pages: [{ source: new Uint8Array([1]) }],
          })
        )[0];
      },
    });

    expect(admitted.retention.handles).toHaveLength(1);
    await expect(
      escapedScope.pages.putBatch({
        pages: [{ source: new Uint8Array([2]) }],
      })
    ).rejects.toMatchObject({ code: 'WORKSPACE_STATE_INVALID' });
    expect(updateRef).toHaveBeenCalledOnce();
  });
});

describe('StagingWorkspace compound failure containment', () => {
  it('does not move the ref when a provisional write fails', async () => {
    const { ref, registry } = fixture();
    const updateRef = vi.spyOn(ref, 'updateRef');
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    await expect(
      workspace.batch({
        operation: async (scope) =>
          await scope.pages.putBatch({
            pages: [{ source: new Uint8Array(4097) }],
          }),
      })
    ).rejects.toMatchObject({ code: 'PAGE_TOO_LARGE' });
    expect(updateRef).not.toHaveBeenCalled();
  });

  it('does not retain a successful page wave when its dependent bundle wave fails', async () => {
    const { ref, registry } = fixture();
    const updateRef = vi.spyOn(ref, 'updateRef');
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    await expect(
      workspace.batch({
        operation: async (scope) => {
          await scope.pages.putBatch({ pages: [{ source: new Uint8Array([1]) }] });
          return await scope.bundles.putOrderedBatch({
            bundles: [{ members: [['invalid', 'not-an-application-handle']] }],
          });
        },
      })
    ).rejects.toBeDefined();
    expect(updateRef).not.toHaveBeenCalled();
  });
});

describe('StagingWorkspace compound retention failure', () => {
  it('preserves the previous generation when final retention fails', async () => {
    const { ref, registry } = fixture();
    const retentionFailure = new Error('checked ref update failed');
    const updateRef = vi.spyOn(ref, 'updateRef').mockRejectedValueOnce(retentionFailure);
    const workspace = await registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: 60_000,
    });

    await expect(
      workspace.batch({
        operation: async (scope) =>
          (
            await scope.pages.putBatch({
              pages: [{ source: new Uint8Array([1]) }],
            })
          )[0],
      })
    ).rejects.toMatchObject({
      code: 'WORKSPACE_RETENTION_FAILED',
    });

    const retry = await workspace.batch({
      operation: async (scope) =>
        (
          await scope.pages.putBatch({
            pages: [{ source: new Uint8Array([2]) }],
          })
        )[0],
    });
    expect(retry.retention.handles.map((handle) => handle.toString())).toEqual([
      retry.value.toString(),
    ]);
    expect(updateRef).toHaveBeenCalledTimes(2);
    expect(updateRef.mock.calls[1][0].expectedOldOid).toBeNull();
  });
});
