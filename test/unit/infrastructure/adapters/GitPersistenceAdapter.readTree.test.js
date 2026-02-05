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
