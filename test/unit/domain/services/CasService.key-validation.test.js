import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';

describe('CasService key validation', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
      readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
    };
    service = new CasService({
      persistence: mockPersistence,
      crypto: new NodeCryptoAdapter(),
      codec: new JsonCodec(),
      chunkSize: 1024,
    });
  });

  describe('encrypt() key validation', () => {
    const plaintext = Buffer.from('hello world');

    it('accepts a 32-byte Buffer key', () => {
      const key = Buffer.alloc(32, 0xaa);
      expect(() => service.encrypt({ buffer: plaintext, key })).not.toThrow();
    });

    it('accepts crypto.randomBytes(32)', () => {
      const key = randomBytes(32);
      expect(() => service.encrypt({ buffer: plaintext, key })).not.toThrow();
    });

    it('throws INVALID_KEY_LENGTH for a 16-byte key', () => {
      const key = Buffer.alloc(16);
      expect(() => service.encrypt({ buffer: plaintext, key })).toThrow(CasError);
      try {
        service.encrypt({ buffer: plaintext, key });
      } catch (err) {
        expect(err.code).toBe('INVALID_KEY_LENGTH');
        expect(err.message).toContain('32 bytes');
        expect(err.meta).toEqual({ expected: 32, actual: 16 });
      }
    });

    it('throws INVALID_KEY_LENGTH for a 64-byte key', () => {
      const key = Buffer.alloc(64);
      expect(() => service.encrypt({ buffer: plaintext, key })).toThrow(CasError);
      try {
        service.encrypt({ buffer: plaintext, key });
      } catch (err) {
        expect(err.code).toBe('INVALID_KEY_LENGTH');
        expect(err.message).toContain('32 bytes');
        expect(err.meta).toEqual({ expected: 32, actual: 64 });
      }
    });

    it('throws INVALID_KEY_LENGTH for an empty Buffer', () => {
      const key = Buffer.alloc(0);
      expect(() => service.encrypt({ buffer: plaintext, key })).toThrow(CasError);
      try {
        service.encrypt({ buffer: plaintext, key });
      } catch (err) {
        expect(err.code).toBe('INVALID_KEY_LENGTH');
        expect(err.meta).toEqual({ expected: 32, actual: 0 });
      }
    });

    it('throws INVALID_KEY_TYPE for a string key', () => {
      const key = 'not-a-buffer-key-string-value!!!';
      expect(() => service.encrypt({ buffer: plaintext, key })).toThrow(CasError);
      try {
        service.encrypt({ buffer: plaintext, key });
      } catch (err) {
        expect(err.code).toBe('INVALID_KEY_TYPE');
        expect(err.message).toContain('must be a Buffer');
      }
    });

    it('throws INVALID_KEY_TYPE for a number key', () => {
      const key = 12345;
      expect(() => service.encrypt({ buffer: plaintext, key })).toThrow(CasError);
      try {
        service.encrypt({ buffer: plaintext, key });
      } catch (err) {
        expect(err.code).toBe('INVALID_KEY_TYPE');
        expect(err.message).toContain('must be a Buffer');
      }
    });

    it('throws INVALID_KEY_TYPE for null key', () => {
      const key = null;
      expect(() => service.encrypt({ buffer: plaintext, key })).toThrow(CasError);
      try {
        service.encrypt({ buffer: plaintext, key });
      } catch (err) {
        expect(err.code).toBe('INVALID_KEY_TYPE');
        expect(err.message).toContain('must be a Buffer');
      }
    });
  });

  describe('store() key validation', () => {
    let tempDir;
    let filePath;

    beforeEach(() => {
      tempDir = mkdtempSync(path.join(os.tmpdir(), 'cas-key-test-'));
      filePath = path.join(tempDir, 'test.txt');
      writeFileSync(filePath, 'test content');
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    /** Dummy async iterable that yields nothing — avoids opening a real fd. */
    async function* emptySource() {}

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

    it('does not throw for null encryptionKey (treated as no key)', async () => {
      // null is falsy, so store skips validation entirely
      await expect(
        service.store({ source: createReadStream(filePath), slug: 's', filename: 'f.txt', encryptionKey: null }),
      ).resolves.toBeDefined();
    });
  });

  describe('fuzz: key lengths 0..128', () => {
    const plaintext = Buffer.from('fuzz test data');

    it('only length 32 passes for encrypt()', () => {
      for (let len = 0; len <= 128; len++) {
        const key = Buffer.alloc(len, 0xff);
        if (len === 32) {
          expect(() => service.encrypt({ buffer: plaintext, key })).not.toThrow();
        } else {
          expect(() => service.encrypt({ buffer: plaintext, key })).toThrow(CasError);
        }
      }
    });
  });
});
