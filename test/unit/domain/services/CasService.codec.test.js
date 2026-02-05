import { describe, it, expect, vi, beforeEach } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CborCodec from '../../../../src/infrastructure/codecs/CborCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

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
    const service = new CasService({ persistence: mockPersistence, crypto: new NodeCryptoAdapter(), codec: new JsonCodec() });
    await service.createTree({ manifest: dummyManifest });

    expect(mockPersistence.writeBlob).toHaveBeenCalledWith(expect.stringContaining('{'));
    expect(mockPersistence.writeTree).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringContaining('manifest.json')
    ]));
  });

  it('uses CborCodec when injected', async () => {
    const service = new CasService({ persistence: mockPersistence, crypto: new NodeCryptoAdapter(), codec: new CborCodec() });
    await service.createTree({ manifest: dummyManifest });

    // CBOR output is binary (Buffer), so we check for Buffer
    expect(mockPersistence.writeBlob).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mockPersistence.writeTree).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringContaining('manifest.cbor')
    ]));
  });
});
