import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import EventEmitterObserver from '../../../../src/infrastructure/adapters/EventEmitterObserver.js';

function setup(opts = {}) {
  const crypto = new NodeCryptoAdapter();
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
    observability: opts.observability || new SilentObserver(),
    chunkSize: 1024,
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

async function collectStream(iterable) {
  const chunks = [];
  for await (const chunk of iterable) { chunks.push(chunk); }
  return Buffer.concat(chunks);
}

describe('restoreStream – plaintext round-trips', () => {
  it('store → restoreStream → byte-compare', async () => {
    const { service } = setup();
    const original = randomBytes(3072);
    const manifest = await storeBuffer(service, original);
    const restored = await collectStream(service.restoreStream({ manifest }));
    expect(restored.equals(original)).toBe(true);
  });

  it('handles 0-byte file', async () => {
    const { service } = setup();
    const manifest = await storeBuffer(service, Buffer.alloc(0));
    const restored = await collectStream(service.restoreStream({ manifest }));
    expect(restored.length).toBe(0);
  });

  it('handles 1-chunk file', async () => {
    const { service } = setup();
    const original = randomBytes(512);
    const manifest = await storeBuffer(service, original);
    const restored = await collectStream(service.restoreStream({ manifest }));
    expect(restored.equals(original)).toBe(true);
  });

  it('handles exact-multiple chunk file', async () => {
    const { service } = setup();
    const original = randomBytes(2048);
    const manifest = await storeBuffer(service, original);
    const restored = await collectStream(service.restoreStream({ manifest }));
    expect(restored.equals(original)).toBe(true);
  });
});

describe('restoreStream – encrypted / compressed', () => {
  it('round-trips encrypted file', async () => {
    const { service } = setup();
    const original = randomBytes(3072);
    const key = randomBytes(32);
    const manifest = await storeBuffer(service, original, { encryptionKey: key });
    const restored = await collectStream(service.restoreStream({ manifest, encryptionKey: key }));
    expect(restored.equals(original)).toBe(true);
  });

  it('round-trips compressed file', async () => {
    const { service } = setup();
    const original = Buffer.alloc(4096, 'A');
    const manifest = await storeBuffer(service, original, { compression: { algorithm: 'gzip' } });
    const restored = await collectStream(service.restoreStream({ manifest }));
    expect(restored.equals(original)).toBe(true);
  });

  it('round-trips encrypted + compressed file', async () => {
    const { service } = setup();
    const original = Buffer.alloc(4096, 'B');
    const key = randomBytes(32);
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key, compression: { algorithm: 'gzip' },
    });
    const restored = await collectStream(service.restoreStream({ manifest, encryptionKey: key }));
    expect(restored.equals(original)).toBe(true);
  });
});

describe('restoreStream – observability events', () => {
  it('emits chunk:restored events for unencrypted path', async () => {
    const observer = new EventEmitterObserver();
    const { service } = setup({ observability: observer });
    const original = randomBytes(2048);
    const manifest = await storeBuffer(service, original);
    const handler = vi.fn();
    observer.on('chunk:restored', handler);
    await collectStream(service.restoreStream({ manifest }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('emits file:restored event', async () => {
    const observer = new EventEmitterObserver();
    const { service } = setup({ observability: observer });
    const original = randomBytes(2048);
    const manifest = await storeBuffer(service, original);
    const handler = vi.fn();
    observer.on('file:restored', handler);
    await collectStream(service.restoreStream({ manifest }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'test', size: 2048, chunkCount: 2,
    }));
  });
});

describe('restoreStream – consistency with restore()', () => {
  it('returns same result as restore() collected', async () => {
    const { service } = setup();
    const original = randomBytes(3072);
    const manifest = await storeBuffer(service, original);
    const { buffer } = await service.restore({ manifest });
    const streamed = await collectStream(service.restoreStream({ manifest }));
    expect(buffer.equals(streamed)).toBe(true);
  });
});
