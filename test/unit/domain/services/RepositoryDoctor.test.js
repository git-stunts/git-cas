import { describe, expect, it, vi } from 'vitest';
import RepositoryDoctor, {
  DEFAULT_REPOSITORY_GRACE_PERIOD_MS,
} from '../../../../src/domain/services/RepositoryDoctor.js';

const NOW = '2026-07-13T12:00:00.000Z';
const ACQUISITION_ID = `v1-1783940400000-${'9'.repeat(64)}-${'8'.repeat(32)}`;

async function* values(items) {
  yield* items;
}

function repository(overrides = {}) {
  return {
    iterateObjects: vi.fn(() =>
      values([
        { oid: '1'.repeat(40), type: 'blob', logicalBytes: 10, physicalBytes: 8 },
        { oid: '2'.repeat(40), type: 'tree', logicalBytes: 20, physicalBytes: 12 },
        { oid: '3'.repeat(40), type: 'commit', logicalBytes: 30, physicalBytes: 16 },
        { oid: '4'.repeat(40), type: 'blob', logicalBytes: 40, physicalBytes: 20 },
        { oid: '5'.repeat(40), type: 'blob', logicalBytes: 50, physicalBytes: 24 },
      ])
    ),
    iterateReachableObjectIds: vi.fn(() =>
      values(['1'.repeat(40), '2'.repeat(40), '3'.repeat(40)])
    ),
    iteratePrunableObjects: vi.fn(() => values([{ oid: '5'.repeat(40), type: 'blob' }])),
    iterateRefs: vi.fn(() =>
      values([
        { ref: 'refs/cas/caches/git-warp/materializations', oid: 'a'.repeat(40) },
        {
          ref: `refs/cas/cache-acquisitions/git-warp%2Fmaterializations/${ACQUISITION_ID}`,
          oid: 'a'.repeat(40),
          symref: null,
        },
        { ref: 'refs/cas/expiring/git-warp/replay', oid: 'b'.repeat(40) },
        { ref: 'refs/cas/rootsets/git-warp/live', oid: 'c'.repeat(40) },
        { ref: 'refs/cas/vault', oid: 'd'.repeat(40) },
        { ref: 'refs/heads/main', oid: 'e'.repeat(40) },
        { ref: 'refs/tags/v1', oid: 'f'.repeat(40) },
      ])
    ),
    reachablePhysicalBytes: vi.fn().mockResolvedValue(36),
    ...overrides,
  };
}

function cacheDoctor() {
  return {
    healthy: true,
    root: { headOid: 'a'.repeat(40) },
    state: {
      entryCount: 2,
      logicalBytes: 90,
      pinnedEntries: 1,
      evictableEntries: 1,
      expiredEntries: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
      oldestAccessedAt: '2026-07-02T00:00:00.000Z',
      nextExpiry: '2026-07-14T00:00:00.000Z',
    },
    policy: {
      satisfied: true,
      limits: { maxEntries: 10, maxBytes: 1_000, accessResolutionMs: 60_000 },
    },
    issues: [],
  };
}

function workspaceInspector() {
  return {
    inspectRecord: vi.fn(async (record) => ({
      id: 'workspace',
      namespace: 'git-warp/materializations',
      ref: record.ref,
      generation: record.oid,
      symref: null,
      rootCount: 1,
      logicalBytes: 10,
      rootObjectBytes: 4,
      createdAt: '2026-07-13T10:00:00.000Z',
      ageMs: 7_200_000,
      expiresAt: '2026-07-13T14:00:00.000Z',
      posture: 'active',
      issue: null,
    })),
  };
}

