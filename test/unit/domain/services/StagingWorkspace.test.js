import { describe, expect, it, vi } from 'vitest';
import AssetHandle from '../../../../src/domain/value-objects/AssetHandle.js';
import WorkspaceRef from '../../../../src/domain/value-objects/WorkspaceRef.js';
import PageService from '../../../../src/domain/services/PageService.js';
import RootSet from '../../../../src/domain/services/RootSet.js';
import RootSetMetadataCodec from '../../../../src/domain/services/RootSetMetadataCodec.js';
import RootSetPersistence from '../../../../src/domain/services/RootSetPersistence.js';
import StagingWorkspaceRegistry from '../../../../src/domain/services/StagingWorkspaceRegistry.js';
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
  const registry = new StagingWorkspaceRegistry({
    persistence,
    ref,
    pages,
    assets: {
      put: vi.fn(),
      adopt: vi.fn(),
    },
    bundles: {
      put: vi.fn(),
      putOrdered: vi.fn(),
    },
    resolveHandle: resolveHandle ?? ((handle) => pages.resolveRoot(handle)),
    crypto: {
      randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index),
    },
    clock,
  });
  return {
    persistence,
    pages,
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
