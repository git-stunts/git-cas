import { describe, it, expect, vi, beforeEach } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';
import { digestOf } from '../../../helpers/crypto.js';

/**
 * Shared factory: builds the standard test fixtures.
 */
function setup() {
  const mockPersistence = {
    writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn(),
    readTree: vi.fn(),
  };
  const service = new CasService({
    persistence: mockPersistence,
    crypto: new NodeCryptoAdapter(),
    codec: new JsonCodec(),
    chunkSize: 1024,
  });
  return { mockPersistence, service };
}

/**
 * Helper: creates a valid manifest JSON structure.
 */
function manifestJson({ slug, filename, size, chunks }) {
  return {
    slug,
    filename,
    size,
    chunks,
  };
}

/**
 * Helper: creates a chunk object with all required fields.
 */
function chunk(index, seed, blobOid) {
  return {
    index,
    size: 1024,
    digest: digestOf(seed),
    blob: blobOid,
  };
}

// ---------------------------------------------------------------------------
// findOrphanedChunks – golden path
// ---------------------------------------------------------------------------
describe('CasService – findOrphanedChunks – golden path', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('collects all unique blob OIDs from a single manifest', async () => {
    const manifest = manifestJson({
      slug: 'asset-1',
      filename: 'file.bin',
      size: 2048,
      chunks: [
        chunk(0, 'chunk-0', 'blob-oid-1'),
        chunk(1, 'chunk-1', 'blob-oid-2'),
      ],
    });

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid-1', name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockResolvedValue(
      Buffer.from(JSON.stringify(manifest)),
    );

    const result = await service.findOrphanedChunks({ treeOids: ['tree-1'] });

    expect(result.referenced.size).toBe(2);
    expect(result.referenced.has('blob-oid-1')).toBe(true);
    expect(result.referenced.has('blob-oid-2')).toBe(true);
    expect(result.total).toBe(2);
  });

  it('deduplicates shared chunk OIDs across multiple manifests', async () => {
    const manifest1 = manifestJson({
      slug: 'asset-1',
      filename: 'file1.bin',
      size: 2048,
      chunks: [
        chunk(0, 'chunk-0', 'blob-shared'),
        chunk(1, 'chunk-1', 'blob-unique-1'),
      ],
    });

    const manifest2 = manifestJson({
      slug: 'asset-2',
      filename: 'file2.bin',
      size: 2048,
      chunks: [
        chunk(0, 'chunk-0', 'blob-shared'),
        chunk(1, 'chunk-2', 'blob-unique-2'),
      ],
    });

    mockPersistence.readTree
      .mockResolvedValueOnce([
        { mode: '100644', type: 'blob', oid: 'manifest-oid-1', name: 'manifest.json' },
      ])
      .mockResolvedValueOnce([
        { mode: '100644', type: 'blob', oid: 'manifest-oid-2', name: 'manifest.json' },
      ]);

    mockPersistence.readBlob
      .mockResolvedValueOnce(Buffer.from(JSON.stringify(manifest1)))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify(manifest2)));

    const result = await service.findOrphanedChunks({
      treeOids: ['tree-1', 'tree-2'],
    });

    // 3 unique blobs: blob-shared, blob-unique-1, blob-unique-2
    expect(result.referenced.size).toBe(3);
    expect(result.referenced.has('blob-shared')).toBe(true);
    expect(result.referenced.has('blob-unique-1')).toBe(true);
    expect(result.referenced.has('blob-unique-2')).toBe(true);
    // Total counts all chunks: 2 + 2 = 4
    expect(result.total).toBe(4);
  });

  it('counts total correctly even when all chunks are identical', async () => {
    const manifest1 = manifestJson({
      slug: 'asset-1',
      filename: 'file1.bin',
      size: 1024,
      chunks: [chunk(0, 'chunk-0', 'blob-same')],
    });

    const manifest2 = manifestJson({
      slug: 'asset-2',
      filename: 'file2.bin',
      size: 1024,
      chunks: [chunk(0, 'chunk-0', 'blob-same')],
    });

    const manifest3 = manifestJson({
      slug: 'asset-3',
      filename: 'file3.bin',
      size: 1024,
      chunks: [chunk(0, 'chunk-0', 'blob-same')],
    });

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);

    mockPersistence.readBlob
      .mockResolvedValueOnce(Buffer.from(JSON.stringify(manifest1)))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify(manifest2)))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify(manifest3)));

    const result = await service.findOrphanedChunks({
      treeOids: ['tree-1', 'tree-2', 'tree-3'],
    });

    // Only 1 unique blob
    expect(result.referenced.size).toBe(1);
    expect(result.referenced.has('blob-same')).toBe(true);
    // Total counts all instances: 3
    expect(result.total).toBe(3);
  });

  it('handles manifest with no chunks', async () => {
    const manifest = manifestJson({
      slug: 'empty-asset',
      filename: 'empty.bin',
      size: 0,
      chunks: [],
    });

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockResolvedValue(
      Buffer.from(JSON.stringify(manifest)),
    );

    const result = await service.findOrphanedChunks({ treeOids: ['tree-1'] });

    expect(result.referenced.size).toBe(0);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findOrphanedChunks – edge cases
// ---------------------------------------------------------------------------
describe('CasService – findOrphanedChunks – edge cases', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('returns empty set and zero total for empty treeOids array', async () => {
    const result = await service.findOrphanedChunks({ treeOids: [] });

    expect(result.referenced.size).toBe(0);
    expect(result.total).toBe(0);
    // Should never call readTree or readBlob
    expect(mockPersistence.readTree).not.toHaveBeenCalled();
    expect(mockPersistence.readBlob).not.toHaveBeenCalled();
  });

  it('processes single treeOid with large manifest', async () => {
    const chunks = [];
    for (let i = 0; i < 100; i++) {
      chunks.push(chunk(i, `chunk-${i}`, `blob-oid-${i}`));
    }

    const manifest = manifestJson({
      slug: 'large-asset',
      filename: 'large.bin',
      size: 102400,
      chunks,
    });

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockResolvedValue(
      Buffer.from(JSON.stringify(manifest)),
    );

    const result = await service.findOrphanedChunks({ treeOids: ['tree-large'] });

    expect(result.referenced.size).toBe(100);
    expect(result.total).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// findOrphanedChunks – stress test
// ---------------------------------------------------------------------------
describe('CasService – findOrphanedChunks – stress test', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('handles 10 manifests with 10 chunks each, some shared', async () => {
    const treeOids = [];
    const manifests = [];

    // Create 10 manifests
    for (let m = 0; m < 10; m++) {
      const chunks = [];
      for (let c = 0; c < 10; c++) {
        // First 5 chunks are shared across all manifests
        // Last 5 chunks are unique to each manifest
        const blobOid = c < 5 ? `blob-shared-${c}` : `blob-m${m}-c${c}`;
        chunks.push(chunk(c, `chunk-m${m}-c${c}`, blobOid));
      }

      manifests.push(
        manifestJson({
          slug: `asset-${m}`,
          filename: `file-${m}.bin`,
          size: 10240,
          chunks,
        }),
      );

      treeOids.push(`tree-${m}`);
    }

    // Mock readTree to always return a manifest entry
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);

    // Mock readBlob to return the appropriate manifest
    manifests.forEach((manifest) => {
      mockPersistence.readBlob.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(manifest)),
      );
    });

    const result = await service.findOrphanedChunks({ treeOids });

    // Unique blobs:
    // - 5 shared blobs (blob-shared-0 to blob-shared-4)
    // - 50 unique blobs (5 per manifest × 10 manifests)
    // Total: 55 unique blobs
    expect(result.referenced.size).toBe(55);

    // Verify shared blobs are present
    for (let c = 0; c < 5; c++) {
      expect(result.referenced.has(`blob-shared-${c}`)).toBe(true);
    }

    // Verify some unique blobs are present
    expect(result.referenced.has('blob-m0-c5')).toBe(true);
    expect(result.referenced.has('blob-m9-c9')).toBe(true);

    // Total chunks: 10 manifests × 10 chunks = 100
    expect(result.total).toBe(100);

    // Verify readTree was called 10 times
    expect(mockPersistence.readTree).toHaveBeenCalledTimes(10);
    // Verify readBlob was called 10 times (once per manifest)
    expect(mockPersistence.readBlob).toHaveBeenCalledTimes(10);
  });

  it('handles many manifests with complete overlap', async () => {
    const treeOids = [];
    const manifest = manifestJson({
      slug: 'shared-asset',
      filename: 'shared.bin',
      size: 3072,
      chunks: [
        chunk(0, 'chunk-0', 'blob-a'),
        chunk(1, 'chunk-1', 'blob-b'),
        chunk(2, 'chunk-2', 'blob-c'),
      ],
    });

    // Create 20 identical tree references
    for (let i = 0; i < 20; i++) {
      treeOids.push(`tree-${i}`);
    }

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);

    // Return the same manifest for all reads
    mockPersistence.readBlob.mockResolvedValue(
      Buffer.from(JSON.stringify(manifest)),
    );

    const result = await service.findOrphanedChunks({ treeOids });

    // Only 3 unique blobs despite 20 manifests
    expect(result.referenced.size).toBe(3);
    expect(result.referenced.has('blob-a')).toBe(true);
    expect(result.referenced.has('blob-b')).toBe(true);
    expect(result.referenced.has('blob-c')).toBe(true);

    // Total: 20 manifests × 3 chunks = 60
    expect(result.total).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// findOrphanedChunks – failures (fail closed)
// ---------------------------------------------------------------------------
describe('CasService – findOrphanedChunks – failures', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('throws MANIFEST_NOT_FOUND when first treeOid has no manifest', async () => {
    // readTree returns empty array (no manifest entry)
    mockPersistence.readTree.mockResolvedValue([]);

    await expect(
      service.findOrphanedChunks({ treeOids: ['tree-missing'] }),
    ).rejects.toThrow(CasError);

    try {
      await service.findOrphanedChunks({ treeOids: ['tree-missing'] });
    } catch (err) {
      expect(err.code).toBe('MANIFEST_NOT_FOUND');
      expect(err.message).toContain('No manifest entry');
      expect(err.meta.treeOid).toBe('tree-missing');
    }
  });

  it('throws MANIFEST_NOT_FOUND when second treeOid has no manifest', async () => {
    const manifest1 = manifestJson({
      slug: 'asset-1',
      filename: 'file1.bin',
      size: 1024,
      chunks: [chunk(0, 'chunk-0', 'blob-1')],
    });

    // Mock returns valid tree first, then empty tree
    mockPersistence.readTree.mockImplementation((oid) => {
      if (oid === 'tree-1') {
        return Promise.resolve([
          { mode: '100644', type: 'blob', oid: 'manifest-oid-1', name: 'manifest.json' },
        ]);
      }
      return Promise.resolve([]); // tree-missing has no entries
    });

    mockPersistence.readBlob.mockResolvedValue(
      Buffer.from(JSON.stringify(manifest1)),
    );

    await expect(
      service.findOrphanedChunks({ treeOids: ['tree-1', 'tree-missing'] }),
    ).rejects.toThrow(CasError);

    try {
      await service.findOrphanedChunks({ treeOids: ['tree-1', 'tree-missing'] });
    } catch (err) {
      expect(err.code).toBe('MANIFEST_NOT_FOUND');
      expect(err.meta.treeOid).toBe('tree-missing');
    }
  });

  it('throws GIT_ERROR when readTree fails', async () => {
    mockPersistence.readTree.mockRejectedValue(
      new Error('Git command failed: invalid object'),
    );

    await expect(
      service.findOrphanedChunks({ treeOids: ['tree-bad'] }),
    ).rejects.toThrow(CasError);

    try {
      await service.findOrphanedChunks({ treeOids: ['tree-bad'] });
    } catch (err) {
      expect(err.code).toBe('GIT_ERROR');
      expect(err.message).toContain('Failed to read tree');
      expect(err.meta.treeOid).toBe('tree-bad');
    }
  });

  it('throws GIT_ERROR when readBlob fails', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);

    mockPersistence.readBlob.mockRejectedValue(
      new Error('Git command failed: invalid blob'),
    );

    await expect(
      service.findOrphanedChunks({ treeOids: ['tree-1'] }),
    ).rejects.toThrow(CasError);

    try {
      await service.findOrphanedChunks({ treeOids: ['tree-1'] });
    } catch (err) {
      expect(err.code).toBe('GIT_ERROR');
      expect(err.message).toContain('Failed to read manifest blob');
    }
  });

  it('throws when manifest JSON is invalid', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);

    // Return invalid JSON
    mockPersistence.readBlob.mockResolvedValue(
      Buffer.from('{ invalid json }'),
    );

    await expect(
      service.findOrphanedChunks({ treeOids: ['tree-1'] }),
    ).rejects.toThrow();
  });

  it('throws when manifest violates schema (missing required field)', async () => {
    const invalidManifest = {
      slug: 'asset-1',
      // Missing filename
      size: 1024,
      chunks: [chunk(0, 'chunk-0', 'blob-1')],
    };

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);

    mockPersistence.readBlob.mockResolvedValue(
      Buffer.from(JSON.stringify(invalidManifest)),
    );

    await expect(
      service.findOrphanedChunks({ treeOids: ['tree-1'] }),
    ).rejects.toThrow();
  });

  it('fails closed on any error by not continuing to next treeOid', async () => {
    const manifest1 = manifestJson({
      slug: 'asset-1',
      filename: 'file1.bin',
      size: 1024,
      chunks: [chunk(0, 'chunk-0', 'blob-1')],
    });

    mockPersistence.readTree
      .mockResolvedValueOnce([
        { mode: '100644', type: 'blob', oid: 'manifest-oid-1', name: 'manifest.json' },
      ])
      .mockRejectedValueOnce(new Error('Git error on second tree'));

    mockPersistence.readBlob.mockResolvedValueOnce(
      Buffer.from(JSON.stringify(manifest1)),
    );

    await expect(
      service.findOrphanedChunks({ treeOids: ['tree-1', 'tree-2', 'tree-3'] }),
    ).rejects.toThrow(CasError);

    // Verify that we stopped at the second tree and never called readTree for tree-3
    expect(mockPersistence.readTree).toHaveBeenCalledTimes(2);
  });
});
