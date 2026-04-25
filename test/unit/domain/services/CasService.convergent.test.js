import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import CdcChunker from '../../../../src/infrastructure/chunkers/CdcChunker.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
const testCrypto = await getTestCryptoAdapter();

function streamOneBuffer(buf) {
  return {
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

function makeContentStore() {
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
    readBlobStream: vi.fn().mockImplementation(async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return streamOneBuffer(buf);
    }),
  };

  return { crypto, blobStore, mockPersistence };
}

function setupCdc(opts = {}) {
  const { crypto, blobStore, mockPersistence } = makeContentStore();
  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec: new JsonCodec(),
    observability: opts.observability || new SilentObserver(),
    chunkSize: opts.chunkSize || 1024,
    concurrency: opts.concurrency || 1,
    chunker: new CdcChunker({
      minChunkSize: opts.minChunkSize || 512,
      targetChunkSize: opts.targetChunkSize || 1024,
      maxChunkSize: opts.maxChunkSize || 2048,
    }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
  return { crypto, blobStore, mockPersistence, service };
}

function setupFixed(opts = {}) {
  const { crypto, blobStore, mockPersistence } = makeContentStore();
  const chunkSize = opts.chunkSize || 1024;
  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec: new JsonCodec(),
    observability: opts.observability || new SilentObserver(),
    chunkSize,
    concurrency: opts.concurrency || 1,
    chunker: new FixedChunker({ chunkSize }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
  return { crypto, blobStore, mockPersistence, service };
}

async function storeAndRestore(service, data, storeOpts = {}) {
  async function* source() { yield data; }
  const manifest = await service.store({
    source: source(),
    slug: storeOpts.slug || 'test',
    filename: storeOpts.filename || 'test.bin',
    encryptionKey: storeOpts.encryptionKey,
    passphrase: storeOpts.passphrase,
    encryption: storeOpts.encryption,
    compression: storeOpts.compression,
    recipients: storeOpts.recipients,
  });
  const { buffer } = await service.restore({
    manifest,
    encryptionKey: storeOpts.encryptionKey,
    passphrase: storeOpts.passphrase,
  });
  return { manifest, buffer };
}

// ---------------------------------------------------------------------------
// 1. Convergent round-trip
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — round-trip', () => {
  it('stores with CDC + encryption and produces convergent scheme', async () => {
    const { service } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(4096);

    const { manifest, buffer } = await storeAndRestore(service, data, { encryptionKey: key });

    expect(manifest.encryption.scheme).toBe('convergent');
    expect(manifest.encryption.algorithm).toBe('aes-256-gcm');
    expect(manifest.encryption.encrypted).toBe(true);
    expect(buffer.equals(data)).toBe(true);
  });

  it('round-trips small data (single chunk)', async () => {
    const { service } = setupCdc({ minChunkSize: 512, targetChunkSize: 8192, maxChunkSize: 16384 });
    const key = randomBytes(32);
    const data = Buffer.from('hello convergent');

    const { manifest, buffer } = await storeAndRestore(service, data, { encryptionKey: key });

    expect(manifest.encryption.scheme).toBe('convergent');
    expect(buffer.equals(data)).toBe(true);
  });

  it('round-trips empty-ish single chunk', async () => {
    const { service } = setupCdc({ minChunkSize: 1, targetChunkSize: 8192, maxChunkSize: 16384 });
    const key = randomBytes(32);
    const data = Buffer.from('x');

    const { manifest, buffer } = await storeAndRestore(service, data, { encryptionKey: key });

    expect(manifest.encryption.scheme).toBe('convergent');
    expect(buffer.equals(data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Dedup verification
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — dedup', () => {
  it('same data stored twice produces identical blob OIDs for matching chunks', async () => {
    const { service, blobStore } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(4096);

    async function* src() { yield data; }
    const m1 = await service.store({
      source: src(), slug: 'slug-a', filename: 'a.bin', encryptionKey: key,
    });

    async function* src2() { yield data; }
    const m2 = await service.store({
      source: src2(), slug: 'slug-b', filename: 'b.bin', encryptionKey: key,
    });

    // Same data with same key should produce identical chunk blobs
    expect(m1.chunks.length).toBe(m2.chunks.length);
    for (let i = 0; i < m1.chunks.length; i++) {
      expect(m1.chunks[i].blob).toBe(m2.chunks[i].blob);
      expect(m1.chunks[i].digest).toBe(m2.chunks[i].digest);
    }

    // The blob store should have the same number of unique blobs as chunks in one manifest
    const uniqueBlobs = new Set(m1.chunks.map((c) => c.blob));
    expect(uniqueBlobs.size).toBeLessThanOrEqual(blobStore.size);
  });
});

// ---------------------------------------------------------------------------
// 3. Tamper detection
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — tamper detection', () => {
  it('tampered blob fails restore with INTEGRITY_ERROR', async () => {
    const { service, blobStore } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(4096);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'tamper-test', filename: 't.bin', encryptionKey: key,
    });

    // Tamper with the first chunk's blob
    const firstBlob = manifest.chunks[0].blob;
    const stored = blobStore.get(firstBlob);
    const tampered = Buffer.from(stored);
    tampered[0] ^= 0xff;
    blobStore.set(firstBlob, tampered);

    await expect(service.restore({
      manifest, encryptionKey: key,
    })).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// 4. Wrong key fails
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — wrong key', () => {
  it('restore with wrong key fails with INTEGRITY_ERROR', async () => {
    const { service } = setupCdc();
    const keyA = randomBytes(32);
    const keyB = randomBytes(32);
    const data = randomBytes(4096);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'wrong-key', filename: 'wk.bin', encryptionKey: keyA,
    });

    await expect(service.restore({
      manifest, encryptionKey: keyB,
    })).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// 5. Default behavior
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — default behavior', () => {
  it('CDC + encryption defaults to convergent', async () => {
    const { service } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(2048);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'default-cdc', filename: 'f.bin', encryptionKey: key,
    });

    expect(manifest.encryption.scheme).toBe('convergent');
  });

  it('does not emit CDC dedup warning for convergent stores', async () => {
    const obs = {
      metric: vi.fn(),
      log: vi.fn(),
      span: vi.fn().mockReturnValue({ end: vi.fn() }),
    };
    const { service } = setupCdc({ observability: obs });
    const key = randomBytes(32);

    async function* source() { yield randomBytes(2048); }
    await service.store({
      source: source(), slug: 'no-warn', filename: 'f.bin', encryptionKey: key,
    });

    const warnCalls = obs.log.mock.calls.filter((c) => c[0] === 'warn' && c[1].includes('CDC deduplication'));
    expect(warnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Opt-out
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — opt-out', () => {
  it('convergent: false uses framed with CDC', async () => {
    const { service } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(2048);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'opt-out', filename: 'f.bin',
      encryptionKey: key,
      encryption: { convergent: false },
    });

    expect(manifest.encryption.scheme).toBe('framed');
  });

  it('explicit framed overrides convergent default', async () => {
    const { service } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(2048);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'explicit-framed', filename: 'f.bin',
      encryptionKey: key,
      encryption: { scheme: 'framed' },
    });

    expect(manifest.encryption.scheme).toBe('framed');
  });
});

