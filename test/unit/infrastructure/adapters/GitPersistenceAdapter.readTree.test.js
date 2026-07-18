import { describe, it, expect, vi } from 'vitest';
import GitPersistenceAdapter from '../../../../src/infrastructure/adapters/GitPersistenceAdapter.js';
import CasError from '../../../../src/domain/errors/CasError.js';

/**
 * Create a mock plumbing that returns the given output for `execute`.
 */
function mockPlumbing(output) {
  return {
    execute: vi.fn().mockResolvedValue(output),
    executeStream: vi.fn(),
  };
}

/** Stub policy that just runs the fn directly. */
const noPolicy = { execute: (fn) => fn() };

/** Shorthand: create adapter whose plumbing returns `output`. */
function adapterFor(output) {
  return new GitPersistenceAdapter({ plumbing: mockPlumbing(output), policy: noPolicy });
}

function streamAdapterFor(chunks) {
  return new GitPersistenceAdapter({
    plumbing: {
      execute: vi.fn(),
      executeStream: vi.fn().mockResolvedValue((async function* outputStream() {
        for (const chunk of chunks) {
          yield Buffer.from(chunk);
        }
      })()),
    },
    policy: noPolicy,
  });
}

/** Expected shape for every entry. */
function entry(oid, name) {
  return { mode: '100644', type: 'blob', oid, name };
}

// ---------------------------------------------------------------------------
// Parsing – golden path, empty tree, spaces
// ---------------------------------------------------------------------------
describe('GitPersistenceAdapter.readTree() – parsing', () => {
  it('parses a typical ls-tree output with manifest and chunks', async () => {
    const output = [
      '100644 blob abc123def456\tmanifest.json',
      `100644 blob deadbeef1234\t${'a'.repeat(64)}`,
      `100644 blob cafebabe5678\t${'b'.repeat(64)}`,
    ].join('\0');

    const entries = await adapterFor(output).readTree('some-tree-oid');

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual(entry('abc123def456', 'manifest.json'));
    expect(entries[1]).toEqual(entry('deadbeef1234', 'a'.repeat(64)));
    expect(entries[2]).toEqual(entry('cafebabe5678', 'b'.repeat(64)));
  });

  it('returns [] for empty output', async () => {
    expect(await adapterFor('').readTree('empty-tree')).toEqual([]);
  });

  it('returns [] for NUL-only output', async () => {
    expect(await adapterFor('\0').readTree('empty-tree')).toEqual([]);
  });

  it('handles filenames with spaces', async () => {
    const output = '100644 blob abc123\tfile with spaces.txt\0';
    const entries = await adapterFor(output).readTree('tree-oid');
    expect(entries[0].name).toBe('file with spaces.txt');
  });
});

describe('GitPersistenceAdapter.readTreeEntry() – path lookup', () => {
  it('returns one tree entry for the requested path', async () => {
    const adapter = adapterFor('040000 tree abc123\tdemo%2Fhello\0');

    await expect(adapter.readTreeEntry('tree-oid', 'demo%2Fhello')).resolves.toEqual({
      mode: '040000',
      type: 'tree',
      oid: 'abc123',
      name: 'demo%2Fhello',
    });
  });

  it('returns null when git finds no matching path', async () => {
    await expect(adapterFor('').readTreeEntry('tree-oid', 'missing')).resolves.toBeNull();
  });

  it('coalesces repeated immutable path reads and isolates returned records', async () => {
    const plumbing = mockPlumbing('040000 tree abc123\tdemo%2Fhello\0');
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    const first = await adapter.readTreeEntry('tree-oid', 'demo%2Fhello');
    first.name = 'mutated';
    const second = await adapter.readTreeEntry('tree-oid', 'demo%2Fhello');

    expect(second.name).toBe('demo%2Fhello');
    expect(plumbing.execute).toHaveBeenCalledTimes(1);
  });

  it('does not retain failed path reads', async () => {
    const plumbing = mockPlumbing('040000 tree abc123\tdemo%2Fhello\0');
    plumbing.execute.mockRejectedValueOnce(new Error('transient read failure'));
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.readTreeEntry('tree-oid', 'demo%2Fhello'))
      .rejects.toThrow('transient read failure');
    await expect(adapter.readTreeEntry('tree-oid', 'demo%2Fhello'))
      .resolves.toMatchObject({ oid: 'abc123' });
    expect(plumbing.execute).toHaveBeenCalledTimes(2);
  });
});

describe('GitPersistenceAdapter.readObjectType()', () => {
  it('reads type without materializing the object', async () => {
    const oid = 'a'.repeat(40);
    const plumbing = mockPlumbing(`${oid} tree 42`);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.readObjectType(oid)).resolves.toBe('tree');
    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
      input: `${oid}\n`,
    });
  });

  it('normalizes Git batch missing-object responses', async () => {
    const oid = 'f'.repeat(40);
    const adapter = adapterFor(`${oid} missing`);

    await expect(adapter.readObjectType(oid))
      .rejects.toMatchObject({ code: 'GIT_OBJECT_NOT_FOUND' });
  });

  it('preserves non-missing inspection failures', async () => {
    const denied = new Error('permission denied');
    const plumbing = { execute: vi.fn().mockRejectedValue(denied) };
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.readObjectType('f'.repeat(40))).rejects.toBe(denied);
  });
});

