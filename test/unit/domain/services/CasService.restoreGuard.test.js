import { describe, it, expect, vi } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

const testCrypto = await getTestCryptoAdapter();

function setup({ maxRestoreBufferSize } = {}) {
  const mockPersistence = {
    writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockResolvedValue(Buffer.alloc(1024, 0xaa)),
    readTree: vi.fn(),
  };
  const opts = {
    persistence: mockPersistence,
    crypto: testCrypto,
    codec: new JsonCodec(),
    chunkSize: 1024,
    observability: new SilentObserver(),
  };
  if (maxRestoreBufferSize !== undefined) {
    opts.maxRestoreBufferSize = maxRestoreBufferSize;
  }
  const service = new CasService(opts);
  return { mockPersistence, service };
}

function makeEncryptedManifest(chunkSizes) {
  const chunks = chunkSizes.map((size, i) => ({
    index: i,
    size,
    digest: 'a'.repeat(64),
    blob: `blob-${i}`,
  }));
  return new Manifest({
    slug: 'test',
    filename: 'test.bin',
    size: chunkSizes.reduce((a, b) => a + b, 0),
    chunks,
    encryption: {
      algorithm: 'aes-256-gcm',
      nonce: Buffer.alloc(12).toString('base64'),
      tag: Buffer.alloc(16).toString('base64'),
      encrypted: true,
    },
  });
}

describe('CasService — RESTORE_TOO_LARGE throws on exceed', () => {
  it('throws RESTORE_TOO_LARGE when chunk sizes exceed limit', async () => {
    const { service } = setup({ maxRestoreBufferSize: 2000 });
    const manifest = makeEncryptedManifest([1024, 1024, 1024]);

    await expect(
      service.restoreStream({ manifest, encryptionKey: Buffer.alloc(32, 0xab) }).next(),
    ).rejects.toThrow(CasError);

    try {
      await service.restoreStream({ manifest, encryptionKey: Buffer.alloc(32, 0xab) }).next();
    } catch (err) {
      expect(err.code).toBe('RESTORE_TOO_LARGE');
      expect(err.meta.size).toBe(3072);
      expect(err.meta.limit).toBe(2000);
    }
  });
});

describe('CasService — RESTORE_TOO_LARGE succeeds within limit', () => {
  it('succeeds when within limit', async () => {
    const { service, mockPersistence } = setup({ maxRestoreBufferSize: 4096 });
    const key = Buffer.alloc(32, 0xab);

    async function* source() { yield Buffer.alloc(512, 0xaa); }
    const manifest = await service.store({ source: source(), slug: 'ok', filename: 'ok.bin', encryptionKey: key });

    const storedBlobArgs = mockPersistence.writeBlob.mock.calls.map((c) => c[0]);
    let blobIdx = 0;
    mockPersistence.readBlob.mockImplementation(() => Promise.resolve(storedBlobArgs[blobIdx++] || Buffer.alloc(0)));

    const chunks = [];
    for await (const chunk of service.restoreStream({ manifest, encryptionKey: key })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe('CasService — RESTORE_TOO_LARGE defaults and meta', () => {
  it('default maxRestoreBufferSize is 512 MiB', () => {
    const { service } = setup();
    expect(service.maxRestoreBufferSize).toBe(512 * 1024 * 1024);
  });

  it('error meta includes size and limit', async () => {
    const { service } = setup({ maxRestoreBufferSize: 2048 });
    const manifest = makeEncryptedManifest([1100, 1100]);

    try {
      await service.restoreStream({ manifest, encryptionKey: Buffer.alloc(32, 0xab) }).next();
    } catch (err) {
      expect(err.code).toBe('RESTORE_TOO_LARGE');
      expect(err.meta).toHaveProperty('size', 2200);
      expect(err.meta).toHaveProperty('limit', 2048);
    }
  });
});

describe('CasService — RESTORE_TOO_LARGE after decompression', () => {
  it('throws when decompressed size exceeds limit', async () => {
    const { service, mockPersistence } = setup({ maxRestoreBufferSize: 4096 });
    const key = Buffer.alloc(32, 0xab);

    // Store a small encrypted+compressed manifest that fits pre-decompression
    async function* source() { yield Buffer.alloc(2048, 0xaa); }
    const manifest = await service.store({
      source: source(), slug: 'bomb', filename: 'bomb.bin',
      encryptionKey: key, compression: { algorithm: 'gzip' },
    });

    // Wire readBlob to return the stored blobs
    const storedBlobs = mockPersistence.writeBlob.mock.calls.map((c) => c[0]);
    let idx = 0;
    mockPersistence.readBlob.mockImplementation(() => Promise.resolve(storedBlobs[idx++] || Buffer.alloc(0)));

    // Mock _decompress to return a buffer larger than the limit
    service._decompress = vi.fn().mockResolvedValue(Buffer.alloc(8192, 0xbb));

    await expect(
      service.restoreStream({ manifest, encryptionKey: key }).next(),
    ).rejects.toMatchObject({ code: 'RESTORE_TOO_LARGE' });
  });
});

describe('CasService — maxRestoreBufferSize validation', () => {
  it('throws for non-integer', () => {
    expect(() => setup({ maxRestoreBufferSize: 1.5 })).toThrow();
  });

  it('throws for value below 1024', () => {
    expect(() => setup({ maxRestoreBufferSize: 512 })).toThrow();
  });

  it('throws for NaN', () => {
    expect(() => setup({ maxRestoreBufferSize: NaN })).toThrow();
  });

  it('accepts 1024', () => {
    const { service } = setup({ maxRestoreBufferSize: 1024 });
    expect(service.maxRestoreBufferSize).toBe(1024);
  });
});

describe('CasService — RESTORE_TOO_LARGE does not affect streaming', () => {
  it('does not apply to unencrypted/uncompressed restoreStream', async () => {
    const { service, mockPersistence } = setup({ maxRestoreBufferSize: 1024 });
    const manifest = new Manifest({
      slug: 'plain',
      filename: 'plain.bin',
      size: 2048,
      chunks: [
        { index: 0, size: 1024, digest: 'a'.repeat(64), blob: 'blob-0' },
        { index: 1, size: 1024, digest: 'a'.repeat(64), blob: 'blob-1' },
      ],
    });

    mockPersistence.readBlob.mockResolvedValue(Buffer.alloc(1024, 0xcc));
    service._sha256 = vi.fn().mockResolvedValue('a'.repeat(64));

    const chunks = [];
    for await (const chunk of service.restoreStream({ manifest })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);
  });
});
