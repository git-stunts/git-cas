import { describe, expect, it, vi } from 'vitest';
import AssetHandle from '../../../../src/domain/value-objects/AssetHandle.js';
import WorkspaceRef from '../../../../src/domain/value-objects/WorkspaceRef.js';
import PageService from '../../../../src/domain/services/PageService.js';
import RootSet from '../../../../src/domain/services/RootSet.js';
import RootSetMetadataCodec from '../../../../src/domain/services/RootSetMetadataCodec.js';
import RootSetPersistence from '../../../../src/domain/services/RootSetPersistence.js';
import StagingWorkspaceRegistry, {
  MAX_WORKSPACE_INSPECTION_LIMIT,
} from '../../../../src/domain/services/StagingWorkspaceRegistry.js';
import { MAX_WORKSPACE_TARGETS } from '../../../../src/domain/services/WorkspaceDescriptorCodec.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import MemoryRefAdapter from '../../../helpers/MemoryRefAdapter.js';

const START = Date.parse('2026-07-17T20:00:00.000Z');
const TTL_MS = 60_000;

function makeFixture({ resolveHandle } = {}) {
  let now = START;
  const clock = { now: () => new Date(now) };
  const persistence = new MemoryPersistenceAdapter();
  const ref = new MemoryRefAdapter();
  const pages = new PageService({ persistence, clock });
  const assets = {
    put: vi.fn(),
    adopt: vi.fn(),
  };
  const bundles = {
    put: vi.fn(),
    putOrdered: vi.fn(),
  };
  const registry = new StagingWorkspaceRegistry({
    persistence,
    ref,
    pages,
    assets,
    bundles,
    resolveHandle: resolveHandle ?? ((handle) => pages.resolveRoot(handle)),
    crypto: {
      randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index),
    },
    clock,
  });
  return {
    persistence,
    pages,
    assets,
    bundles,
    ref,
    registry,
    setNow: (value) => { now = value; },
  };
}

function workspaceRootSet({ persistence, ref }, value) {
  const workspaceRef = WorkspaceRef.from(value);
  const metadataCodec = new RootSetMetadataCodec({ refType: WorkspaceRef });
  const rootSetPersistence = new RootSetPersistence({
    rootSetRef: workspaceRef.toString(),
    persistence,
    ref,
    refType: WorkspaceRef,
    metadataCodec,
  });
  return new RootSet({
    ref: workspaceRef.toString(),
    persistence: rootSetPersistence,
    refType: WorkspaceRef,
    metadataCodec,
  });
}

async function reachableOids({ persistence, ref }, generationRef) {
  const headOid = await ref.resolveRef(generationRef);
  const treeOid = await ref.resolveTree(headOid);
  const entries = await persistence.readTree(treeOid);
  return {
    headOid,
    oids: new Set(entries.map((entry) => entry.oid)),
  };
}

function inventoryPage(records, after, limit) {
  return records.filter((record) => after === null || record.ref > after).slice(0, limit);
}

async function expectRetainedPageBatch({ fixture, staged, updateRef }) {
  expect(staged).toHaveLength(3);
  expect(staged.map((page) => page.handle.toString())).toEqual([
    staged[0].handle.toString(),
    staged[1].handle.toString(),
    staged[0].handle.toString(),
  ]);
  expect(staged.map((page) => page.state)).toEqual(['retained', 'retained', 'retained']);
  expect(new Set(staged.map((page) => page.witness.root.generation))).toEqual(
    new Set([staged[0].witness.root.generation]),
  );
  expect(updateRef).toHaveBeenCalledTimes(1);

  const roots = await reachableOids(fixture, staged[0].witness.root.ref);
  expect(roots.headOid).toBe(staged[0].witness.root.generation);
  expect(roots.oids).toContain(staged[0].handle.oid);
  expect(roots.oids).toContain(staged[1].handle.oid);
  expect(roots.oids).toHaveLength(4);
}

describe('StagingWorkspace staging', () => {
  it('returns from page staging only after the exact workspace generation reaches it', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });

    const staged = await workspace.pages.put({ source: Buffer.from('retained page') });

    expect(staged.state).toBe('retained');
    expect(staged.retention).toMatchObject({
      policy: 'evictable',
      reachability: 'anchored',
      protection: 'workspace',
    });
    expect(staged.witness).toMatchObject({
      policy: 'evictable',
      reachability: 'anchored',
      root: {
        kind: 'root-set',
        namespace: 'git-warp/materializations',
      },
    });

    const roots = await reachableOids(fixture, staged.witness.root.ref);
    expect(roots.headOid).toBe(staged.witness.root.generation);
    expect(roots.oids).toContain(staged.handle.oid);
  });
});