function dependencies(repositoryPort = repository()) {
  return {
    repository: repositoryPort,
    rootSets: {
      open: vi.fn(() => ({
        doctor: vi.fn().mockResolvedValue({
          healthy: true,
          headOid: 'c'.repeat(40),
          entryCount: 3,
          policyCounts: { pinned: 2, evictable: 1 },
          reachabilityCounts: { anchored: 3, missing: 0, unknown: 0, orphaned: 0, volatile: 0 },
          issues: [],
        }),
      })),
    },
    caches: {
      open: vi.fn(() => ({ doctor: vi.fn().mockResolvedValue(cacheDoctor()) })),
    },
    expiringSets: {
      open: vi.fn(() => ({
        doctor: vi.fn().mockResolvedValue({
          healthy: true,
          root: { headOid: 'b'.repeat(40) },
          state: {
            entryCount: 4,
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-12T00:00:00.000Z',
            nextExpiry: '2026-07-20T00:00:00.000Z',
          },
          observed: { liveEntries: 3, expiredEntries: 1 },
          issues: [],
        }),
      })),
    },
    workspaces: workspaceInspector(),
    vault: {
      getVaultMetadata: vi.fn().mockResolvedValue({ version: 1 }),
      readState: vi.fn().mockResolvedValue({
        entries: new Map([
          ['one', '1'.repeat(40)],
          ['two', '2'.repeat(40)],
        ]),
        parentCommitOid: 'd'.repeat(40),
        metadata: { version: 1 },
      }),
    },
    clock: { now: () => new Date(NOW) },
  };
}

