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

describe('GitPersistenceAdapter.readTree()', () => {
  // ---------------------------------------------------------------------------
  // Golden path
  // ---------------------------------------------------------------------------
  it('parses a typical ls-tree output with manifest and chunks', async () => {
    const output = [
      '100644 blob abc123def456\tmanifest.json',
      '100644 blob deadbeef1234\t' + 'a'.repeat(64),
      '100644 blob cafebabe5678\t' + 'b'.repeat(64),
    ].join('\n');

    const adapter = new GitPersistenceAdapter({
      plumbing: mockPlumbing(output),
      policy: noPolicy,
    });

    const entries = await adapter.readTree('some-tree-oid');

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      mode: '100644',
      type: 'blob',
      oid: 'abc123def456',
      name: 'manifest.json',
    });
    expect(entries[1]).toEqual({
      mode: '100644',
      type: 'blob',
      oid: 'deadbeef1234',
      name: 'a'.repeat(64),
    });
    expect(entries[2]).toEqual({
      mode: '100644',
      type: 'blob',
      oid: 'cafebabe5678',
      name: 'b'.repeat(64),
    });
  });

  // ---------------------------------------------------------------------------
  // Empty tree
  // ---------------------------------------------------------------------------
  it('returns [] for empty output', async () => {
    const adapter = new GitPersistenceAdapter({
      plumbing: mockPlumbing(''),
      policy: noPolicy,
    });

    const entries = await adapter.readTree('empty-tree');
    expect(entries).toEqual([]);
  });

  it('returns [] for whitespace-only output', async () => {
    const adapter = new GitPersistenceAdapter({
      plumbing: mockPlumbing('   \n'),
      policy: noPolicy,
    });

    const entries = await adapter.readTree('empty-tree');
    expect(entries).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Filename with spaces (tab delimiter)
  // ---------------------------------------------------------------------------
  it('handles filenames with spaces', async () => {
    const output = '100644 blob abc123\tfile with spaces.txt';
    const adapter = new GitPersistenceAdapter({
      plumbing: mockPlumbing(output),
      policy: noPolicy,
    });

    const entries = await adapter.readTree('tree-oid');
    expect(entries[0].name).toBe('file with spaces.txt');
  });

  // ---------------------------------------------------------------------------
  // Malformed output
  // ---------------------------------------------------------------------------
  it('throws TREE_PARSE_ERROR when line has no tab', async () => {
    const output = '100644 blob abc123 no-tab-here';
    const adapter = new GitPersistenceAdapter({
      plumbing: mockPlumbing(output),
      policy: noPolicy,
    });

    await expect(adapter.readTree('bad-tree')).rejects.toThrow(CasError);
    try {
      await adapter.readTree('bad-tree');
    } catch (err) {
      expect(err.code).toBe('TREE_PARSE_ERROR');
    }
  });

  it('throws TREE_PARSE_ERROR when metadata has wrong number of fields', async () => {
    const output = '100644 blob\tmanifest.json'; // only 2 fields before tab
    const adapter = new GitPersistenceAdapter({
      plumbing: mockPlumbing(output),
      policy: noPolicy,
    });

    await expect(adapter.readTree('bad-tree')).rejects.toThrow(CasError);
    try {
      await adapter.readTree('bad-tree');
    } catch (err) {
      expect(err.code).toBe('TREE_PARSE_ERROR');
    }
  });

  // ---------------------------------------------------------------------------
  // Fuzz: 1000 entries
  // ---------------------------------------------------------------------------
  it('parses 1000 synthetic entries', async () => {
    const lines = [];
    for (let i = 0; i < 1000; i++) {
      const oid = i.toString(16).padStart(40, '0');
      lines.push(`100644 blob ${oid}\tchunk-${i}`);
    }
    const output = lines.join('\n');

    const adapter = new GitPersistenceAdapter({
      plumbing: mockPlumbing(output),
      policy: noPolicy,
    });

    const entries = await adapter.readTree('big-tree');
    expect(entries).toHaveLength(1000);
    expect(entries[0].name).toBe('chunk-0');
    expect(entries[999].name).toBe('chunk-999');
  });

  // ---------------------------------------------------------------------------
  // Plumbing error propagation
  // ---------------------------------------------------------------------------
  it('propagates plumbing errors', async () => {
    const plumbing = {
      execute: vi.fn().mockRejectedValue(new Error('git failed')),
      executeStream: vi.fn(),
    };
    const adapter = new GitPersistenceAdapter({
      plumbing,
      policy: noPolicy,
    });

    await expect(adapter.readTree('bad-oid')).rejects.toThrow('git failed');
  });
});
