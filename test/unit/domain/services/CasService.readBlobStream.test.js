import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';

const testCrypto = await getTestCryptoAdapter();

function splitBuffer(buf) {
  const pivot = Math.max(1, Math.floor(buf.length / 2));
  return [buf.subarray(0, pivot), buf.subarray(pivot)];
}

function setup({ withReadBlobStream } = {}) {
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

  if (withReadBlobStream) {
    mockPersistence.readBlobStream = vi.fn().mockImplementation(async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return {
        async *[Symbol.asyncIterator]() {
          for (const chunk of splitBuffer(buf)) {
            yield chunk;
          }
        },
      };
    });
  }

  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunkSize: 1024,
  });

  return { service, mockPersistence };
}

async function storeBuffer(service, buf) {
  async function* source() { yield buf; }
  return service.store({
    source: source(),
    slug: 'test',
    filename: 'test.bin',
  });
}

async function collectStream(iterable) {
  const chunks = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

describe('CasService restore blob reads', () => {
  it('prefers readBlobStream() for plaintext restore when available', async () => {
    const { service, mockPersistence } = setup({ withReadBlobStream: true });
    const original = randomBytes(3072);
    const manifest = await storeBuffer(service, original);

    const restored = await collectStream(service.restoreStream({ manifest }));

    expect(restored.equals(original)).toBe(true);
    expect(mockPersistence.readBlobStream).toHaveBeenCalledTimes(manifest.chunks.length);
    expect(mockPersistence.readBlob).not.toHaveBeenCalled();
  });

  it('falls back to readBlob() when readBlobStream() is unavailable', async () => {
    const { service, mockPersistence } = setup({ withReadBlobStream: false });
    const original = randomBytes(2048);
    const manifest = await storeBuffer(service, original);

    const restored = await collectStream(service.restoreStream({ manifest }));

    expect(restored.equals(original)).toBe(true);
    expect(mockPersistence.readBlob).toHaveBeenCalledTimes(manifest.chunks.length);
  });
});
