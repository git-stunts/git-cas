import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* bufferSource(buf) {
  yield buf;
}

async function storeBuffer(svc, buf, opts = {}) {
  return svc.store({
    source: bufferSource(buf),
    slug: opts.slug || 'test',
    filename: opts.filename || 'test.bin',
    encryptionKey: opts.encryptionKey,
    compression: opts.compression,
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
// 1. Store + restore with compression yields original bytes
// ---------------------------------------------------------------------------
describe('CasService compression – store+restore round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('store+restore with compression yields original bytes', async () => {
    const original = Buffer.from('Hello, World! '.repeat(200));
    const manifest = await storeBuffer(service, original, {
      compression: { algorithm: 'gzip' },
    });

    const { buffer, bytesWritten } = await service.restore({ manifest });

    expect(buffer.equals(original)).toBe(true);
    expect(bytesWritten).toBe(original.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Compressed storage is smaller than uncompressed for compressible data
// ---------------------------------------------------------------------------
describe('CasService compression – size reduction', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('compressed storage is smaller than uncompressed for compressible data', async () => {
    // Highly compressible: repeating pattern
    const original = Buffer.from('AAAA'.repeat(2048));

    const manifestPlain = await storeBuffer(service, original);
    const manifestCompressed = await storeBuffer(service, original, {
      compression: { algorithm: 'gzip' },
    });

    // Sum up stored chunk sizes for each manifest
    const plainSize = manifestPlain.chunks.reduce((sum, c) => sum + c.size, 0);
    const compressedSize = manifestCompressed.chunks.reduce((sum, c) => sum + c.size, 0);

    expect(compressedSize).toBeLessThan(plainSize);
  });
});

// ---------------------------------------------------------------------------
// 3. Compression + encryption round-trip
// ---------------------------------------------------------------------------
describe('CasService compression – compression + encryption round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('round-trips data stored with both compression and encryption', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('Secret compressible content! '.repeat(100));

    const manifest = await storeBuffer(service, original, {
      compression: { algorithm: 'gzip' },
      encryptionKey: key,
    });

    expect(manifest.compression).toBeDefined();
    expect(manifest.encryption).toBeDefined();
    expect(manifest.encryption.encrypted).toBe(true);

    const { buffer, bytesWritten } = await service.restore({
      manifest,
      encryptionKey: key,
    });

    expect(buffer.equals(original)).toBe(true);
    expect(bytesWritten).toBe(original.length);
  });
});

// ---------------------------------------------------------------------------
// 4. Empty file with compression
// ---------------------------------------------------------------------------
describe('CasService compression – empty file', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('handles a 0-byte file with compression enabled', async () => {
    const original = Buffer.alloc(0);

    const manifest = await storeBuffer(service, original, {
      compression: { algorithm: 'gzip' },
    });

    expect(manifest.compression).toEqual({ algorithm: 'gzip' });

    const { buffer, bytesWritten } = await service.restore({ manifest });

    expect(buffer.length).toBe(0);
    expect(bytesWritten).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Incompressible data does not break
// ---------------------------------------------------------------------------
describe('CasService compression – incompressible data', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('incompressible data does not break round-trip', async () => {
    // Random bytes are essentially incompressible
    const original = randomBytes(2048);

    const manifest = await storeBuffer(service, original, {
      compression: { algorithm: 'gzip' },
    });

    const { buffer, bytesWritten } = await service.restore({ manifest });

    expect(buffer.equals(original)).toBe(true);
    expect(bytesWritten).toBe(original.length);
  });
});

// ---------------------------------------------------------------------------
// 6. Manifest includes compression metadata
// ---------------------------------------------------------------------------
describe('CasService compression – manifest metadata', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('manifest includes compression metadata when compression is enabled', async () => {
    const original = Buffer.from('Some data to compress');

    const manifest = await storeBuffer(service, original, {
      compression: { algorithm: 'gzip' },
    });

    expect(manifest.compression).toBeDefined();
    expect(manifest.compression).toEqual({ algorithm: 'gzip' });
  });

  it('manifest does not include compression metadata when compression is not used', async () => {
    const original = Buffer.from('Some data without compression');

    const manifest = await storeBuffer(service, original);

    expect(manifest.compression).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Backward compatibility – restore without compression on uncompressed manifest
// ---------------------------------------------------------------------------
describe('CasService compression – backward compatibility', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('restores uncompressed data from a manifest with no compression field', async () => {
    const original = Buffer.from('Plain uncompressed content here');

    // Store without compression
    const manifest = await storeBuffer(service, original);

    expect(manifest.compression).toBeUndefined();

    const { buffer, bytesWritten } = await service.restore({ manifest });

    expect(buffer.equals(original)).toBe(true);
    expect(bytesWritten).toBe(original.length);
  });

  it('restores encrypted data from a manifest with no compression field', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('Encrypted but not compressed');

    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
    });

    expect(manifest.compression).toBeUndefined();
    expect(manifest.encryption).toBeDefined();

    const { buffer } = await service.restore({ manifest, encryptionKey: key });

    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Fuzz: round-trip across multiple sizes
// ---------------------------------------------------------------------------
describe('CasService compression – fuzz round-trip across sizes', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  const sizes = [0, 1, 100, 1024, 5000];

  for (const size of sizes) {
    it(`round-trips ${size} bytes with compression (seeded data)`, async () => {
      const original = Buffer.alloc(size);
      for (let b = 0; b < size; b++) {
        original[b] = (size + b * 7) & 0xff;
      }

      const manifest = await storeBuffer(service, original, {
        compression: { algorithm: 'gzip' },
      });

      const { buffer } = await service.restore({ manifest });

      expect(buffer.equals(original)).toBe(true);
    });
  }

  for (const size of sizes) {
    it(`round-trips ${size} bytes with compression + encryption (seeded data)`, async () => {
      const key = randomBytes(32);
      const original = Buffer.alloc(size);
      for (let b = 0; b < size; b++) {
        original[b] = (size * 3 + b * 13) & 0xff;
      }

      const manifest = await storeBuffer(service, original, {
        compression: { algorithm: 'gzip' },
        encryptionKey: key,
      });

      const { buffer } = await service.restore({ manifest, encryptionKey: key });

      expect(buffer.equals(original)).toBe(true);
    });
  }
});