describe('StagingWorkspace page batches', () => {
  it('retains one ordered page batch in one workspace generation', async () => {
    const fixture = makeFixture();
    const updateRef = vi.spyOn(fixture.ref, 'updateRef');
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });

    const staged = await workspace.pages.putBatch({
      pages: [
        { source: Buffer.from('first retained page') },
        { source: Buffer.from('second retained page') },
        { source: Buffer.from('first retained page') },
      ],
    });

    await expectRetainedPageBatch({ fixture, staged, updateRef });
  });

  it('rejects an oversized page batch before mutating the workspace ref', async () => {
    const fixture = makeFixture();
    const updateRef = vi.spyOn(fixture.ref, 'updateRef');
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });

    await expect(workspace.pages.putBatch({
      pages: [
        { source: Buffer.from('first') },
        { source: Buffer.from('second') },
      ],
      maxBatchPages: 1,
    })).rejects.toMatchObject({
      code: 'PAGE_BATCH_LIMIT',
    });
    expect(updateRef).not.toHaveBeenCalled();
  });
});

describe('StagingWorkspace page batch failure containment', () => {
  it('returns no retained batch when the workspace generation cannot install', async () => {
    const fixture = makeFixture();
    vi.spyOn(fixture.ref, 'updateRef').mockRejectedValueOnce(
      new Error('simulated ref failure'),
    );
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });

    await expect(workspace.pages.putBatch({
      pages: [{ source: Buffer.from('unretained batch page') }],
    })).rejects.toMatchObject({
      code: 'WORKSPACE_RETENTION_FAILED',
    });
  });
});

describe('StagingWorkspace expiry bounds', () => {
  it('maps an overflowing expiry to a stable workspace TTL error', async () => {
    const fixture = makeFixture();
    fixture.setNow(8_640_000_000_000_000);
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });

    await expect(workspace.pages.put({ source: Buffer.from('outside date range') }))
      .rejects.toMatchObject({ code: 'WORKSPACE_TTL_INVALID' });
  });
});

describe('StagingWorkspace checkpoint', () => {
  it('retains accumulated handles and checkpoints to the exact supplied roots', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    const first = await workspace.pages.put({ source: Buffer.from('first') });
    const second = await workspace.pages.put({ source: Buffer.from('second') });

    const accumulated = await reachableOids(fixture, second.witness.root.ref);
    expect(accumulated.oids).toContain(first.handle.oid);
    expect(accumulated.oids).toContain(second.handle.oid);

    const checkpoint = await workspace.checkpoint({ handles: [second.handle, second.handle] });
    const compacted = await reachableOids(fixture, checkpoint.ref);

    expect(checkpoint.handles.map((handle) => handle.toString())).toEqual([
      second.handle.toString(),
    ]);
    expect(compacted.oids).not.toContain(first.handle.oid);
    expect(compacted.oids).toContain(second.handle.oid);
  });

  it('serializes concurrent staging without losing either root', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });

    const [first, second] = await Promise.all([
      workspace.pages.put({ source: Buffer.from('concurrent-first') }),
      workspace.pages.put({ source: Buffer.from('concurrent-second') }),
    ]);
    const checkpoint = await workspace.renew();
    const roots = await reachableOids(fixture, checkpoint.ref);

    expect(roots.oids).toContain(first.handle.oid);
    expect(roots.oids).toContain(second.handle.oid);
  });
});

describe('StagingWorkspace checkpoint input bounds', () => {
  it('bounds hostile checkpoint iterables before repeated handles can run forever', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    const staged = await workspace.pages.put({ source: Buffer.from('bounded target') });
    let yielded = 0;
    function* repeatedForever() {
      while (true) {
        yielded += 1;
        yield staged.handle;
      }
    }

    await expect(workspace.checkpoint({ handles: repeatedForever() })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
      meta: {
        handleCount: MAX_WORKSPACE_TARGETS + 1,
        maxHandleCount: MAX_WORKSPACE_TARGETS,
      },
    });
    expect(yielded).toBe(MAX_WORKSPACE_TARGETS + 1);
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).resolves.toBe(
      staged.witness.root.generation,
    );
  });
});

