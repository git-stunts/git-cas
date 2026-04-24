import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';

const testCrypto = await getTestCryptoAdapter();
const codec = new JsonCodec();

const sha256 = (str) => createHash('sha256').update(str).digest('hex');
const sha1 = (str) => createHash('sha1').update(str).digest('hex');

function setup() {
  const mockPersistence = {
    writeBlob: vi.fn(),
    writeTree: vi.fn(),
    readBlob: vi.fn(),
    readTree: vi.fn(),
  };
  const service = new CasService({
    persistence: mockPersistence,
    crypto: testCrypto,
    codec,
    chunkSize: 1024,
    observability: new SilentObserver(),
  });
  return { service, mockPersistence };
}

function makeChunk(index) {
  return { index, size: 1024, digest: sha256(`chunk-${index}`), blob: sha1(`blob-${index}`) };
}

function mockV2Manifest({ mockPersistence, rootManifest, subManifestOid, subData }) {
  const manifestOid = sha1('manifest');
  mockPersistence.readTree.mockResolvedValue([
    { mode: '100644', type: 'blob', oid: manifestOid, name: 'manifest.json' },
  ]);
  mockPersistence.readBlob.mockImplementation((oid) => {
    if (oid === manifestOid) { return Promise.resolve(Buffer.from(codec.encode(rootManifest))); }
    if (oid === subManifestOid) { return Promise.resolve(Buffer.from(codec.encode(subData))); }
    return Promise.reject(new Error(`Unknown OID: ${oid}`));
  });
}

function makeRootManifest(subManifestOid, chunkCount) {
  return {
    version: 2, slug: 'test', filename: 'test.bin', size: 2048, chunks: [],
    subManifests: [{ oid: subManifestOid, chunkCount, startIndex: 0 }],
  };
}

describe('sub-manifest chunkCount – mismatch rejected', () => {
  let service;
  let mockPersistence;
  beforeEach(() => { ({ service, mockPersistence } = setup()); });

  it('rejects when actual chunks differ from declared chunkCount', async () => {
    const subOid = sha1('sub-0');
    mockV2Manifest({ mockPersistence, rootManifest: makeRootManifest(subOid, 5), subManifestOid: subOid, subData: { chunks: [makeChunk(0), makeChunk(1)] } });
    await expect(service.readManifest({ treeOid: 'a'.repeat(40) })).rejects.toThrow(/chunk.?count/i);
  });
});

describe('sub-manifest chunk schema validation – malformed rejected', () => {
  let service;
  let mockPersistence;
  beforeEach(() => { ({ service, mockPersistence } = setup()); });

  it('rejects non-hex digest with MANIFEST_INTEGRITY_ERROR citing sub-manifest OID', async () => {
    const subOid = sha1('sub-0');
    const badChunk = { index: 0, size: 1024, digest: 'ZZZZ'.repeat(16), blob: sha1('b0') };
    mockV2Manifest({ mockPersistence, rootManifest: makeRootManifest(subOid, 1), subManifestOid: subOid, subData: { chunks: [badChunk] } });
    try {
      await service.readManifest({ treeOid: 'a'.repeat(40) });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('MANIFEST_INTEGRITY_ERROR');
      expect(err.meta.subManifestOid).toBe(subOid);
    }
  });

  it('rejects non-hex blob with MANIFEST_INTEGRITY_ERROR citing sub-manifest OID', async () => {
    const subOid = sha1('sub-0');
    const badChunk = { index: 0, size: 1024, digest: sha256('c0'), blob: 'not-a-hex-oid' };
    mockV2Manifest({ mockPersistence, rootManifest: makeRootManifest(subOid, 1), subManifestOid: subOid, subData: { chunks: [badChunk] } });
    try {
      await service.readManifest({ treeOid: 'a'.repeat(40) });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('MANIFEST_INTEGRITY_ERROR');
      expect(err.meta.subManifestOid).toBe(subOid);
    }
  });

  it('strips extra properties from sub-manifest chunks via schema parse', async () => {
    const subOid = sha1('sub-0');
    const chunk = { ...makeChunk(0), malicious: 'payload' };
    mockV2Manifest({ mockPersistence, rootManifest: makeRootManifest(subOid, 1), subManifestOid: subOid, subData: { chunks: [chunk] } });
    const result = await service.readManifest({ treeOid: 'a'.repeat(40) });
    expect(result.chunks[0]).not.toHaveProperty('malicious');
  });
});

describe('sub-manifest chunkCount – match accepted', () => {
  let service;
  let mockPersistence;
  beforeEach(() => { ({ service, mockPersistence } = setup()); });

  it('accepts when actual chunks match declared chunkCount', async () => {
    const subOid = sha1('sub-0');
    mockV2Manifest({ mockPersistence, rootManifest: makeRootManifest(subOid, 2), subManifestOid: subOid, subData: { chunks: [makeChunk(0), makeChunk(1)] } });
    const result = await service.readManifest({ treeOid: 'a'.repeat(40) });
    expect(result.chunks).toHaveLength(2);
  });
});
