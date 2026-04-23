import { describe, it, expect, vi } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import { digestOf } from '../../../helpers/crypto.js';

const testCrypto = await getTestCryptoAdapter();

/** Valid 40-char hex OIDs for blob fields. */
const B0 = 'a'.repeat(40);
const B1 = 'b'.repeat(40);

function makeChunk(index, seed, blobOid) {
  return { index, size: 1024, digest: digestOf(seed), blob: blobOid };
}

function setup() {
  const mockPersistence = {
    writeBlob: vi.fn(),
    writeTree: vi.fn(),
    readBlob: vi.fn(),
    readTree: vi.fn(),
  };
  const observability = {
    metric: vi.fn(),
    log: vi.fn(),
    span: vi.fn().mockReturnValue({ end: vi.fn() }),
  };
  const service = new CasService({
    persistence: mockPersistence,
    crypto: testCrypto,
    codec: new JsonCodec(),
    chunkSize: 1024,
    observability,
  });
  return { mockPersistence, observability, service };
}

function mockManifest(mockPersistence, manifest) {
  const codec = new JsonCodec();
  mockPersistence.readTree.mockResolvedValue([
    { mode: '100644', type: 'blob', oid: 'mf-oid', name: 'manifest.json' },
  ]);
  mockPersistence.readBlob.mockResolvedValue(codec.encode(manifest));
}

describe('16.7: inspectAsset (canonical name)', () => {
  it('returns { slug, chunksOrphaned }', async () => {
    const { service, mockPersistence } = setup();
    const manifest = {
      slug: 'asset-1', filename: 'f.bin', size: 2048,
      chunks: [makeChunk(0, 'c0', B0), makeChunk(1, 'c1', B1)],
    };
    mockManifest(mockPersistence, manifest);
    const result = await service.inspectAsset({ treeOid: 'tree-1' });
    expect(result).toEqual({ slug: 'asset-1', chunksOrphaned: 2 });
  });
});

describe('16.7: deleteAsset (deprecated alias)', () => {
  it('delegates to inspectAsset and returns same result', async () => {
    const { service, mockPersistence } = setup();
    const manifest = {
      slug: 'asset-2', filename: 'g.bin', size: 1024,
      chunks: [makeChunk(0, 'd0', B0)],
    };
    mockManifest(mockPersistence, manifest);
    const result = await service.deleteAsset({ treeOid: 'tree-2' });
    expect(result).toEqual({ slug: 'asset-2', chunksOrphaned: 1 });
  });

  it('emits deprecation warning via observability', async () => {
    const { service, mockPersistence, observability } = setup();
    const manifest = {
      slug: 'x', filename: 'x.bin', size: 0, chunks: [],
    };
    mockManifest(mockPersistence, manifest);
    await service.deleteAsset({ treeOid: 'tree-x' });
    expect(observability.log).toHaveBeenCalledWith(
      'warn', 'deleteAsset() is deprecated — use inspectAsset()',
    );
  });
});

describe('16.7: collectReferencedChunks (canonical name)', () => {
  it('returns { referenced, total }', async () => {
    const { service, mockPersistence } = setup();
    const manifest = {
      slug: 'asset-3', filename: 'h.bin', size: 2048,
      chunks: [makeChunk(0, 'e0', B0), makeChunk(1, 'e1', B1)],
    };
    mockManifest(mockPersistence, manifest);
    const result = await service.collectReferencedChunks({ treeOids: ['tree-3'] });
    expect(result.referenced.size).toBe(2);
    expect(result.total).toBe(2);
  });
});

describe('16.7: findOrphanedChunks (deprecated alias)', () => {
  it('delegates to collectReferencedChunks', async () => {
    const { service, mockPersistence } = setup();
    const manifest = {
      slug: 'asset-4', filename: 'i.bin', size: 1024,
      chunks: [makeChunk(0, 'f0', B0)],
    };
    mockManifest(mockPersistence, manifest);
    const result = await service.findOrphanedChunks({ treeOids: ['tree-4'] });
    expect(result.referenced.size).toBe(1);
    expect(result.total).toBe(1);
  });

  it('emits deprecation warning via observability', async () => {
    const { service, mockPersistence, observability } = setup();
    const manifest = {
      slug: 'y', filename: 'y.bin', size: 0, chunks: [],
    };
    mockManifest(mockPersistence, manifest);
    await service.findOrphanedChunks({ treeOids: ['tree-y'] });
    expect(observability.log).toHaveBeenCalledWith(
      'warn', 'findOrphanedChunks() is deprecated — use collectReferencedChunks()',
    );
  });
});