describe('StagingWorkspace failure containment', () => {
  it.each([
    ['asset', (fixture) => fixture.assets.put, (workspace) => workspace.assets.put({})],
    [
      'page',
      (fixture) => vi.spyOn(fixture.pages, 'put'),
      (workspace) => workspace.pages.put({ source: Buffer.from('failed page') }),
    ],
    ['bundle', (fixture) => fixture.bundles.put, (workspace) => workspace.bundles.put({})],
  ])('keeps the current generation releasable after an underlying %s write fails',
    async (_label, serviceFor, stage) => {
      const fixture = makeFixture();
      const workspace = await fixture.registry.open({
        namespace: 'git-warp/materializations',
        ttlMs: TTL_MS,
      });
      const retained = await workspace.pages.put({ source: Buffer.from('existing root') });
      const service = serviceFor(fixture);
      service.mockRejectedValueOnce(new Error('injected stage failure'));

      await expect(stage(workspace)).rejects.toThrow('injected stage failure');
      service.mockRestore?.();
      await expect(fixture.ref.resolveRef(retained.witness.root.ref)).resolves.toBe(
        retained.witness.root.generation,
      );
      await expect(workspace.release()).resolves.toMatchObject({ changed: true });
    });
});

describe('StagingWorkspace retention failure evidence', () => {
  it('returns staged evidence when workspace retention fails after a successful write', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    vi.spyOn(fixture.ref, 'updateRef')
      .mockRejectedValueOnce(new Error('injected retention failure'));

    let failure;
    try {
      await workspace.pages.put({ source: Buffer.from('unretained result') });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: 'WORKSPACE_RETENTION_FAILED',
      meta: {
        method: 'put',
        workspaceId: workspace.id,
        staged: {
          state: 'staged',
          handle: expect.stringMatching(/^git-cas:1:page:blob:raw:/u),
          retention: { reachability: 'unanchored' },
        },
      },
    });
    expect(failure.meta.originalError).toMatchObject({
      code: 'ROOT_SET_REF_UPDATE_FAILED',
      message: 'Root-set ref update failed',
    });
    expect(failure.meta.originalError.meta.originalError).toMatchObject({
      message: 'injected retention failure',
    });
    await expect(workspace.release()).resolves.toMatchObject({ changed: false });
    await expect(fixture.registry.inspect({
      namespace: 'git-warp/materializations',
      limit: 10,
    })).resolves.toMatchObject({ returned: 0 });
  });
});

describe('StagingWorkspace checkpoint failure containment', () => {
  it('keeps the prior generation when a checkpoint ref update fails', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    const retained = await workspace.pages.put({ source: Buffer.from('prior generation') });
    const replacement = await fixture.pages.put({ source: Buffer.from('replacement target') });
    const updateRef = vi.spyOn(fixture.ref, 'updateRef')
      .mockRejectedValueOnce(new Error('injected checkpoint failure'));

    await expect(workspace.checkpoint({ handles: [replacement.handle] }))
      .rejects.toMatchObject({
        message: 'Root-set ref update failed',
        meta: {
          originalError: expect.objectContaining({ message: 'injected checkpoint failure' }),
        },
      });
    updateRef.mockRestore();
    await expect(fixture.ref.resolveRef(retained.witness.root.ref)).resolves.toBe(
      retained.witness.root.generation,
    );
    await expect(workspace.release()).resolves.toMatchObject({ changed: true });
  });
});

describe('StagingWorkspace expiry sweep', () => {
  it('does not revoke an expired workspace until a bounded sweep removes its generation', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    const staged = await workspace.pages.put({ source: Buffer.from('expires later') });
    fixture.setNow(START + TTL_MS + 1);

    const inspection = await fixture.registry.inspect({
      namespace: 'git-warp/materializations',
      limit: 10,
    });

    expect(inspection.workspaces).toHaveLength(1);
    expect(inspection.workspaces[0]).toMatchObject({
      id: workspace.id,
      posture: 'expired',
      rootCount: 1,
    });
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).resolves.toBe(
      staged.witness.root.generation,
    );

    const swept = await fixture.registry.sweep({
      namespace: 'git-warp/materializations',
      limit: 10,
    });

    expect(swept).toMatchObject({ changed: 1, conflicted: 0, truncated: false });
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).rejects.toMatchObject({
      code: 'GIT_REF_NOT_FOUND',
    });
  });
});