describe('GitPersistenceAdapter immutable metadata cache', () => {
  it('coalesces concurrent and sequential metadata reads by immutable OID', async () => {
    const oid = 'a'.repeat(40);
    let resolveInspection;
    const inspection = new Promise((resolve) => {
      resolveInspection = resolve;
    });
    const plumbing = mockPlumbing();
    plumbing.execute.mockReturnValue(inspection);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    const type = adapter.readObjectType(oid);
    const size = adapter.readObjectSize(oid);
    resolveInspection(`${oid} blob 42`);

    await expect(type).resolves.toBe('blob');
    await expect(size).resolves.toBe(42);
    await expect(adapter.readObjectType(oid)).resolves.toBe('blob');
    expect(plumbing.execute).toHaveBeenCalledTimes(1);
  });

  it('retries failed metadata reads instead of caching rejection', async () => {
    const oid = 'b'.repeat(40);
    const plumbing = mockPlumbing(`${oid} tree 12`);
    plumbing.execute.mockRejectedValueOnce(new Error('transient metadata failure'));
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.readObjectType(oid)).rejects.toThrow('transient metadata failure');
    await expect(adapter.readObjectType(oid)).resolves.toBe('tree');
    expect(plumbing.execute).toHaveBeenCalledTimes(2);
  });
});

describe('GitPersistenceAdapter metadata cache residency', () => {
  it('rejects an invalid metadata cache bound', () => {
    expect(() => new GitPersistenceAdapter({
      plumbing: mockPlumbing(),
      policy: noPolicy,
      metadataCacheEntries: 0,
    })).toThrow(expect.objectContaining({
      code: 'INVALID_OPTIONS',
      meta: { option: 'metadataCacheEntries', metadataCacheEntries: 0 },
    }));
  });

  it('evicts least-recently-used object metadata at its configured bound', async () => {
    const oids = ['a', 'b', 'c'].map((value) => value.repeat(40));
    const plumbing = mockPlumbing();
    plumbing.execute.mockImplementation(({ input }) => {
      const oid = input.trim();
      return Promise.resolve(`${oid} blob 1`);
    });
    const adapter = new GitPersistenceAdapter({
      plumbing,
      policy: noPolicy,
      metadataCacheEntries: 2,
    });

    await adapter.readObjectType(oids[0]);
    await adapter.readObjectType(oids[1]);
    await adapter.readObjectType(oids[0]);
    await adapter.readObjectType(oids[2]);
    await adapter.readObjectType(oids[1]);

    expect(plumbing.execute).toHaveBeenCalledTimes(4);
  });
});

describe('GitPersistenceAdapter.readObjectSize()', () => {
  it('reads a safe byte size without materializing the object', async () => {
    const oid = 'a'.repeat(40);
    const plumbing = mockPlumbing(`${oid} blob 42`);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.readObjectSize(oid)).resolves.toBe(42);
    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
      input: `${oid}\n`,
    });
    expect(plumbing.executeStream).not.toHaveBeenCalled();
  });

  it('rejects malformed Git size output', async () => {
    await expect(adapterFor('not-a-size').readObjectSize('a'.repeat(40))).rejects.toMatchObject({
      code: 'GIT_ERROR',
    });
  });
});

describe('GitPersistenceAdapter.iterateTree() – streaming', () => {
  it('parses NUL-delimited tree entries across stream chunk boundaries', async () => {
    const adapter = streamAdapterFor([
      '100644 blob abc123\tmanifest',
      '.json\0',
      '040000 tree def456\tdemo%2Fhello\0',
    ]);
    const entries = [];

    for await (const parsed of adapter.iterateTree('tree-oid')) {
      entries.push(parsed);
    }

    expect(entries).toEqual([
      { mode: '100644', type: 'blob', oid: 'abc123', name: 'manifest.json' },
      { mode: '040000', type: 'tree', oid: 'def456', name: 'demo%2Fhello' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Errors – malformed output + plumbing error propagation
// ---------------------------------------------------------------------------
describe('GitPersistenceAdapter.readTree() – errors', () => {
  it('throws TREE_PARSE_ERROR when entry has no tab', async () => {
    const adapter = adapterFor('100644 blob abc123 no-tab-here\0');

    await expect(adapter.readTree('bad-tree')).rejects.toThrow(CasError);
    try {
      await adapter.readTree('bad-tree');
    } catch (err) {
      expect(err.code).toBe('TREE_PARSE_ERROR');
    }
  });

  it('throws TREE_PARSE_ERROR when metadata has wrong number of fields', async () => {
    const adapter = adapterFor('100644 blob\tmanifest.json\0');

    await expect(adapter.readTree('bad-tree')).rejects.toThrow(CasError);
    try {
      await adapter.readTree('bad-tree');
    } catch (err) {
      expect(err.code).toBe('TREE_PARSE_ERROR');
    }
  });

  it('propagates plumbing errors', async () => {
    const plumbing = {
      execute: vi.fn().mockRejectedValue(new Error('git failed')),
      executeStream: vi.fn(),
    };
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.readTree('bad-oid')).rejects.toThrow('git failed');
  });
});

// ---------------------------------------------------------------------------
// Fuzz – 1000 synthetic entries
// ---------------------------------------------------------------------------
describe('GitPersistenceAdapter.readTree() – fuzz', () => {
  it('parses 1000 synthetic entries', async () => {
    const lines = [];
    for (let i = 0; i < 1000; i++) {
      const oid = i.toString(16).padStart(40, '0');
      lines.push(`100644 blob ${oid}\tchunk-${i}`);
    }
    const output = lines.join('\0');
    const entries = await adapterFor(output).readTree('big-tree');
    expect(entries).toHaveLength(1000);
    expect(entries[0].name).toBe('chunk-0');
    expect(entries[999].name).toBe('chunk-999');
  });
});
