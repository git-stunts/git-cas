import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import CasError from '../../../../src/domain/errors/CasError.js';

// ---------------------------------------------------------------------------
// Module-level helper: store content via async iterable, return manifest
// ---------------------------------------------------------------------------
async function storeBuffer(svc, buf, opts = {}) {
  async function* source() { yield buf; }
  return svc.store({
    source: source(),
    slug: opts.slug || 'test',
    filename: opts.filename || 'test.bin',
    encryptionKey: opts.encryptionKey,
  });
}

/**
 * Shared factory: builds the standard test fixtures (crypto, blobStore,
 * mockPersistence, service) used by every describe block.
 */
function setup() {
  const crypto = new NodeCryptoAdapter();
  const blobStore = new Map();

  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation(async (content) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = crypto.sha256(buf);
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
    chunkSize: 1024,
  });

  return { crypto, blobStore, mockPersistence, service };
}

// ---------------------------------------------------------------------------
// Plaintext round-trip
// ---------------------------------------------------------------------------
describe('CasService.restore() – plaintext round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('restores a single-chunk file', async () => {
    const original = Buffer.from('hello world');
    const manifest = await storeBuffer(service, original);

    const { buffer, bytesWritten } = await service.restore({ manifest });

    expect(buffer.equals(original)).toBe(true);
    expect(bytesWritten).toBe(original.length);
  });

  it('restores a multi-chunk file', async () => {
    const original = randomBytes(3 * 1024); // 3 chunks at 1024
    const manifest = await storeBuffer(service, original);
    expect(manifest.chunks.length).toBe(3);

    const { buffer, bytesWritten } = await service.restore({ manifest });

    expect(buffer.equals(original)).toBe(true);
    expect(bytesWritten).toBe(original.length);
  });

  it('restores a file that is exact multiple of chunkSize', async () => {
    const original = randomBytes(2 * 1024);
    const manifest = await storeBuffer(service, original);
    expect(manifest.chunks.length).toBe(2);

    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Encrypted round-trip
// ---------------------------------------------------------------------------
describe('CasService.restore() – encrypted round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('restores encrypted content with correct key', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('secret data here');
    const manifest = await storeBuffer(service, original, { encryptionKey: key });

    expect(manifest.encryption).toBeDefined();
    expect(manifest.encryption.encrypted).toBe(true);

    const { buffer, bytesWritten } = await service.restore({
      manifest,
      encryptionKey: key,
    });

    expect(buffer.equals(original)).toBe(true);
    expect(bytesWritten).toBe(original.length);
  });

  it('restores multi-chunk encrypted content', async () => {
    const key = randomBytes(32);
    const original = randomBytes(3 * 1024);
    const manifest = await storeBuffer(service, original, { encryptionKey: key });

    const { buffer } = await service.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty manifest
// ---------------------------------------------------------------------------
describe('CasService.restore() – empty manifest', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('returns 0-byte buffer for empty manifest', async () => {
    const manifest = new Manifest({
      slug: 'empty',
      filename: 'empty.bin',
      size: 0,
      chunks: [],
    });

    const { buffer, bytesWritten } = await service.restore({ manifest });

    expect(buffer.length).toBe(0);
    expect(bytesWritten).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wrong key
// ---------------------------------------------------------------------------
describe('CasService.restore() – wrong key', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('throws INTEGRITY_ERROR with wrong decryption key', async () => {
    const keyA = randomBytes(32);
    const keyB = randomBytes(32);
    const original = Buffer.from('encrypted payload');
    const manifest = await storeBuffer(service, original, { encryptionKey: keyA });

    await expect(
      service.restore({ manifest, encryptionKey: keyB }),
    ).rejects.toThrow(CasError);

    try {
      await service.restore({ manifest, encryptionKey: keyB });
    } catch (err) {
      expect(err.code).toBe('INTEGRITY_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// Corrupted chunk
// ---------------------------------------------------------------------------
describe('CasService.restore() – corrupted chunk', () => {
  let service;
  let blobStore;

  beforeEach(() => {
    ({ service, blobStore } = setup());
  });

  it('throws INTEGRITY_ERROR when chunk data is corrupted', async () => {
    const original = Buffer.from('some content to store');
    const manifest = await storeBuffer(service, original);

    // Corrupt the blob in the store
    const firstChunk = manifest.chunks[0];
    const corruptBuf = Buffer.from(blobStore.get(firstChunk.blob));
    corruptBuf[0] ^= 0x01;
    blobStore.set(firstChunk.blob, corruptBuf);

    // Overwrite readBlob to return corrupted data
    // (the oid key still maps, but content is wrong)
    await expect(
      service.restore({ manifest }),
    ).rejects.toThrow(CasError);

    try {
      await service.restore({ manifest });
    } catch (err) {
      expect(err.code).toBe('INTEGRITY_ERROR');
      expect(err.meta.chunkIndex).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Key validation
// ---------------------------------------------------------------------------
describe('CasService.restore() – key validation', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('throws INVALID_KEY_LENGTH for 16-byte key', async () => {
    const manifest = new Manifest({
      slug: 'x',
      filename: 'x.bin',
      size: 0,
      chunks: [],
      encryption: { algorithm: 'aes-256-gcm', nonce: 'x', tag: 'x', encrypted: true },
    });

    await expect(
      service.restore({ manifest, encryptionKey: Buffer.alloc(16) }),
    ).rejects.toThrow(CasError);
  });

  it('throws INVALID_KEY_TYPE for string key', async () => {
    const manifest = new Manifest({
      slug: 'x',
      filename: 'x.bin',
      size: 0,
      chunks: [],
    });

    await expect(
      service.restore({ manifest, encryptionKey: 'bad-key' }),
    ).rejects.toThrow(CasError);
  });
});

// ---------------------------------------------------------------------------
// Fuzz round-trip
// ---------------------------------------------------------------------------
describe('CasService.restore() – fuzz round-trip', () => {
  let service;
  const key = randomBytes(32);

  beforeEach(() => {
    ({ service } = setup());
  });

  for (let i = 0; i < 50; i++) {
    // Sizes from 0 to 3*chunkSize spread across 50 iterations
    const size = Math.floor((i / 49) * 3 * 1024);

    it(`round-trips ${size} bytes (plaintext, iteration ${i})`, async () => {
      const original = Buffer.alloc(size);
      for (let b = 0; b < size; b++) { original[b] = (i + b) & 0xff; }

      const manifest = await storeBuffer(service, original);
      const { buffer } = await service.restore({ manifest });
      expect(buffer.equals(original)).toBe(true);
    });
  }

  for (let i = 0; i < 50; i++) {
    const size = Math.floor((i / 49) * 3 * 1024);

    it(`round-trips ${size} bytes (encrypted, iteration ${i})`, async () => {
      const original = Buffer.alloc(size);
      for (let b = 0; b < size; b++) { original[b] = (i * 3 + b) & 0xff; }

      const manifest = await storeBuffer(service, original, { encryptionKey: key });
      const { buffer } = await service.restore({ manifest, encryptionKey: key });
      expect(buffer.equals(original)).toBe(true);
    });
  }
});