describe('StagingWorkspace sweep pagination', () => {
  it('uses opaque cursors to reach expired workspaces behind an active first page', async () => {
    const fixture = makeFixture();
    const active = await fixture.registry.open({
      namespace: 'git-warp/paginated-builds',
      ttlMs: TTL_MS,
    });
    await active.pages.put({ source: Buffer.from('active first page') });
    fixture.setNow(START + 1);
    const expired = await fixture.registry.open({
      namespace: 'git-warp/paginated-builds',
      ttlMs: 1,
    });
    const expiredStage = await expired.pages.put({ source: Buffer.from('expired second page') });
    fixture.setNow(START + 3);

    const first = await fixture.registry.sweep({
      namespace: 'git-warp/paginated-builds',
      limit: 1,
    });
    expect(first).toMatchObject({
      inspected: 1,
      changed: 0,
      truncated: true,
      nextCursor: expect.any(String),
    });
    const second = await fixture.registry.sweep({
      namespace: 'git-warp/paginated-builds',
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({ changed: 1, truncated: false, nextCursor: null });
    await expect(fixture.ref.resolveRef(expiredStage.witness.root.ref)).rejects.toMatchObject({
      code: 'GIT_REF_NOT_FOUND',
    });
  });
});

describe('StagingWorkspace sweep races', () => {
  it('reports an inspection-time generation race as a sweep conflict', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/raced-builds',
      ttlMs: 1,
    });
    const staged = await workspace.pages.put({ source: Buffer.from('raced sweep') });
    fixture.setNow(START + 2);
    const treeOid = await fixture.ref.resolveTree(staged.witness.root.generation);
    const replacement = await fixture.ref.createCommit({
      treeOid,
      parentOid: null,
      message: 'workspace: inspection race',
    });
    const iterateRefs = fixture.ref.iterateRefs.bind(fixture.ref);
    vi.spyOn(fixture.ref, 'iterateRefs').mockImplementation(async function* (options) {
      for await (const record of iterateRefs(options)) {
        yield record;
        await fixture.ref.updateRef({
          ref: record.ref,
          newOid: replacement,
          expectedOldOid: record.oid,
        });
      }
    });

    const swept = await fixture.registry.sweep({
      namespace: 'git-warp/raced-builds',
      limit: 10,
    });

    expect(swept).toMatchObject({ changed: 0, conflicted: 1, missing: 0 });
    expect(swept.results).toEqual([
      expect.objectContaining({
        ref: staged.witness.root.ref,
        generation: staged.witness.root.generation,
        changed: false,
        conflict: true,
      }),
    ]);
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).resolves.toBe(replacement);
  });
});

describe('StagingWorkspace sweep cursor validation', () => {
  it('rejects a cursor issued for another namespace', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/cursor-source',
      ttlMs: TTL_MS,
    });
    await workspace.pages.put({ source: Buffer.from('cursor source') });
    const source = await fixture.registry.inspect({
      namespace: 'git-warp/cursor-source',
      limit: 1,
    });

    await expect(fixture.registry.inspect({
      namespace: 'git-warp/cursor-target',
      limit: 1,
      cursor: source.workspaces[0].ref,
    })).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
  });
});

describe('StagingWorkspace maximum-page continuation', () => {
  it('reaches records beyond a full first page', async () => {
    const fixture = makeFixture();
    const namespace = 'git-warp/large-inventory';
    const records = Array.from({ length: MAX_WORKSPACE_INSPECTION_LIMIT + 2 }, (_, index) => ({
      ref: WorkspaceRef.create({
        namespace,
        createdAt: new Date(START + index).toISOString(),
        nonce: new Uint8Array(16),
      }).toString(),
      oid: 'a'.repeat(40),
      symref: null,
    }));
    vi.spyOn(fixture.ref, 'iterateRefs').mockImplementation(async function* ({ after, limit }) {
      yield* inventoryPage(records, after, limit);
    });

    const first = await fixture.registry.inspect({
      namespace,
      limit: MAX_WORKSPACE_INSPECTION_LIMIT,
    });
    const second = await fixture.registry.inspect({
      namespace,
      limit: MAX_WORKSPACE_INSPECTION_LIMIT,
      cursor: first.nextCursor,
    });

    expect(first).toMatchObject({
      returned: MAX_WORKSPACE_INSPECTION_LIMIT,
      truncated: true,
      nextCursor: records[MAX_WORKSPACE_INSPECTION_LIMIT - 1].ref,
    });
    expect(second).toMatchObject({ returned: 2, truncated: false, nextCursor: null });
  });
});

