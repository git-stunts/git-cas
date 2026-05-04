import { describe, it, expect, vi, beforeEach } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CborCodec from '../../../../src/infrastructure/codecs/CborCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();

describe('CasService with Codecs', () => {
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-oid'),
      writeTree: vi.fn().mockResolvedValue('tree-oid'),
    };
  });

  const dummyManifest = new Manifest({
    slug: 'test',
    filename: 'f.txt',
    size: 100,
    chunks: []
  });

  it('uses JsonCodec when injected', async () => {
    const service = new CasService({ persistence: mockPersistence, crypto: testCrypto, codec: new JsonCodec(), observability: new SilentObserver(), chunker: new FixedChunker({ chunkSize: 256 * 1024 }), compressionAdapter: new NodeCompressionAdapter() });
    await service.createTree({ manifest: dummyManifest });

    const payload = mockPersistence.writeBlob.mock.calls[0][0];
    expect(payload).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(payload).toString('utf8')).toContain('{');
    expect(mockPersistence.writeTree).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringContaining('manifest.json')
    ]));
  });

  it('uses CborCodec when injected', async () => {
    const service = new CasService({ persistence: mockPersistence, crypto: testCrypto, codec: new CborCodec(), observability: new SilentObserver(), chunker: new FixedChunker({ chunkSize: 256 * 1024 }), compressionAdapter: new NodeCompressionAdapter() });
    await service.createTree({ manifest: dummyManifest });

    expect(mockPersistence.writeBlob).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(mockPersistence.writeTree).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringContaining('manifest.cbor')
    ]));
  });
});
