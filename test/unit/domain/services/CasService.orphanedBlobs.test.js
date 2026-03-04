import { describe, it, expect, vi, beforeEach } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';

const testCrypto = await getTestCryptoAdapter();

function failingSource(chunksBeforeError, chunkSize = 1024) {
  let yielded = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (yielded >= chunksBeforeError) {
            throw new Error('simulated stream failure');
          }
          yielded++;
          return { value: Buffer.alloc(chunkSize, 0xaa), done: false };
        },
      };
    },
  };
}

function buildService() {
  let blobCounter = 0;
  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation(() => Promise.resolve(`blob-${blobCounter++}`)),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
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
  return { service, mockPersistence, observability };
}

describe('CasService — orphaned blob tracking in STREAM_ERROR', () => {
  let service;
  let observability;

  beforeEach(() => {
    ({ service, observability } = buildService());
  });

  it('STREAM_ERROR meta includes orphanedBlobs array', async () => {
    try {
      await service.store({ source: failingSource(3), slug: 'fail', filename: 'f.bin' });
    } catch (err) {
      expect(err.code).toBe('STREAM_ERROR');
      expect(Array.isArray(err.meta.orphanedBlobs)).toBe(true);
    }
  });

  it('orphanedBlobs contain OIDs from successful writes', async () => {
    try {
      await service.store({ source: failingSource(3), slug: 'fail', filename: 'f.bin' });
    } catch (err) {
      expect(err.meta.orphanedBlobs.length).toBe(3);
      expect(err.meta.orphanedBlobs).toContain('blob-0');
      expect(err.meta.orphanedBlobs).toContain('blob-1');
      expect(err.meta.orphanedBlobs).toContain('blob-2');
    }
  });

  it('empty array when stream fails before any writes', async () => {
    try {
      await service.store({ source: failingSource(0), slug: 'fail', filename: 'f.bin' });
    } catch (err) {
      expect(err.meta.orphanedBlobs).toEqual([]);
    }
  });

  it('emits metric with orphaned blob count', async () => {
    try {
      await service.store({ source: failingSource(2), slug: 'fail', filename: 'f.bin' });
    } catch {
      // expected
    }
    const errorMetrics = observability.metric.mock.calls.filter((c) => c[0] === 'error');
    expect(errorMetrics.length).toBeGreaterThan(0);
    expect(errorMetrics[0][1]).toHaveProperty('orphanedBlobs', 2);
  });
});