describe('StagingWorkspace inspection bytes', () => {
  it('reports logical asset bytes separately from unique direct root-object bytes', async () => {
    const logicalBytes = 4_096;
    const fixture = makeFixture({
      resolveHandle: async (handle) => ({
        handle,
        oid: handle.oid,
        type: 'tree',
        size: logicalBytes,
      }),
    });
    const manifestOid = await fixture.persistence.writeBlob(Buffer.from('manifest'));
    const treeOid = await fixture.persistence.writeTree([
      `100644 blob ${manifestOid}\tmanifest.cbor`,
    ]);
    const handle = new AssetHandle({ codec: 'raw', oid: treeOid });
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    await workspace.checkpoint({ handles: [handle] });

    const inspection = await fixture.registry.inspect({
      namespace: 'git-warp/materializations',
      limit: 10,
    });

    expect(inspection.workspaces[0]).toMatchObject({
      posture: 'active',
      logicalBytes,
      rootObjectBytes: await fixture.persistence.readObjectSize(treeOid),
    });
    expect(inspection.workspaces[0].rootObjectBytes).not.toBe(logicalBytes);
  });
});

describe('StagingWorkspace inspection integrity', () => {
  it('reports a typed-handle and retained-root mismatch as invalid', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    const retained = await workspace.pages.put({ source: Buffer.from('retained') });
    const replacement = await fixture.pages.put({ source: Buffer.from('replacement') });
    const rootSet = workspaceRootSet(fixture, retained.witness.root.ref);
    const state = await rootSet.read();
    const entries = state.entries.map((entry) => (
      entry.name.startsWith('target:') ? { ...entry, oid: replacement.handle.oid } : entry
    ));
    await rootSet.replace({ entries, expectedHeadOid: state.headOid });

    const inspection = await fixture.registry.inspect({
      namespace: 'git-warp/materializations',
      limit: 10,
    });

    expect(inspection.workspaces[0]).toMatchObject({
      posture: 'invalid',
      logicalBytes: null,
      rootObjectBytes: null,
      issue: { code: 'WORKSPACE_STATE_INVALID' },
    });
  });
});

describe('StagingWorkspace expiry renewal race', () => {
  it('lets renewal defeat a stale sweep through generation conflict', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    await workspace.pages.put({ source: Buffer.from('renewed during sweep') });
    fixture.setNow(START + TTL_MS + 1);
    const deleteRef = fixture.ref.deleteRef.bind(fixture.ref);
    vi.spyOn(fixture.ref, 'deleteRef').mockImplementationOnce(async (options) => {
      await workspace.renew();
      return await deleteRef(options);
    });

    const swept = await fixture.registry.sweep({
      namespace: 'git-warp/materializations',
      limit: 10,
    });
    const inspection = await fixture.registry.inspect({
      namespace: 'git-warp/materializations',
      limit: 10,
    });

    expect(swept).toMatchObject({ changed: 0, conflicted: 1 });
    expect(inspection.workspaces[0]).toMatchObject({ posture: 'active', rootCount: 1 });
  });
});

describe('StagingWorkspace release', () => {
  it('releases its exact generation idempotently', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    const staged = await workspace.pages.put({ source: Buffer.from('temporary') });

    await expect(workspace.release()).resolves.toMatchObject({ changed: true });
    await expect(workspace.release()).resolves.toMatchObject({ changed: false });
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).rejects.toMatchObject({
      code: 'GIT_REF_NOT_FOUND',
    });
  });

  it('fails closed when another generation replaces the managed ref', async () => {
    const fixture = makeFixture();
    const workspace = await fixture.registry.open({
      namespace: 'git-warp/materializations',
      ttlMs: TTL_MS,
    });
    const staged = await workspace.pages.put({ source: Buffer.from('generation race') });
    const treeOid = await fixture.ref.resolveTree(staged.witness.root.generation);
    const replacement = await fixture.ref.createCommit({
      treeOid,
      parentOid: null,
      message: 'workspace: replacement generation',
    });
    await fixture.ref.updateRef({
      ref: staged.witness.root.ref,
      newOid: replacement,
      expectedOldOid: staged.witness.root.generation,
    });

    await expect(workspace.release()).rejects.toMatchObject({ code: 'GIT_REF_CONFLICT' });
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).resolves.toBe(replacement);
  });
});
