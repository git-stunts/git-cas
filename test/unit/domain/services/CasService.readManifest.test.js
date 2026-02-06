import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import CasError from '../../../../src/domain/errors/CasError.js';

function digestOf(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

function validManifestData(overrides = {}) {
  return {
    slug: 'test-asset',
    filename: 'test.bin',
    size: 2048,
    chunks: [
      { index: 0, size: 1024, digest: digestOf('chunk-0'), blob: 'blob-oid-0' },
      { index: 1, size: 1024, digest: digestOf('chunk-1'), blob: 'blob-oid-1' },
    ],
    ...overrides,
  };
}

function setup() {
  const mockPersistence = {
    writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn(),
    readTree: vi.fn(),
  };

  const codec = new JsonCodec();

  const service = new CasService({
    persistence: mockPersistence,
    crypto: new NodeCryptoAdapter(),
    codec,
    chunkSize: 1024,
  });

  return { service, mockPersistence, codec };
}

// ---------------------------------------------------------------------------
// Golden path
// ---------------------------------------------------------------------------
describe('CasService.readManifest – golden path', () => {
  let service;
  let mockPersistence;
  let codec;

  beforeEach(() => {
    ({ service, mockPersistence, codec } = setup());
  });

  it('reads and decodes manifest from tree', async () => {
    const treeOid = 'tree-oid-123';
    const manifestOid = 'manifest-oid-456';
    const data = validManifestData();

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'other-oid', name: 'data.dat' },
      { mode: '100644', type: 'blob', oid: manifestOid, name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockResolvedValue(Buffer.from(codec.encode(data)));

    const result = await service.readManifest({ treeOid });

    expect(mockPersistence.readTree).toHaveBeenCalledWith(treeOid);
    expect(mockPersistence.readBlob).toHaveBeenCalledWith(manifestOid);
    expect(result).toBeInstanceOf(Manifest);
    expect(result.slug).toBe('test-asset');
    expect(result.size).toBe(2048);
    expect(result.chunks).toHaveLength(2);
  });

  it('finds manifest entry regardless of position in tree', async () => {
    const manifestOid = 'manifest-oid-456';
    const data = validManifestData();

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: manifestOid, name: 'manifest.json' },
      { mode: '100644', type: 'blob', oid: 'chunk-oid-1', name: digestOf('chunk-0') },
      { mode: '100644', type: 'blob', oid: 'chunk-oid-2', name: digestOf('chunk-1') },
    ]);
    mockPersistence.readBlob.mockResolvedValue(Buffer.from(codec.encode(data)));

    const result = await service.readManifest({ treeOid: 'tree-oid' });

    expect(result).toBeInstanceOf(Manifest);
    expect(mockPersistence.readBlob).toHaveBeenCalledWith(manifestOid);
  });
});

