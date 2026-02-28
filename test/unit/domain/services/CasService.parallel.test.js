import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';

const testCrypto = await getTestCryptoAdapter();

function setup(concurrency = 1) {
  const crypto = testCrypto;
  const blobStore = new Map();

  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation(async (content) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = await crypto.sha256(buf);
      blobStore.set(oid, buf);
      return oid;
    }),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockImplementation(async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return buf;
    }),
  };

  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunkSize: 1024,
    concurrency,
  });

  return { crypto, blobStore, mockPersistence, service };
}

async function storeBuffer(svc, buf, opts = {}) {
  async function* source() { yield buf; }
  return svc.store({
    source: source(),
    slug: opts.slug || 'test',
    filename: opts.filename || 'test.bin',
    encryptionKey: opts.encryptionKey,
    compression: opts.compression,
  });
}

describe('Parallel I/O – sequential baseline', () => {
  it('concurrency: 1 — round-trip', async () => {
    const { service } = setup(1);
    const original = randomBytes(4096);
    const manifest = await storeBuffer(service, original);
    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });
});

describe('Parallel I/O – concurrent store+restore', () => {
  it('concurrency: 4 — byte-identical round-trip', async () => {
    const { service } = setup(4);
    const original = randomBytes(8192);
    const manifest = await storeBuffer(service, original);
    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });

  it('concurrency: 4 — chunks are in order', async () => {
    const { service } = setup(4);
    const manifest = await storeBuffer(service, randomBytes(4096));
    for (let i = 0; i < manifest.chunks.length; i++) {
      expect(manifest.chunks[i].index).toBe(i);
    }
  });

  it('concurrency: 4 — restoreStream correct', async () => {
    const { service } = setup(4);
    const original = randomBytes(4096);
    const manifest = await storeBuffer(service, original);
    const chunks = [];
    for await (const c of service.restoreStream({ manifest })) { chunks.push(c); }
    expect(Buffer.concat(chunks).equals(original)).toBe(true);
  });
});

describe('Parallel I/O – encrypted + compressed', () => {
  it('concurrency: 4 with encryption + compression', async () => {
    const { service } = setup(4);
    const original = Buffer.alloc(4096, 'X');
    const key = randomBytes(32);
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key, compression: { algorithm: 'gzip' },
    });
    const { buffer } = await service.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);
  });

  it('1-chunk file with concurrency: 10', async () => {
    const { service } = setup(10);
    const original = randomBytes(512);
    const manifest = await storeBuffer(service, original);
    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });
});

describe('Parallel I/O – stream error', () => {
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

  it('concurrency: 4 — STREAM_ERROR with correct chunksDispatched', async () => {
    const { service } = setup(4);
    try {
      await service.store({
        source: failingSource(3),
        slug: 'parallel-fail',
        filename: 'fail.bin',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('STREAM_ERROR');
      expect(err.meta.chunksDispatched).toBe(3);
    }
  });
});

describe('Parallel I/O – validation', () => {
  it('invalid concurrency: 0 throws', () => {
    expect(() => setup(0)).toThrow('Concurrency must be a positive integer');
  });

  it('invalid concurrency: -1 throws', () => {
    expect(() => setup(-1)).toThrow('Concurrency must be a positive integer');
  });
});