// eslint-disable-next-line max-lines-per-function
describe('RepositoryDoctor', () => {
  // eslint-disable-next-line max-lines-per-function
  it('keeps reachability, retention policy, and byte attribution as separate evidence', async () => {
    const ports = dependencies();
    const doctor = new RepositoryDoctor(ports);
    const report = await doctor.doctor();

    expect(report).toMatchObject({
      version: 1,
      healthy: true,
      observedAt: NOW,
      policy: {
        gracePeriodMs: DEFAULT_REPOSITORY_GRACE_PERIOD_MS,
        expiresBefore: '2026-06-29T12:00:00.000Z',
      },
      repository: {
        objects: {
          total: { objectCount: 5, logicalBytes: 150, physicalBytes: 80 },
          anchored: { objectCount: 3, physicalBytes: 36 },
          orphaned: { objectCount: 1, physicalBytes: null },
          volatile: { objectCount: 1, physicalBytes: null },
          unreachable: { objectCount: 2, physicalBytes: 44 },
        },
        roots: { refCount: 7, reflogsIncluded: true },
        evidence: { prunableInspection: 'dry-run', mutatesRepository: false },
      },
      usage: {
        acquisitions: {
          healthy: true,
          coverage: { observed: 1, inspected: 1, complete: true },
          totals: {
            activeCount: 1,
            oldestAcquiredAt: '2026-07-13T11:00:00.000Z',
            newestAcquiredAt: '2026-07-13T11:00:00.000Z',
            maxAgeMs: 3_600_000,
          },
          entries: [{
            id: ACQUISITION_ID,
            namespace: 'git-warp/materializations',
            generation: 'a'.repeat(40),
            acquiredAt: '2026-07-13T11:00:00.000Z',
            ageMs: 3_600_000,
          }],
        },
        caches: {
          coverage: { observed: 1, inspected: 1, complete: true },
          totals: {
            entryCount: 2,
            logicalBytes: 90,
            pinnedEntries: 1,
            evictableEntries: 1,
            expiredEntries: 1,
          },
        },
        rootSets: {
          coverage: { observed: 1, inspected: 1, complete: true },
          totals: { entryCount: 3, pinnedEntries: 2, evictableEntries: 1 },
        },
        vault: { present: true, healthy: true, entryCount: 2, physicalBytes: null },
      },
    });
    expect(report.usage.caches.entries[0]).toMatchObject({
      namespace: 'git-warp/materializations',
      reachability: 'anchored',
      retention: { pinnedEntries: 1, evictableEntries: 1 },
      physicalBytes: null,
    });
    expect(report.limitations.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'SHARED_PHYSICAL_BYTES_UNATTRIBUTABLE',
        'PACKED_OBJECT_AGE_UNAVAILABLE',
      ])
    );
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.repository.objects)).toBe(true);
    expect(Object.isFrozen(report.usage.caches.entries)).toBe(true);
    expect(ports.repository.iteratePrunableObjects).toHaveBeenCalledWith({
      expiresBefore: '2026-06-29T12:00:00.000Z',
    });
  });

  it('bounds collection details while inspecting and totaling every managed ref', async () => {
    const repositoryPort = repository({
      iterateRefs: vi.fn(() =>
        values([
          { ref: 'refs/cas/caches/a/one', oid: 'a'.repeat(40) },
          { ref: 'refs/cas/caches/b/two', oid: 'b'.repeat(40) },
          { ref: 'refs/cas/caches/c/three', oid: 'c'.repeat(40) },
        ])
      ),
    });
    const ports = dependencies(repositoryPort);
    const doctor = new RepositoryDoctor(ports);

    const report = await doctor.doctor({ maxCollectionsPerKind: 2 });

    expect(report.usage.caches.coverage).toEqual({
      observed: 3,
      inspected: 3,
      detailed: 2,
      complete: true,
    });
    expect(report.usage.caches.totals).toMatchObject({
      entryCount: 6,
      logicalBytes: 270,
    });
    expect(report.usage.caches.entries).toHaveLength(2);
    expect(ports.caches.open).toHaveBeenCalledTimes(3);
    expect(report.limitations).toContainEqual(
      expect.objectContaining({
        code: 'COLLECTION_DETAILS_TRUNCATED',
        kind: 'caches',
        observed: 3,
        inspected: 3,
        detailed: 2,
      })
    );
  });

  it('reports bounded acquisition detail without widening the legacy kind union', async () => {
    const acquisitionRefs = ['1', '2', '3'].map((nonce, index) => ({
      ref: 'refs/cas/cache-acquisitions/git-warp%2Fmaterializations/' +
        `v1-1783940400000-${'9'.repeat(64)}-${nonce.repeat(32)}`,
      oid: String(index + 1).repeat(40),
      symref: null,
    }));
    const ports = dependencies(repository({
      iterateRefs: vi.fn(() => values(acquisitionRefs)),
    }));

    const report = await new RepositoryDoctor(ports).doctor({ maxCollectionsPerKind: 2 });

    expect(report.usage.acquisitions.coverage).toEqual({
      observed: 3,
      inspected: 3,
      detailed: 2,
      complete: true,
    });
    expect(report.limitations).toContainEqual(expect.objectContaining({
      code: 'CACHE_ACQUISITION_DETAILS_TRUNCATED',
      observed: 3,
      inspected: 3,
      detailed: 2,
    }));
    expect(report.limitations.find(
      ({ code }) => code === 'CACHE_ACQUISITION_DETAILS_TRUNCATED'
    )).not.toHaveProperty('kind');
  });

  it('reports bounded workspace detail without widening the legacy kind union', async () => {
    const workspaceRefs = ['1', '2', '3'].map((id, index) => ({
      ref: `refs/cas/workspaces/git-warp+materializations/v1-test-${id}`,
      oid: String(index + 1).repeat(40),
      symref: null,
    }));
    const ports = dependencies(repository({
      iterateRefs: vi.fn(() => values(workspaceRefs)),
    }));

    const report = await new RepositoryDoctor(ports).doctor({ maxCollectionsPerKind: 2 });

    expect(report.usage.workspaces.coverage).toEqual({
      observed: 3,
      inspected: 3,
      detailed: 2,
      complete: true,
    });
    expect(report.limitations).toContainEqual(expect.objectContaining({
      code: 'WORKSPACE_DETAILS_TRUNCATED',
      observed: 3,
      inspected: 3,
      detailed: 2,
    }));
    expect(report.limitations.find(
      ({ code }) => code === 'WORKSPACE_DETAILS_TRUNCATED'
    )).not.toHaveProperty('kind');
  });

  it('keeps repository health under acquisition clock skew and reports unknown age', async () => {
    const acquiredAt = '2026-07-13T13:00:00.000Z';
    const futureId = `v1-${Date.parse(acquiredAt)}-${'9'.repeat(64)}-${'8'.repeat(32)}`;
    const acquisitionRef =
      `refs/cas/cache-acquisitions/git-warp%2Fmaterializations/${futureId}`;
    const ports = dependencies(repository({
      iterateRefs: vi.fn(() => values([{
        ref: acquisitionRef,
        oid: 'a'.repeat(40),
        symref: null,
      }])),
    }));

    const report = await new RepositoryDoctor(ports).doctor();

    expect(report.healthy).toBe(true);
    expect(report.usage.acquisitions).toMatchObject({
      healthy: true,
      totals: {
        activeCount: 1,
        oldestAcquiredAt: acquiredAt,
        newestAcquiredAt: acquiredAt,
        maxAgeMs: null,
      },
      entries: [{
        id: futureId,
        acquiredAt,
        ageMs: null,
        healthy: true,
        issues: [{ code: 'CACHE_ACQUISITION_CLOCK_SKEW' }],
      }],
    });
  });

  it('marks symbolic acquisition refs unhealthy instead of offering a cleanup candidate', async () => {
    const acquisitionRef =
      `refs/cas/cache-acquisitions/git-warp%2Fmaterializations/${ACQUISITION_ID}`;
    const ports = dependencies(repository({
      iterateRefs: vi.fn(() => values([{
        ref: acquisitionRef,
        oid: 'a'.repeat(40),
        symref: 'refs/heads/main',
      }])),
    }));

    const report = await new RepositoryDoctor(ports).doctor();

    expect(report.healthy).toBe(false);
    expect(report.usage.acquisitions).toMatchObject({
      healthy: false,
      entries: [{
        ref: acquisitionRef,
        healthy: false,
        issues: [{ code: 'CACHE_ACQUISITION_INVALID' }],
      }],
    });
    expect(report.usage.acquisitions.entries[0]).not.toHaveProperty('id');
  });

  it('marks acquisition refs unhealthy when direct-ref evidence is unavailable', async () => {
    const acquisitionRef =
      `refs/cas/cache-acquisitions/git-warp%2Fmaterializations/${ACQUISITION_ID}`;
    const ports = dependencies(repository({
      iterateRefs: vi.fn(() => values([{
        ref: acquisitionRef,
        oid: 'a'.repeat(40),
      }])),
    }));

    const report = await new RepositoryDoctor(ports).doctor();

    expect(report.healthy).toBe(false);
    expect(report.usage.acquisitions).toMatchObject({
      healthy: false,
      entries: [{
        ref: acquisitionRef,
        healthy: false,
        issues: [{
          code: 'CACHE_ACQUISITION_INVALID',
          message: 'Cache acquisition direct-ref evidence is unavailable',
        }],
      }],
    });
    expect(report.usage.acquisitions.entries[0]).not.toHaveProperty('id');
  });

  it('returns kind-specific public shapes when managed collection inspection fails', async () => {
    const ports = dependencies();
    ports.caches.open.mockRejectedValue(new Error('cache failed'));
    ports.rootSets.open.mockRejectedValue(new Error('root set failed'));
    ports.expiringSets.open.mockRejectedValue(new Error('expiring set failed'));
    const doctor = new RepositoryDoctor(ports);

    const report = await doctor.doctor();

    expect(report.healthy).toBe(false);
    expect(report.usage.caches.entries[0]).toMatchObject({
      namespace: 'git-warp/materializations',
      healthy: false,
      logicalBytes: null,
      retention: null,
      age: null,
      expiry: null,
      policy: null,
    });
    expect(report.usage.rootSets.entries[0]).toMatchObject({
      healthy: false,
      retention: null,
    });
    expect(report.usage.rootSets.entries[0]).not.toHaveProperty('logicalBytes');
    expect(report.usage.rootSets.entries[0]).not.toHaveProperty('age');
    expect(report.usage.rootSets.entries[0]).not.toHaveProperty('expiry');
    expect(report.usage.rootSets.entries[0]).not.toHaveProperty('policy');
    expect(report.usage.expiringSets.entries[0]).toMatchObject({
      namespace: 'git-warp/replay',
      healthy: false,
      age: null,
      expiry: null,
    });
    expect(report.usage.expiringSets.entries[0]).not.toHaveProperty('logicalBytes');
    expect(report.usage.expiringSets.entries[0]).not.toHaveProperty('retention');
    expect(report.usage.expiringSets.entries[0]).not.toHaveProperty('policy');
    expect(report.usage.caches.entries[0].issues[0]).toMatchObject({
      code: 'REPOSITORY_INSPECTION_INVALID',
      message: 'cache failed',
    });
    expect(report.usage.rootSets.entries[0].issues[0].message).toBe('root set failed');
    expect(report.usage.expiringSets.entries[0].issues[0].message).toBe('expiring set failed');
  });

  it('reports private-vault entry attribution as unknown without requesting a key', async () => {
    const ports = dependencies();
    ports.vault.getVaultMetadata.mockResolvedValue({
      version: 1,
      privacy: { enabled: true },
    });
    const doctor = new RepositoryDoctor(ports);

    const report = await doctor.doctor();

    expect(report.usage.vault).toMatchObject({
      present: true,
      healthy: true,
      entryCount: null,
      privacy: true,
    });
    expect(ports.vault.readState).not.toHaveBeenCalled();
    expect(report.limitations).toContainEqual(
      expect.objectContaining({
        code: 'VAULT_ENTRY_COUNT_REQUIRES_KEY',
      })
    );
  });

  it('marks a non-atomic inventory as unknown when concurrent writes violate count invariants', async () => {
    const repositoryPort = repository({
      iterateReachableObjectIds: vi.fn(() =>
        values([
          '1'.repeat(40),
          '2'.repeat(40),
          '3'.repeat(40),
          '4'.repeat(40),
          '5'.repeat(40),
          '6'.repeat(40),
        ])
      ),
    });
    const doctor = new RepositoryDoctor(dependencies(repositoryPort));

    const report = await doctor.doctor();

    expect(report.healthy).toBe(false);
    expect(report.repository.objects.orphaned.objectCount).toBeNull();
    expect(report.repository.objects.unreachable.objectCount).toBeNull();
    expect(report.limitations).toContainEqual(
      expect.objectContaining({
        code: 'REPOSITORY_CHANGED_DURING_INSPECTION',
      })
    );
  });

  it('validates explicit expiry and collection bounds before opening Git streams', async () => {
    const ports = dependencies();
    const doctor = new RepositoryDoctor(ports);

    await expect(doctor.doctor({ expiresBefore: 'yesterday' })).rejects.toMatchObject({
      code: 'REPOSITORY_INSPECTION_INVALID',
    });
    await expect(doctor.doctor({ gracePeriodMs: -1 })).rejects.toMatchObject({
      code: 'REPOSITORY_INSPECTION_INVALID',
    });
    await expect(doctor.doctor({ gracePeriodMs: Number.MAX_SAFE_INTEGER })).rejects.toMatchObject({
      code: 'REPOSITORY_INSPECTION_INVALID',
    });
    await expect(
      doctor.doctor({ expiresBefore: NOW, gracePeriodMs: 1 })
    ).rejects.toMatchObject({
      code: 'REPOSITORY_INSPECTION_INVALID',
    });
    await expect(doctor.doctor({ maxCollectionsPerKind: 0 })).rejects.toMatchObject({
      code: 'REPOSITORY_INSPECTION_INVALID',
    });
    expect(ports.repository.iterateObjects).not.toHaveBeenCalled();
  });
});

