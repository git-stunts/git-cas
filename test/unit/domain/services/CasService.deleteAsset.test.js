import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';

/**
 * Helper to create deterministic 64-char SHA-256 digests for test data.
 */
function sha256Digest(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

/**
 * Shared factory: builds standard test fixtures.
 */
function setup() {
  const mockPersistence = {
    writeBlob: vi.fn(),
    writeTree: vi.fn(),
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

// ---------------------------------------------------------------------------
// Golden path – standard manifest
// ---------------------------------------------------------------------------
describe('CasService.deleteAsset() – golden path', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('returns slug and chunksOrphaned count for a multi-chunk manifest', async () => {
    const manifestData = {
      slug: 'my-asset',
      filename: 'photo.jpg',
      size: 2048,
      chunks: [
        { index: 0, size: 1024, digest: sha256Digest('chunk0'), blob: 'blob-oid-1' },
        { index: 1, size: 1024, digest: sha256Digest('chunk1'), blob: 'blob-oid-2' },
      ],
    };

    const manifestJson = JSON.stringify(manifestData);
    const codec = new JsonCodec();
    const manifestBlob = codec.encode(manifestData);

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
      { mode: '100644', type: 'blob', oid: 'blob-oid-1', name: sha256Digest('chunk0') },
      { mode: '100644', type: 'blob', oid: 'blob-oid-2', name: sha256Digest('chunk1') },
    ]);

    mockPersistence.readBlob.mockResolvedValue(manifestBlob);

    const result = await service.deleteAsset({ treeOid: 'tree-abc123' });

    expect(result).toEqual({
      slug: 'my-asset',
      chunksOrphaned: 2,
    });

    expect(mockPersistence.readTree).toHaveBeenCalledWith('tree-abc123');
    expect(mockPersistence.readBlob).toHaveBeenCalledWith('manifest-oid');
  });

  it('returns slug and chunksOrphaned count for a single-chunk manifest', async () => {
    const manifestData = {
      slug: 'small-file',
      filename: 'tiny.txt',
      size: 512,
      chunks: [
        { index: 0, size: 512, digest: sha256Digest('only-chunk'), blob: 'blob-single' },
      ],
    };

    const codec = new JsonCodec();
    const manifestBlob = codec.encode(manifestData);

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid-2', name: 'manifest.json' },
      { mode: '100644', type: 'blob', oid: 'blob-single', name: sha256Digest('only-chunk') },
    ]);

    mockPersistence.readBlob.mockResolvedValue(manifestBlob);

    const result = await service.deleteAsset({ treeOid: 'tree-xyz789' });

    expect(result).toEqual({
      slug: 'small-file',
      chunksOrphaned: 1,
    });
  });

  it('returns slug and chunksOrphaned count for a large multi-chunk manifest', async () => {
    const chunks = [];
    for (let i = 0; i < 10; i++) {
      chunks.push({
        index: i,
        size: 1024,
        digest: sha256Digest(`chunk${i}`),
        blob: `blob-oid-${i}`,
      });
    }

    const manifestData = {
      slug: 'large-asset',
      filename: 'video.mp4',
      size: 10240,
      chunks,
    };

    const codec = new JsonCodec();
    const manifestBlob = codec.encode(manifestData);

    const treeEntries = [
      { mode: '100644', type: 'blob', oid: 'manifest-oid-3', name: 'manifest.json' },
      ...chunks.map((c) => ({
        mode: '100644',
        type: 'blob',
        oid: c.blob,
        name: c.digest,
      })),
    ];

    mockPersistence.readTree.mockResolvedValue(treeEntries);
    mockPersistence.readBlob.mockResolvedValue(manifestBlob);

    const result = await service.deleteAsset({ treeOid: 'tree-large' });

    expect(result).toEqual({
      slug: 'large-asset',
      chunksOrphaned: 10,
    });
  });
});

