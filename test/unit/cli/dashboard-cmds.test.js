import { describe, it, expect, vi } from 'vitest';
import { readSourceEntries } from '../../../bin/ui/dashboard-cmds.js';

function makePersistence(overrides = {}) {
  return {
    readBlob: vi.fn(),
    plumbing: { execute: vi.fn() },
    ...overrides,
  };
}

function makeRefPort(overrides = {}) {
  return {
    resolveRef: vi.fn(),
    resolveTree: vi.fn(),
    ...overrides,
  };
}

describe('readSourceEntries vault and oid modes', () => {
  it('loads vault entries through the vault service facade', async () => {
    const entries = [{ slug: 'alpha', treeOid: 'deadbeef' }];
    const metadata = { version: 1 };
    const cas = {
      listVault: vi.fn().mockResolvedValue(entries),
      getVaultMetadata: vi.fn().mockResolvedValue(metadata),
    };

    await expect(readSourceEntries(cas, { type: 'vault' })).resolves.toEqual({ entries, metadata });
  });

  it('builds a single entry for a direct tree oid source', async () => {
    const cas = {};

    await expect(
      readSourceEntries(cas, { type: 'oid', treeOid: '0123456789abcdef' }),
    ).resolves.toEqual({
      entries: [{ slug: 'oid:0123456789ab', treeOid: '0123456789abcdef' }],
      metadata: null,
    });
  });
});

describe('readSourceEntries ref tree resolution', () => {
  it('treats a ref that resolves directly to a CAS tree as a single source entry', async () => {
    const persistence = makePersistence();
    const ref = makeRefPort({
      resolveRef: vi.fn().mockResolvedValue('tree-oid-123'),
    });
    const cas = {
      readManifest: vi.fn().mockResolvedValue({ slug: 'alpha' }),
      getService: vi.fn().mockResolvedValue({ persistence }),
      getVaultService: vi.fn().mockResolvedValue({ ref }),
    };

    await expect(
      readSourceEntries(cas, { type: 'ref', ref: 'refs/apps/direct' }),
    ).resolves.toEqual({
      entries: [{ slug: 'refs/apps/direct', treeOid: 'tree-oid-123' }],
      metadata: null,
    });
    expect(persistence.readBlob).not.toHaveBeenCalled();
  });
});

describe('readSourceEntries ref-backed JSON indexes', () => {
  it('extracts tree oids from a ref-backed JSON index blob', async () => {
    const persistence = makePersistence({
      readBlob: vi.fn().mockResolvedValue(Buffer.from(JSON.stringify({
        schemaVersion: 1,
        entries: {
          'v1:t10-bbb': { treeOid: 'tree-bbb' },
          'v1:t20-aaa': { treeOid: 'tree-aaa' },
        },
      }))),
    });
    const ref = makeRefPort({
      resolveRef: vi.fn().mockResolvedValue('blob-oid'),
      resolveTree: vi.fn().mockRejectedValue(new Error('not a commit')),
    });
    const cas = {
      readManifest: vi.fn().mockRejectedValue(new Error('not a manifest')),
      getService: vi.fn().mockResolvedValue({ persistence }),
      getVaultService: vi.fn().mockResolvedValue({ ref }),
    };

    await expect(
      readSourceEntries(cas, { type: 'ref', ref: 'refs/warp/demo/seek-cache' }),
    ).resolves.toEqual({
      entries: [
        { slug: 'v1:t10-bbb', treeOid: 'tree-bbb' },
        { slug: 'v1:t20-aaa', treeOid: 'tree-aaa' },
      ],
      metadata: null,
    });
  });
});

describe('readSourceEntries commit message hints', () => {
  it('extracts a manifest tree hint from a ref-target commit message', async () => {
    const persistence = makePersistence({
      readBlob: vi.fn().mockRejectedValue(new Error('not a blob')),
      plumbing: {
        execute: vi.fn().mockResolvedValue('asset:image.png\n\nmanifest: feedfacecafebeef\n'),
      },
    });
    const ref = makeRefPort({
      resolveRef: vi.fn().mockResolvedValue('commit-oid'),
      resolveTree: vi.fn().mockRejectedValue(new Error('not a cas tree')),
    });
    const cas = {
      readManifest: vi.fn().mockRejectedValue(new Error('not a manifest')),
      getService: vi.fn().mockResolvedValue({ persistence }),
      getVaultService: vi.fn().mockResolvedValue({ ref }),
    };

    await expect(
      readSourceEntries(cas, { type: 'ref', ref: 'refs/git-cms/chunks/logo@current' }),
    ).resolves.toEqual({
      entries: [{ slug: 'refs/git-cms/chunks/logo@current', treeOid: 'feedfacecafebeef' }],
      metadata: null,
    });
  });
});