// ---------------------------------------------------------------------------
// Manifest not found – missing entry and empty tree
// ---------------------------------------------------------------------------
describe('CasService.readManifest – manifest not found (missing entry)', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('throws MANIFEST_NOT_FOUND when no manifest entry exists', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'chunk-oid', name: 'chunk1.dat' },
    ]);

    try {
      await service.readManifest({ treeOid: 'tree-oid' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('MANIFEST_NOT_FOUND');
    }

    expect(mockPersistence.readBlob).not.toHaveBeenCalled();
  });

  it('throws MANIFEST_NOT_FOUND when tree is empty', async () => {
    mockPersistence.readTree.mockResolvedValue([]);

    try {
      await service.readManifest({ treeOid: 'tree-oid' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('MANIFEST_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// Manifest not found – wrong name variations
// ---------------------------------------------------------------------------
describe('CasService.readManifest – manifest not found (wrong name)', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('throws MANIFEST_NOT_FOUND when manifest has wrong extension', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'oid', name: 'manifest.txt' },
    ]);

    try {
      await service.readManifest({ treeOid: 'tree-oid' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('MANIFEST_NOT_FOUND');
    }
  });

  it('throws MANIFEST_NOT_FOUND for bare "manifest" without extension', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'oid', name: 'manifest' },
    ]);

    try {
      await service.readManifest({ treeOid: 'tree-oid' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('MANIFEST_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// Corrupt data handling
// ---------------------------------------------------------------------------
describe('CasService.readManifest – corrupt data handling', () => {
  let service;
  let mockPersistence;
  let codec;

  beforeEach(() => {
    ({ service, mockPersistence, codec } = setup());
  });

  it('throws when manifest JSON is unparseable', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockResolvedValue(Buffer.from('{ invalid json }'));

    await expect(service.readManifest({ treeOid: 'tree-oid' })).rejects.toThrow();
  });

  it('throws when manifest data fails Zod validation', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);
    // Valid JSON but missing required manifest fields
    mockPersistence.readBlob.mockResolvedValue(
      Buffer.from(codec.encode({ foo: 'bar' })),
    );

    await expect(service.readManifest({ treeOid: 'tree-oid' })).rejects.toThrow(
      /Invalid manifest data/,
    );
  });
});

// ---------------------------------------------------------------------------
// Git error handling – wrapping non-CasError
// ---------------------------------------------------------------------------
describe('CasService.readManifest – git error wrapping', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('wraps non-CasError from readTree as GIT_ERROR', async () => {
    mockPersistence.readTree.mockRejectedValue(new Error('object not found'));

    try {
      await service.readManifest({ treeOid: 'bad-oid' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('GIT_ERROR');
    }

    expect(mockPersistence.readBlob).not.toHaveBeenCalled();
  });

  it('wraps non-CasError from readBlob as GIT_ERROR', async () => {
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockRejectedValue(new Error('blob not found'));

    try {
      await service.readManifest({ treeOid: 'tree-oid' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('GIT_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// Git error handling – re-throwing CasError
// ---------------------------------------------------------------------------
describe('CasService.readManifest – CasError passthrough', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('re-throws CasError from readTree as-is', async () => {
    const original = new CasError('Tree parse failed', 'TREE_PARSE_ERROR', {});
    mockPersistence.readTree.mockRejectedValue(original);

    try {
      await service.readManifest({ treeOid: 'tree-oid' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBe(original);
      expect(err.code).toBe('TREE_PARSE_ERROR');
    }
  });

  it('re-throws CasError from readBlob as-is', async () => {
    const original = new CasError('Blob read failed', 'SOME_CAS_ERROR', {});
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockRejectedValue(original);

    try {
      await service.readManifest({ treeOid: 'tree-oid' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBe(original);
      expect(err.code).toBe('SOME_CAS_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases – empty chunks and large tree
// ---------------------------------------------------------------------------
describe('CasService.readManifest – edge cases (empty & large)', () => {
  let service;
  let mockPersistence;
  let codec;

  beforeEach(() => {
    ({ service, mockPersistence, codec } = setup());
  });

  it('handles manifest with empty chunks array', async () => {
    const data = validManifestData({ size: 0, chunks: [] });

    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockResolvedValue(Buffer.from(codec.encode(data)));

    const result = await service.readManifest({ treeOid: 'tree-oid' });

    expect(result).toBeInstanceOf(Manifest);
    expect(result.chunks).toHaveLength(0);
    expect(result.size).toBe(0);
  });

  it('handles tree with many entries and manifest at end', async () => {
    const data = validManifestData();
    const filler = Array.from({ length: 100 }, (_, i) => ({
      mode: '100644',
      type: 'blob',
      oid: `chunk-oid-${i}`,
      name: `chunk-${i}`,
    }));
    const entries = [
      ...filler,
      { mode: '100644', type: 'blob', oid: 'manifest-oid', name: 'manifest.json' },
    ];

    mockPersistence.readTree.mockResolvedValue(entries);
    mockPersistence.readBlob.mockResolvedValue(Buffer.from(codec.encode(data)));

    const result = await service.readManifest({ treeOid: 'tree-oid' });

    expect(result).toBeInstanceOf(Manifest);
    expect(result.chunks).toHaveLength(2);
    expect(mockPersistence.readBlob).toHaveBeenCalledWith('manifest-oid');
  });
});

// ---------------------------------------------------------------------------
// Edge cases – error meta
// ---------------------------------------------------------------------------
describe('CasService.readManifest – edge cases (error meta)', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('includes treeOid in MANIFEST_NOT_FOUND error meta', async () => {
    mockPersistence.readTree.mockResolvedValue([]);

    try {
      await service.readManifest({ treeOid: 'specific-tree-oid' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.meta.treeOid).toBe('specific-tree-oid');
      expect(err.meta.expectedName).toBe('manifest.json');
    }
  });
});
