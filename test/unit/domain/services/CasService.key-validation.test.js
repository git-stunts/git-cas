import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';

function createService(mockPersistence) {
  return new CasService({
    persistence: mockPersistence,
    crypto: new NodeCryptoAdapter(),
    codec: new JsonCodec(),
    chunkSize: 1024,
  });
}

function createMockPersistence() {
  return {
    writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
  };
}

describe('CasService key validation – encrypt() valid keys', () => {
  let service;

  beforeEach(() => {
    service = createService(createMockPersistence());
  });

  const plaintext = Buffer.from('hello world');

  it('accepts a 32-byte Buffer key', async () => {
    const key = Buffer.alloc(32, 0xaa);
    await expect(service.encrypt({ buffer: plaintext, key })).resolves.toBeDefined();
  });

  it('accepts crypto.randomBytes(32)', async () => {
    const key = randomBytes(32);
    await expect(service.encrypt({ buffer: plaintext, key })).resolves.toBeDefined();
  });
});

describe('CasService key validation – encrypt() invalid key length', () => {
  let service;

  beforeEach(() => {
    service = createService(createMockPersistence());
  });

  const plaintext = Buffer.from('hello world');

  it('throws INVALID_KEY_LENGTH for a 16-byte key', async () => {
    const key = Buffer.alloc(16);
    await expect(service.encrypt({ buffer: plaintext, key })).rejects.toThrow(CasError);
    try {
      await service.encrypt({ buffer: plaintext, key });
    } catch (err) {
      expect(err.code).toBe('INVALID_KEY_LENGTH');
      expect(err.message).toContain('32 bytes');
      expect(err.meta).toEqual({ expected: 32, actual: 16 });
    }
  });

  it('throws INVALID_KEY_LENGTH for a 64-byte key', async () => {
    const key = Buffer.alloc(64);
    await expect(service.encrypt({ buffer: plaintext, key })).rejects.toThrow(CasError);
    try {
      await service.encrypt({ buffer: plaintext, key });
    } catch (err) {
      expect(err.code).toBe('INVALID_KEY_LENGTH');
      expect(err.message).toContain('32 bytes');
      expect(err.meta).toEqual({ expected: 32, actual: 64 });
    }
  });

  it('throws INVALID_KEY_LENGTH for an empty Buffer', async () => {
    const key = Buffer.alloc(0);
    await expect(service.encrypt({ buffer: plaintext, key })).rejects.toThrow(CasError);
    try {
      await service.encrypt({ buffer: plaintext, key });
    } catch (err) {
      expect(err.code).toBe('INVALID_KEY_LENGTH');
      expect(err.meta).toEqual({ expected: 32, actual: 0 });
    }
  });
});

describe('CasService key validation – encrypt() invalid key type', () => {
  let service;

  beforeEach(() => {
    service = createService(createMockPersistence());
  });

  const plaintext = Buffer.from('hello world');

  it('throws INVALID_KEY_TYPE for a string key', async () => {
    const key = 'not-a-buffer-key-string-value!!!';
    await expect(service.encrypt({ buffer: plaintext, key })).rejects.toThrow(CasError);
    try {
      await service.encrypt({ buffer: plaintext, key });
    } catch (err) {
      expect(err.code).toBe('INVALID_KEY_TYPE');
      expect(err.message).toContain('must be a Buffer or Uint8Array');
    }
  });

  it('throws INVALID_KEY_TYPE for a number key', async () => {
    const key = 12345;
    await expect(service.encrypt({ buffer: plaintext, key })).rejects.toThrow(CasError);
    try {
      await service.encrypt({ buffer: plaintext, key });
    } catch (err) {
      expect(err.code).toBe('INVALID_KEY_TYPE');
      expect(err.message).toContain('must be a Buffer or Uint8Array');
    }
  });

  it('throws INVALID_KEY_TYPE for null key', async () => {
    const key = null;
    await expect(service.encrypt({ buffer: plaintext, key })).rejects.toThrow(CasError);
    try {
      await service.encrypt({ buffer: plaintext, key });
    } catch (err) {
      expect(err.code).toBe('INVALID_KEY_TYPE');
      expect(err.message).toContain('must be a Buffer or Uint8Array');
    }
  });
});

describe('CasService key validation – store() valid keys', () => {
  let service;
  let tempDir;
  let filePath;

  beforeEach(() => {
    service = createService(createMockPersistence());
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'cas-key-test-'));
    filePath = path.join(tempDir, 'test.txt');
    writeFileSync(filePath, 'test content');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('accepts a 32-byte Buffer encryptionKey', async () => {
    const key = Buffer.alloc(32, 0xbb);
    await expect(
      service.store({ source: createReadStream(filePath), slug: 's', filename: 'f.txt', encryptionKey: key }),
    ).resolves.toBeDefined();
  });

  it('accepts crypto.randomBytes(32) as encryptionKey', async () => {
    const key = randomBytes(32);
    await expect(
      service.store({ source: createReadStream(filePath), slug: 's', filename: 'f.txt', encryptionKey: key }),
    ).resolves.toBeDefined();
  });

  it('stores without error when no encryptionKey is provided', async () => {
    await expect(
      service.store({ source: createReadStream(filePath), slug: 's', filename: 'f.txt' }),
    ).resolves.toBeDefined();
  });

  it('does not throw for null encryptionKey (treated as no key)', async () => {
    await expect(
      service.store({ source: createReadStream(filePath), slug: 's', filename: 'f.txt', encryptionKey: null }),
    ).resolves.toBeDefined();
  });
});

describe('CasService key validation – store() invalid keys', () => {
  let service;

  beforeEach(() => {
    service = createService(createMockPersistence());
  });

  async function* emptySource() {}

  it('throws INVALID_KEY_LENGTH for a 16-byte encryptionKey', async () => {
    const key = Buffer.alloc(16);
    await expect(
      service.store({ source: emptySource(), slug: 's', filename: 'f.txt', encryptionKey: key }),
    ).rejects.toThrow(CasError);
  });

  it('throws INVALID_KEY_LENGTH for a 64-byte encryptionKey', async () => {
    const key = Buffer.alloc(64);
    await expect(
      service.store({ source: emptySource(), slug: 's', filename: 'f.txt', encryptionKey: key }),
    ).rejects.toThrow(CasError);
  });

  it('throws INVALID_KEY_TYPE for a string encryptionKey', async () => {
    const key = 'string-key';
    await expect(
      service.store({ source: emptySource(), slug: 's', filename: 'f.txt', encryptionKey: key }),
    ).rejects.toThrow(CasError);
  });

  it('throws INVALID_KEY_TYPE for a number encryptionKey', async () => {
    const key = 42;
    await expect(
      service.store({ source: emptySource(), slug: 's', filename: 'f.txt', encryptionKey: key }),
    ).rejects.toThrow(CasError);
  });
});

describe('CasService key validation – fuzz: key lengths 0..128', () => {
  let service;

  beforeEach(() => {
    service = createService(createMockPersistence());
  });

  const plaintext = Buffer.from('fuzz test data');

  it('only length 32 passes for encrypt()', async () => {
    for (let len = 0; len <= 128; len++) {
      const key = Buffer.alloc(len, 0xff);
      if (len === 32) {
        await expect(service.encrypt({ buffer: plaintext, key })).resolves.toBeDefined();
      } else {
        await expect(service.encrypt({ buffer: plaintext, key })).rejects.toThrow(CasError);
      }
    }
  });
});