describe('RepositoryDoctor workspace inventory', () => {
  it('reports workspace roots, bytes, age, expiry, and posture separately', async () => {
    const workspaceRef = 'refs/cas/workspaces/git-warp+materializations/v1-test-workspace';
    const ports = dependencies(repository({
      iterateRefs: vi.fn(() => values([
        { ref: workspaceRef, oid: '9'.repeat(40), symref: null },
      ])),
    }));

    const report = await new RepositoryDoctor(ports).doctor();

    expect(ports.workspaces.inspectRecord).toHaveBeenCalledWith({
      ref: workspaceRef,
      oid: '9'.repeat(40),
      symref: null,
    });
    expect(report.usage.workspaces).toMatchObject({
      healthy: true,
      coverage: { observed: 1, inspected: 1, detailed: 1, complete: true },
      totals: {
        entryCount: 1,
        logicalBytes: 10,
        rootObjectBytes: 4,
        activeWorkspaces: 1,
        expiredWorkspaces: 0,
      },
      entries: [
        {
          namespace: 'git-warp/materializations',
          ref: workspaceRef,
          generation: '9'.repeat(40),
          age: { createdAt: '2026-07-13T10:00:00.000Z', ageMs: 7_200_000 },
          expiry: { expiresAt: '2026-07-13T14:00:00.000Z', posture: 'active' },
        },
      ],
    });
  });
});