// ---------------------------------------------------------------------------
// Edge case – empty manifest
// ---------------------------------------------------------------------------
describe('CasService.deleteAsset() – empty manifest', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('returns chunksOrphaned=0 for manifest with no chunks', async () => {
    const manifestData = {
      slug: 'empty-asset',
      filename: 'empty.bin',
      size: 0,
      chunks: [],
    };

    const codec = new JsonCodec();
    const manifestBlob = codec.encode(manifestData);

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid-empty', name: 'manifest.json' },
    ]);

    mockPersistence.readBlob.mockResolvedValue(manifestBlob);

    const result = await service.deleteAsset({ treeOid: 'tree-empty' });

    expect(result).toEqual({
      slug: 'empty-asset',
      chunksOrphaned: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Failures – missing manifest
// ---------------------------------------------------------------------------
describe('CasService.deleteAsset() – missing manifest', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('throws MANIFEST_NOT_FOUND when tree has no manifest.json entry', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'some-blob', name: 'not-manifest.txt' },
    ]);

    await expect(
      service.deleteAsset({ treeOid: 'tree-no-manifest' }),
    ).rejects.toThrow(CasError);

    try {
      await service.deleteAsset({ treeOid: 'tree-no-manifest' });
    } catch (err) {
      expect(err.code).toBe('MANIFEST_NOT_FOUND');
      expect(err.message).toContain('No manifest entry');
      expect(err.meta.treeOid).toBe('tree-no-manifest');
      expect(err.meta.expectedName).toBe('manifest.json');
    }
  });

  it('throws MANIFEST_NOT_FOUND for empty tree', async () => {
    mockPersistence.readTree.mockResolvedValue([]);

    await expect(
      service.deleteAsset({ treeOid: 'tree-empty-tree' }),
    ).rejects.toThrow(CasError);

    try {
      await service.deleteAsset({ treeOid: 'tree-empty-tree' });
    } catch (err) {
      expect(err.code).toBe('MANIFEST_NOT_FOUND');
      expect(err.meta.treeOid).toBe('tree-empty-tree');
    }
  });

  it('propagates GIT_ERROR when readTree fails', async () => {
    mockPersistence.readTree.mockRejectedValue(
      new Error('fatal: not a valid object name tree-bad'),
    );

    await expect(
      service.deleteAsset({ treeOid: 'tree-bad' }),
    ).rejects.toThrow(CasError);

    try {
      await service.deleteAsset({ treeOid: 'tree-bad' });
    } catch (err) {
      expect(err.code).toBe('GIT_ERROR');
      expect(err.message).toContain('Failed to read tree');
      expect(err.meta.treeOid).toBe('tree-bad');
    }
  });

  it('propagates GIT_ERROR when readBlob fails', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'bad-manifest-oid', name: 'manifest.json' },
    ]);

    mockPersistence.readBlob.mockRejectedValue(
      new Error('fatal: not a valid object name bad-manifest-oid'),
    );

    await expect(
      service.deleteAsset({ treeOid: 'tree-corrupt' }),
    ).rejects.toThrow(CasError);

    try {
      await service.deleteAsset({ treeOid: 'tree-corrupt' });
    } catch (err) {
      expect(err.code).toBe('GIT_ERROR');
      expect(err.message).toContain('Failed to read manifest blob');
      expect(err.meta.treeOid).toBe('tree-corrupt');
      expect(err.meta.manifestOid).toBe('bad-manifest-oid');
    }
  });
});

// ---------------------------------------------------------------------------
// Manifest with encryption metadata
// ---------------------------------------------------------------------------
describe('CasService.deleteAsset() – encrypted manifest', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('returns chunksOrphaned count for encrypted manifest', async () => {
    const manifestData = {
      slug: 'encrypted-asset',
      filename: 'secret.dat',
      size: 1536,
      chunks: [
        { index: 0, size: 1024, digest: sha256Digest('enc-chunk0'), blob: 'enc-blob-1' },
        { index: 1, size: 512, digest: sha256Digest('enc-chunk1'), blob: 'enc-blob-2' },
      ],
      encryption: {
        algorithm: 'aes-256-gcm',
        nonce: 'abcd1234',
        tag: 'efgh5678',
        encrypted: true,
      },
    };

    const codec = new JsonCodec();
    const manifestBlob = codec.encode(manifestData);

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'enc-manifest-oid', name: 'manifest.json' },
      { mode: '100644', type: 'blob', oid: 'enc-blob-1', name: sha256Digest('enc-chunk0') },
      { mode: '100644', type: 'blob', oid: 'enc-blob-2', name: sha256Digest('enc-chunk1') },
    ]);

    mockPersistence.readBlob.mockResolvedValue(manifestBlob);

    const result = await service.deleteAsset({ treeOid: 'tree-encrypted' });

    expect(result).toEqual({
      slug: 'encrypted-asset',
      chunksOrphaned: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// Various slug formats
// ---------------------------------------------------------------------------
describe('CasService.deleteAsset() – slug variations', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('handles slug with special characters', async () => {
    const manifestData = {
      slug: 'my-asset_v2.0',
      filename: 'data.bin',
      size: 1024,
      chunks: [
        { index: 0, size: 1024, digest: sha256Digest('x'), blob: 'blob-x' },
      ],
    };

    const codec = new JsonCodec();
    const manifestBlob = codec.encode(manifestData);

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);

    mockPersistence.readBlob.mockResolvedValue(manifestBlob);

    const result = await service.deleteAsset({ treeOid: 'tree-special' });

    expect(result.slug).toBe('my-asset_v2.0');
  });

  it('handles very long slug', async () => {
    const longSlug = 'a'.repeat(256);
    const manifestData = {
      slug: longSlug,
      filename: 'long.txt',
      size: 100,
      chunks: [
        { index: 0, size: 100, digest: sha256Digest('long'), blob: 'blob-long' },
      ],
    };

    const codec = new JsonCodec();
    const manifestBlob = codec.encode(manifestData);

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);

    mockPersistence.readBlob.mockResolvedValue(manifestBlob);

    const result = await service.deleteAsset({ treeOid: 'tree-long-slug' });

    expect(result.slug).toBe(longSlug);
    expect(result.slug.length).toBe(256);
  });
});
