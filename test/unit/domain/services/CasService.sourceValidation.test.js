import { describe, it, expect, vi } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();

function createService() {
  return new CasService({
    persistence: {
      writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
      writeTree: vi.fn().mockResolvedValue('a'.repeat(40)),
    },
    crypto: testCrypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
}

describe('CasService.store – source validation', () => {
  it('rejects null source', async () => {
    const svc = createService();
    await expect(svc.store({ source: null, slug: 'test', filename: 'test.bin' }))
      .rejects.toThrow(/source/i);
  });

  it('rejects a plain Buffer (not async iterable)', async () => {
    const svc = createService();
    await expect(svc.store({ source: Buffer.from('hello'), slug: 'test', filename: 'test.bin' }))
      .rejects.toThrow(/source/i);
  });

  it('rejects a string', async () => {
    const svc = createService();
    await expect(svc.store({ source: 'not-iterable', slug: 'test', filename: 'test.bin' }))
      .rejects.toThrow(/source/i);
  });
});
