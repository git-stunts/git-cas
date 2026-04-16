import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';

const testCrypto = await getTestCryptoAdapter();

/** Deterministic SHA-256 hex digest for a given string. */
const sha256 = (str) => createHash('sha256').update(str).digest('hex');

describe('CasService – constructor – chunkSize validation', () => {
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
      readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
    };
  });

  it('throws when chunkSize is 0', () => {
    expect(
      () => new CasService({ persistence: mockPersistence, crypto: testCrypto, codec: new JsonCodec(), chunkSize: 0, observability: new SilentObserver() }),
    ).toThrow('Chunk size must be an integer >= 1024 bytes');
  });

  it('throws when chunkSize is 512', () => {
    expect(
      () => new CasService({ persistence: mockPersistence, crypto: testCrypto, codec: new JsonCodec(), chunkSize: 512, observability: new SilentObserver() }),
    ).toThrow('Chunk size must be an integer >= 1024 bytes');
  });

  it('accepts chunkSize of exactly 1024', () => {
    const service = new CasService({
      persistence: mockPersistence,
      crypto: testCrypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });
    expect(service.chunkSize).toBe(1024);
  });
});

describe('CasService – store – mutual exclusion and validation', () => {
  let service;

  beforeEach(() => {
    service = new CasService({
      persistence: {
        writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
        writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
        readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
      },
      crypto: testCrypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });
  });

  it('rejects when both passphrase and encryptionKey are provided', async () => {
    await expect(
      service.store({
        source: (async function* () { yield Buffer.from('x'); })(),
        slug: 'both',
        filename: 'both.bin',
        encryptionKey: Buffer.alloc(32),
        passphrase: 'secret',
      }),
    ).rejects.toThrow('Provide either encryptionKey or passphrase, not both');
  });

  it('rejects unsupported compression algorithm', async () => {
    await expect(
      service.store({
        source: (async function* () { yield Buffer.from('x'); })(),
        slug: 'brotli',
        filename: 'brotli.bin',
        compression: { algorithm: 'brotli' },
      }),
    ).rejects.toThrow('Unsupported compression algorithm: brotli');
  });
});

describe('CasService – restore – mutual exclusion', () => {
  let service;

  beforeEach(() => {
    service = new CasService({
      persistence: {
        writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
        writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
        readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
      },
      crypto: testCrypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });
  });

  it('rejects when both passphrase and encryptionKey are provided', async () => {
    const manifest = new Manifest({
      slug: 'test', filename: 'test.bin', size: 0, chunks: [],
      encryption: {
        algorithm: 'aes-256-gcm', nonce: 'abc', tag: 'def', encrypted: true,
        kdf: { algorithm: 'pbkdf2', salt: 'c2FsdA==', iterations: 1000, keyLength: 32 },
      },
    });
    await expect(
      service.restore({ manifest, encryptionKey: Buffer.alloc(32), passphrase: 'secret' }),
    ).rejects.toThrow('Provide either encryptionKey or passphrase, not both');
  });

  it('rejects passphrase when manifest has no KDF metadata', async () => {
    const manifest = new Manifest({
      slug: 'test', filename: 'test.bin', size: 0, chunks: [],
      encryption: { algorithm: 'aes-256-gcm', nonce: 'abc', tag: 'def', encrypted: true },
    });
    await expect(
      service.restore({ manifest, passphrase: 'secret' }),
    ).rejects.toThrow('Manifest was not stored with passphrase-based encryption');
  });
});

describe('CasService – store', () => {
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
      readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
    };
  });

  it('rejects when source stream errors (nonexistent file)', async () => {
    const service = new CasService({
      persistence: mockPersistence,
      crypto: testCrypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });

    await expect(
      service.store({
        source: createReadStream('/no/such/file.bin'),
        slug: 'bad-path',
        filename: 'file.bin',
      }),
    ).rejects.toThrow();
  });
});