// ---------------------------------------------------------------------------
// 7. Fixed chunking
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — fixed chunking', () => {
  it('fixed + encryption defaults to framed (not convergent)', async () => {
    const { service } = setupFixed();
    const key = randomBytes(32);
    const data = randomBytes(2048);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'fixed-enc', filename: 'f.bin', encryptionKey: key,
    });

    expect(manifest.encryption.scheme).toBe('framed');
  });

  it('fixed + convergent: true forces convergent', async () => {
    const { service } = setupFixed();
    const key = randomBytes(32);
    const data = randomBytes(2048);

    const { manifest, buffer } = await storeAndRestore(service, data, {
      encryptionKey: key,
      encryption: { convergent: true },
    });

    expect(manifest.encryption.scheme).toBe('convergent');
    expect(buffer.equals(data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Backward compat
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — backward compatibility', () => {
  it('framed manifests still restore correctly', async () => {
    const { service } = setupFixed();
    const key = randomBytes(32);
    const data = randomBytes(2048);

    const { manifest, buffer } = await storeAndRestore(service, data, {
      encryptionKey: key,
      encryption: { scheme: 'framed' },
    });

    expect(manifest.encryption.scheme).toBe('framed');
    expect(buffer.equals(data)).toBe(true);
  });

  it('whole manifests still restore correctly', async () => {
    const { service } = setupFixed();
    const key = randomBytes(32);
    const data = randomBytes(512);

    const { manifest, buffer } = await storeAndRestore(service, data, {
      encryptionKey: key,
      encryption: { scheme: 'whole' },
    });

    expect(manifest.encryption.scheme).toBe('whole');
    expect(buffer.equals(data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. With compression
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — compression', () => {
  it('convergent + gzip round-trips correctly', async () => {
    const { service } = setupCdc();
    const key = randomBytes(32);
    // Compressible data for gzip to work well with
    const data = Buffer.alloc(4096, 'A'.charCodeAt(0));

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'compressed-conv', filename: 'c.bin',
      encryptionKey: key, compression: { algorithm: 'gzip' },
    });

    expect(manifest.encryption.scheme).toBe('convergent');
    expect(manifest.compression.algorithm).toBe('gzip');

    const { buffer } = await service.restore({
      manifest, encryptionKey: key,
    });
    expect(buffer.equals(data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Passphrase-based convergent encryption
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — passphrase', () => {
  it('round-trips with passphrase-derived key', async () => {
    const { service } = setupCdc();
    const data = randomBytes(2048);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'pass-conv', filename: 'p.bin',
      passphrase: 'test-passphrase-123',
    });

    expect(manifest.encryption.scheme).toBe('convergent');

    const { buffer } = await service.restore({
      manifest, passphrase: 'test-passphrase-123',
    });
    expect(buffer.equals(data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. verifyIntegrity
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — verifyIntegrity', () => {
  it('passes for valid convergent-encrypted content', async () => {
    const { service } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(4096);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'verify-ok', filename: 'v.bin', encryptionKey: key,
    });

    const ok = await service.verifyIntegrity(manifest, { encryptionKey: key });
    expect(ok).toBe(true);
  });

  it('fails for tampered convergent-encrypted content', async () => {
    const { service, blobStore } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(4096);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'verify-tamper', filename: 'v.bin', encryptionKey: key,
    });

    // Tamper
    const firstBlob = manifest.chunks[0].blob;
    const stored = blobStore.get(firstBlob);
    const tampered = Buffer.from(stored);
    tampered[0] ^= 0xff;
    blobStore.set(firstBlob, tampered);

    const ok = await service.verifyIntegrity(manifest, { encryptionKey: key });
    expect(ok).toBe(false);
  });

  it('fails with wrong key', async () => {
    const { service } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(2048);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'verify-wrong-key', filename: 'v.bin', encryptionKey: key,
    });

    const ok = await service.verifyIntegrity(manifest, { encryptionKey: randomBytes(32) });
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Explicit convergent scheme
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — explicit scheme', () => {
  it('explicit scheme: convergent works with any chunker', async () => {
    const { service } = setupFixed();
    const key = randomBytes(32);
    const data = randomBytes(2048);

    const { manifest, buffer } = await storeAndRestore(service, data, {
      encryptionKey: key,
      encryption: { scheme: 'convergent' },
    });

    expect(manifest.encryption.scheme).toBe('convergent');
    expect(buffer.equals(data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. restoreStream
// ---------------------------------------------------------------------------
describe('CasService convergent encryption — restoreStream', () => {
  it('streams convergent-encrypted content chunk by chunk', async () => {
    const { service } = setupCdc();
    const key = randomBytes(32);
    const data = randomBytes(4096);

    async function* source() { yield data; }
    const manifest = await service.store({
      source: source(), slug: 'stream-conv', filename: 's.bin', encryptionKey: key,
    });

    const chunks = [];
    for await (const chunk of service.restoreStream({ manifest, encryptionKey: key })) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks).equals(data)).toBe(true);
  });
});
