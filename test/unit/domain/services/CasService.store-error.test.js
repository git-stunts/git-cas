import { describe, it, expect, vi } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();

function createPassthroughChunker() {
  return {
    strategy: 'fixed',
    params: { chunkSize: 1024 },
    async *chunk(source) {
      yield* source;
    },
  };
}

function createSource(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

function buildService(writeBlobImpl) {
  const observability = {
    metric: vi.fn(),
    log: vi.fn(),
    span: vi.fn().mockReturnValue({ end: vi.fn() }),
  };

  const service = new CasService({
    persistence: {
      writeBlob: vi.fn(writeBlobImpl),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
      readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
    },
    crypto: testCrypto,
    codec: new JsonCodec(),
    chunkSize: 1024,
    concurrency: 1,
    chunker: createPassthroughChunker(),
    compressionAdapter: new NodeCompressionAdapter(),
    observability,
  });

  return { service, observability };
}

describe('CasService – store write failure surface (normalized raw failures)', () => {
  it('wraps raw write failures as STORE_ERROR with dispatch and orphan metadata', async () => {
    let callCount = 0;
    const { service } = buildService(async () => {
      if (callCount++ === 0) {
        return 'blob-0';
      }
      throw new Error('disk full');
    });

    const source = createSource([
      Buffer.alloc(1024, 0x01),
      Buffer.alloc(1024, 0x02),
    ]);

    await expect(
      service.store({ source, slug: 'store-error', filename: 'store-error.bin' }),
    ).rejects.toMatchObject({
      code: 'STORE_ERROR',
      meta: {
        chunksDispatched: 2,
        orphanedBlobs: ['blob-0'],
        failedIndex: 1,
      },
    });
  });
});

describe('CasService – store write failure surface (CasError passthrough)', () => {
  it('preserves CasError codes and enriches write-failure metadata', async () => {
    let callCount = 0;
    const { service } = buildService(async () => {
      if (callCount++ === 0) {
        return 'blob-0';
      }
      throw new CasError('git write failed', 'GIT_ERROR', { transport: 'git' });
    });

    const source = createSource([
      Buffer.alloc(1024, 0x01),
      Buffer.alloc(1024, 0x02),
    ]);

    await expect(
      service.store({ source, slug: 'git-error', filename: 'git-error.bin' }),
    ).rejects.toMatchObject({
      code: 'GIT_ERROR',
      meta: {
        transport: 'git',
        chunksDispatched: 2,
        orphanedBlobs: ['blob-0'],
        failedIndex: 1,
      },
    });
  });
});

describe('CasService – store write failure surface (observability)', () => {
  it('emits an error metric for normalized STORE_ERROR failures', async () => {
    let callCount = 0;
    const { service, observability } = buildService(async () => {
      if (callCount++ === 0) {
        return 'blob-0';
      }
      throw new Error('backend offline');
    });

    const source = createSource([
      Buffer.alloc(1024, 0x01),
      Buffer.alloc(1024, 0x02),
    ]);

    await expect(
      service.store({ source, slug: 'metric-error', filename: 'metric-error.bin' }),
    ).rejects.toMatchObject({ code: 'STORE_ERROR' });

    expect(observability.metric).toHaveBeenCalledWith('error', expect.objectContaining({
      code: 'STORE_ERROR',
      orphanedBlobs: 1,
      failedIndex: 1,
    }));
  });
});
