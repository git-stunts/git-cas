import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import CdcChunker from '../../../../src/infrastructure/chunkers/CdcChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();

function createService({ chunker = new FixedChunker({ chunkSize: 256 * 1024 }) } = {}) {
  return new CasService({
    persistence: {
      writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
      writeTree: vi.fn().mockResolvedValue('a'.repeat(40)),
    },
    crypto: testCrypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunker,
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

  it('stores Readable.from() Uint8Array chunks with fixed chunking', async () => {
    const svc = createService({ chunker: new FixedChunker({ chunkSize: 3 }) });
    const source = Readable.from([new Uint8Array([1, 2, 3, 4, 5])]);

    const manifest = await svc.store({ source, slug: 'test', filename: 'test.bin' });

    expect(manifest.size).toBe(5);
    expect(manifest.chunks.map((chunk) => chunk.size)).toEqual([3, 2]);
  });

  it('stores Readable.from() Uint8Array chunks with CDC chunking', async () => {
    const svc = createService({
      chunker: new CdcChunker({ minChunkSize: 2, maxChunkSize: 8, targetChunkSize: 4 }),
    });
    const source = Readable.from([new Uint8Array([1, 2, 3, 4, 5])]);

    const manifest = await svc.store({ source, slug: 'test', filename: 'test.bin' });

    expect(manifest.size).toBe(5);
    expect(manifest.chunks.reduce((total, chunk) => total + chunk.size, 0)).toBe(5);
  });
});