describe('RepositoryDoctor workspace failure evidence', () => {
  it('preserves the workspace report contract when inspection fails', async () => {
    const workspaceRef = 'refs/cas/workspaces/git-warp+materializations/v1-test-workspace';
    const ports = dependencies(repository({
      iterateRefs: vi.fn(() => values([
        { ref: workspaceRef, oid: '9'.repeat(40), symref: null },
      ])),
    }));
    ports.workspaces.inspectRecord.mockRejectedValue(new Error('inspection failed'));

    const report = await new RepositoryDoctor(ports).doctor();

    expect(report.usage.workspaces).toMatchObject({
      healthy: false,
      totals: {
        entryCount: null,
        logicalBytes: null,
        rootObjectBytes: null,
      },
      entries: [{
        namespace: null,
        ref: workspaceRef,
        logicalBytes: null,
        rootObjectBytes: null,
        physicalBytes: null,
        retention: null,
        issues: [{ message: 'inspection failed' }],
      }],
    });
  });
});

describe('RepositoryDoctor workspace issue health', () => {
  it('treats issue evidence as unhealthy even when the reported posture is active', async () => {
    const workspaceRef = 'refs/cas/workspaces/git-warp+materializations/v1-test-workspace';
    const ports = dependencies(repository({
      iterateRefs: vi.fn(() => values([
        { ref: workspaceRef, oid: '9'.repeat(40), symref: null },
      ])),
    }));
    ports.workspaces.inspectRecord.mockResolvedValue({
      id: 'workspace',
      namespace: 'git-warp/materializations',
      ref: workspaceRef,
      generation: '9'.repeat(40),
      symref: null,
      rootCount: 1,
      logicalBytes: 10,
      rootObjectBytes: 4,
      createdAt: '2026-07-13T10:00:00.000Z',
      ageMs: 7_200_000,
      expiresAt: '2026-07-13T14:00:00.000Z',
      posture: 'active',
      issue: { code: 'WORKSPACE_CONFLICT', message: 'generation changed' },
    });

    const report = await new RepositoryDoctor(ports).doctor();

    expect(report.healthy).toBe(false);
    expect(report.usage.workspaces).toMatchObject({
      healthy: false,
      entries: [{ healthy: false, issues: [{ code: 'WORKSPACE_CONFLICT' }] }],
    });
  });
});

describe('RepositoryDoctor workspace compatibility fallback', () => {
  it('keeps direct-constructor compatibility and reports missing workspace diagnostics', async () => {
    const workspaceRef = 'refs/cas/workspaces/git-warp+materializations/v1-test-workspace';
    const ports = dependencies(repository({
      iterateRefs: vi.fn(() => values([
        { ref: workspaceRef, oid: '9'.repeat(40), symref: null },
      ])),
    }));
    delete ports.workspaces;

    const report = await new RepositoryDoctor(ports).doctor();

    expect(report.healthy).toBe(false);
    expect(report.usage.workspaces.entries[0]).toMatchObject({
      healthy: false,
      issues: [{ code: 'REPOSITORY_INSPECTION_INVALID' }],
    });
  });
});
