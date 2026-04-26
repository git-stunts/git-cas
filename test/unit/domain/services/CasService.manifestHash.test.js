import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();
const codec = new JsonCodec();

const sha256 = (str) => createHash('sha256').update(str).digest('hex');
const sha1 = (str) => createHash('sha1').update(str).digest('hex');

function makeChunk(index) {
  return { index, size: 1024, digest: sha256(`chunk-${index}`), blob: sha1(`blob-${index}`) };
}

function setup() {
  const blobs = new Map();
  const mockPersistence = {
    writeBlob: vi.fn((content) => {
      const oid = sha1(content.toString());
      blobs.set(oid, Buffer.from(content));
      return Promise.resolve(oid);
    }),
    writeTree: vi.fn().mockResolvedValue('a'.repeat(40)),
    readBlob: vi.fn((oid) => {
      const b = blobs.get(oid);
      return b ? Promise.resolve(b) : Promise.reject(new Error(`No blob: ${oid}`));
    }),
    readTree: vi.fn(),
  };
  const service = new CasService({
    persistence: mockPersistence,
    crypto: testCrypto,
    codec,
    chunkSize: 1024,
    observability: new SilentObserver(),
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
  return { service, mockPersistence, blobs };
}

describe('manifest integrity hash – store includes hash', () => {
  let service;
  let blobs;

  beforeEach(() => { ({ service, blobs } = setup()); });

  it('createTree stores a manifest with a manifestHash field', async () => {
    const Manifest = (await import('../../../../src/domain/value-objects/Manifest.js')).default;
    const manifest = new Manifest({
      slug: 'test', filename: 'test.bin', size: 1024,
      chunks: [makeChunk(0)],
    });

    await service.createTree({ manifest });

    // Find the stored manifest blob (last writeBlob call is the manifest)
    const storedBlobs = [...blobs.values()];
    const manifestBlob = storedBlobs.find((b) => {
      try { const d = codec.decode(b); return d.slug === 'test'; } catch { return false; }
    });
    expect(manifestBlob).toBeDefined();

    const decoded = codec.decode(manifestBlob);
    expect(decoded.manifestHash).toBeDefined();
    expect(decoded.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('manifest integrity hash – read verifies hash', () => {
  let service;
  let mockPersistence;

  beforeEach(() => { ({ service, mockPersistence } = setup()); });

  it('rejects a manifest with tampered manifestHash', async () => {
    const manifestData = {
      slug: 'test', filename: 'test.bin', size: 1024,
      chunks: [makeChunk(0)],
      manifestHash: 'f'.repeat(64), // wrong hash
    };

    const manifestOid = sha1('manifest');
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: manifestOid, name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockResolvedValue(Buffer.from(codec.encode(manifestData)));

    try {
      await service.readManifest({ treeOid: 'a'.repeat(40) });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('MANIFEST_INTEGRITY_ERROR');
    }
  });

  it('accepts a manifest without manifestHash (backward compat)', async () => {
    const manifestData = {
      slug: 'test', filename: 'test.bin', size: 1024,
      chunks: [makeChunk(0)],
      // no manifestHash
    };

    const manifestOid = sha1('manifest');
    mockPersistence.readTree.mockResolvedValue([
      { mode: '100644', type: 'blob', oid: manifestOid, name: 'manifest.json' },
    ]);
    mockPersistence.readBlob.mockResolvedValue(Buffer.from(codec.encode(manifestData)));

    const result = await service.readManifest({ treeOid: 'a'.repeat(40) });
    expect(result.slug).toBe('test');
  });
});