describe('CasService – verifyIntegrity (plain)', () => {
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
      readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
    };
  });

  it('returns false (not throws) when blob data is corrupted', async () => {
    const originalData = 'original-content';
    const correctDigest = sha256(originalData);

    // readBlob returns corrupted data that does not match the digest
    mockPersistence.readBlob = vi
      .fn()
      .mockResolvedValue(Buffer.from('corrupted-content'));

    const service = new CasService({
      persistence: mockPersistence,
      crypto: testCrypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });

    const manifest = new Manifest({
      slug: 'integrity-test',
      filename: 'file.bin',
      size: originalData.length,
      chunks: [
        {
          index: 0,
          size: originalData.length,
          blob: 'blob-oid-1',
          digest: correctDigest,
        },
      ],
    });

    const result = await service.verifyIntegrity(manifest);
    expect(result).toBe(false);
  });
});

describe('CasService – verifyIntegrity (encrypted without credentials)', () => {
  it('returns false for encrypted content when no key is provided', async () => {
    const key = Buffer.alloc(32, 0x11);
    const service = new CasService({
      persistence: {
        writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
        writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
        readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
      },
      crypto: testCrypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });

    async function* source() { yield Buffer.from('encrypted verify requires auth'); }
    const manifest = await service.store({
      source: source(),
      slug: 'encrypted-verify-no-key',
      filename: 'file.bin',
      encryptionKey: key,
    });

    await expect(service.verifyIntegrity(manifest)).resolves.toBe(false);
  });
});

describe('CasService – verifyIntegrity (encrypted tampering)', () => {
  it('returns false when encrypted manifest auth metadata is tampered', async () => {
    const key = Buffer.alloc(32, 0x22);
    const blobStore = new Map();
    const crypto = testCrypto;
    const service = new CasService({
      persistence: {
        writeBlob: vi.fn().mockImplementation(async (content) => {
          const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
          const oid = await crypto.sha256(buf);
          blobStore.set(oid, buf);
          return oid;
        }),
        writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
        readBlob: vi.fn().mockImplementation(async (oid) => blobStore.get(oid)),
      },
      crypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });

    async function* source() { yield Buffer.from('encrypted verify detects tag tamper'); }
    const manifest = await service.store({
      source: source(),
      slug: 'encrypted-verify-tag',
      filename: 'file.bin',
      encryptionKey: key,
    });

    const tamperedManifest = new Manifest({
      ...manifest.toJSON(),
      encryption: {
        ...manifest.encryption,
        tag: Buffer.from('tampered-tag').toString('base64'),
      },
    });

    await expect(
      service.verifyIntegrity(tamperedManifest, { encryptionKey: key }),
    ).resolves.toBe(false);
  });
});

describe('CasService – verifyIntegrity (encrypted scheme routing)', () => {
  it('returns false when encrypted manifest scheme is unknown', async () => {
    const key = Buffer.alloc(32, 0x33);
    const blobStore = new Map();
    const crypto = testCrypto;
    const service = new CasService({
      persistence: {
        writeBlob: vi.fn().mockImplementation(async (content) => {
          const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
          const oid = await crypto.sha256(buf);
          blobStore.set(oid, buf);
          return oid;
        }),
        writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
        readBlob: vi.fn().mockImplementation(async (oid) => blobStore.get(oid)),
      },
      crypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });

    async function* source() { yield Buffer.from('encrypted verify detects unknown scheme'); }
    const manifest = await service.store({
      source: source(),
      slug: 'encrypted-verify-scheme',
      filename: 'file.bin',
      encryptionKey: key,
    });

    await expect(
      service.verifyIntegrity(
        new Manifest({
          ...manifest.toJSON(),
          encryption: { ...manifest.encryption, scheme: 'mystery-v9' },
        }),
        { encryptionKey: key },
      ),
    ).resolves.toBe(false);
  });
});

describe('CasService – createTree', () => {
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
      readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
    };
  });

  it('throws when manifest is not a valid Manifest object', async () => {
    const service = new CasService({
      persistence: mockPersistence,
      crypto: testCrypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });

    // A plain object that lacks .toJSON() and .chunks
    await expect(
      service.createTree({ manifest: {} }),
    ).rejects.toThrow();
  });

  it('throws when manifest.toJSON is not a function', async () => {
    const service = new CasService({
      persistence: mockPersistence,
      crypto: testCrypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });

    const badManifest = { toJSON: 'not-a-function', chunks: [] };

    await expect(
      service.createTree({ manifest: badManifest }),
    ).rejects.toThrow();
  });
});
