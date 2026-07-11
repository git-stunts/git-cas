import { describe, expect, it, vi } from 'vitest';
import RootSet from '../../../../src/domain/services/RootSet.js';
import { CasError, ErrorCodes } from '../../../../src/domain/errors/index.js';

const REF = 'refs/cas/rootsets/warp/state-cache';
const ENTRY = {
  name: 'snapshot:one',
  oid: 'a'.repeat(40),
  type: 'tree',
  retention: 'evictable',
};

function emptyState() {
  return { ref: REF, headOid: null, treeOid: null, entries: [] };
}

describe('RootSet mutations', () => {
  it('puts, lists, and removes named entries', async () => {
    let state = emptyState();
    const persistence = {
      read: vi.fn(async () => state),
      write: vi.fn(async ({ entries }) => {
        state = { ref: REF, headOid: 'b'.repeat(40), treeOid: 'c'.repeat(40), entries };
        return { commitOid: state.headOid, treeOid: state.treeOid };
      }),
      resolveRefOnly: vi.fn(),
      inspectTargets: vi.fn(),
    };
    const rootSet = new RootSet({ ref: REF, persistence });

    await rootSet.put(ENTRY);
    await expect(rootSet.contains(ENTRY.name)).resolves.toBe(true);
    await expect(rootSet.list()).resolves.toEqual([ENTRY]);

    const result = await rootSet.remove({ name: ENTRY.name });
    expect(result.removed).toEqual(ENTRY);
    await expect(rootSet.list()).resolves.toEqual([]);
  });

  it('replaces the current set with exactly the supplied entries', async () => {
    const persistence = {
      read: vi.fn().mockResolvedValue({
        ...emptyState(),
        headOid: 'a'.repeat(40),
        entries: [ENTRY],
      }),
      write: vi.fn().mockResolvedValue({
        commitOid: 'b'.repeat(40),
        treeOid: 'c'.repeat(40),
      }),
      resolveRefOnly: vi.fn(),
      inspectTargets: vi.fn(),
    };
    const rootSet = new RootSet({ ref: REF, persistence });
    const replacement = { ...ENTRY, name: 'snapshot:replacement' };

    await rootSet.replace({ entries: [replacement] });

    expect(persistence.write).toHaveBeenCalledWith(expect.objectContaining({
      entries: [replacement],
      expectedHeadOid: 'a'.repeat(40),
    }));
  });

});

describe('RootSet expected-head conflicts', () => {
  it('rejects a stale expected head before replacing authoritative state', async () => {
    const persistence = {
      read: vi.fn().mockResolvedValue({
        ...emptyState(),
        headOid: 'e'.repeat(40),
        entries: [ENTRY],
      }),
      write: vi.fn(),
      resolveRefOnly: vi.fn(),
      inspectTargets: vi.fn(),
    };
    const rootSet = new RootSet({ ref: REF, persistence });

    await expect(rootSet.replace({
      entries: [],
      expectedHeadOid: 'd'.repeat(40),
    })).rejects.toMatchObject({
      code: 'ROOT_SET_CONFLICT',
      meta: {
        expectedHeadOid: 'd'.repeat(40),
        actualHeadOid: 'e'.repeat(40),
      },
    });
    expect(persistence.write).not.toHaveBeenCalled();
  });
});

describe('RootSet guarded write conflicts', () => {
  it('does not retry a guarded mutate after a write conflict', async () => {
    const persistence = {
      read: vi.fn().mockResolvedValue({
        ...emptyState(),
        headOid: 'e'.repeat(40),
      }),
      write: vi.fn().mockRejectedValue(new CasError(
        'Concurrent root-set update detected',
        ErrorCodes.ROOT_SET_CONFLICT,
      )),
      resolveRefOnly: vi.fn(),
      inspectTargets: vi.fn(),
    };
    const rootSet = new RootSet({
      ref: REF,
      persistence,
      retry: { maxAttempts: 3, baseDelayMs: 0 },
    });

    await expect(rootSet.mutate(
      (entries) => [...entries, ENTRY],
      { expectedHeadOid: 'e'.repeat(40) },
    )).rejects.toMatchObject({ code: 'ROOT_SET_CONFLICT' });
    expect(persistence.read).toHaveBeenCalledTimes(1);
    expect(persistence.write).toHaveBeenCalledTimes(1);
  });
});

describe('RootSet retryable conflicts', () => {
  it('re-reads and retries after a compare-and-swap conflict', async () => {
    const concurrentEntry = {
      name: 'snapshot:concurrent',
      oid: 'd'.repeat(40),
      type: 'tree',
      retention: 'pinned',
    };
    const persistence = {
      read: vi.fn()
        .mockResolvedValueOnce(emptyState())
        .mockResolvedValueOnce({
          ref: REF,
          headOid: 'e'.repeat(40),
          treeOid: 'f'.repeat(40),
          entries: [concurrentEntry],
        }),
      write: vi.fn()
        .mockRejectedValueOnce(new CasError(
          'Concurrent root-set update detected',
          ErrorCodes.ROOT_SET_CONFLICT,
        ))
        .mockResolvedValueOnce({ commitOid: '1'.repeat(40), treeOid: '2'.repeat(40) }),
      resolveRefOnly: vi.fn(),
      inspectTargets: vi.fn(),
    };
    const rootSet = new RootSet({
      ref: REF,
      persistence,
      retry: { maxAttempts: 2, baseDelayMs: 0 },
    });

    await rootSet.put(ENTRY);

    expect(persistence.write).toHaveBeenCalledTimes(2);
    expect(persistence.write.mock.calls[1][0].entries).toEqual([concurrentEntry, ENTRY]);
  });
});

describe('RootSet doctor and repair', () => {
  it('reports corrupt state and repairs from authoritative entries', async () => {
    const invalid = new CasError('Root-set metadata is malformed', ErrorCodes.ROOT_SET_METADATA_INVALID);
    const persistence = {
      read: vi.fn().mockRejectedValue(invalid),
      write: vi.fn().mockResolvedValue({ commitOid: 'b'.repeat(40), treeOid: 'c'.repeat(40) }),
      resolveRefOnly: vi.fn().mockResolvedValue('a'.repeat(40)),
      inspectTargets: vi.fn(),
    };
    const rootSet = new RootSet({ ref: REF, persistence });

    await expect(rootSet.doctor()).resolves.toMatchObject({
      healthy: false,
      ref: REF,
      error: { code: 'ROOT_SET_METADATA_INVALID' },
    });

    await expect(rootSet.repair({ entries: [ENTRY] })).resolves.toMatchObject({
      repaired: true,
      commitOid: 'b'.repeat(40),
    });
    expect(persistence.write).toHaveBeenCalledWith(expect.objectContaining({
      entries: [ENTRY],
      expectedHeadOid: 'a'.repeat(40),
    }));
  });

});

describe('RootSet healthy doctor report', () => {
  it('separates retention policy from Git reachability', async () => {
    const persistence = {
      read: vi.fn().mockResolvedValue({
        ref: REF,
        headOid: 'a'.repeat(40),
        treeOid: 'b'.repeat(40),
        entries: [ENTRY],
      }),
      write: vi.fn(),
      resolveRefOnly: vi.fn(),
      inspectTargets: vi.fn().mockResolvedValue({
        healthy: true,
        targets: [{ ...ENTRY, exists: true, actualType: 'tree', reachability: 'anchored' }],
        issues: [],
      }),
    };
    const rootSet = new RootSet({ ref: REF, persistence });

    await expect(rootSet.doctor()).resolves.toMatchObject({
      healthy: true,
      policyCounts: { pinned: 0, evictable: 1 },
      reachabilityCounts: {
        anchored: 1,
        missing: 0,
        unknown: 0,
        orphaned: 0,
        volatile: 0,
      },
    });
  });

});

describe('RootSet unhealthy target report', () => {
  it('reports targets that disappeared after the snapshot was written', async () => {
    const persistence = {
      read: vi.fn().mockResolvedValue({
        ref: REF,
        headOid: 'a'.repeat(40),
        treeOid: 'b'.repeat(40),
        entries: [ENTRY],
      }),
      write: vi.fn(),
      resolveRefOnly: vi.fn(),
      inspectTargets: vi.fn().mockResolvedValue({
        healthy: false,
        targets: [{ ...ENTRY, exists: false, actualType: null, reachability: 'missing' }],
        issues: [{ code: 'ROOT_SET_TARGET_MISSING', name: ENTRY.name, oid: ENTRY.oid }],
      }),
    };
    const rootSet = new RootSet({ ref: REF, persistence });

    await expect(rootSet.doctor()).resolves.toMatchObject({
      healthy: false,
      reachabilityCounts: { anchored: 0, missing: 1 },
      issues: [{ code: 'ROOT_SET_TARGET_MISSING', oid: ENTRY.oid }],
    });
  });
});
