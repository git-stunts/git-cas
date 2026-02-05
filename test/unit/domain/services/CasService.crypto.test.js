import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';

describe('CasService encryption round-trip', () => {
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

  // ---------------------------------------------------------------------------
  // Round-trip (Golden path)
  // ---------------------------------------------------------------------------
  describe('round-trip golden path', () => {
    const key = randomBytes(32);

    it('encrypts then decrypts a 0-byte buffer', () => {
      const plaintext = Buffer.alloc(0);
      const { buf, meta } = service.encrypt({ buffer: plaintext, key });
      const decrypted = service.decrypt({ buffer: buf, key, meta });
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('encrypts then decrypts a 1-byte buffer', () => {
      const plaintext = Buffer.from([0x42]);
      const { buf, meta } = service.encrypt({ buffer: plaintext, key });
      const decrypted = service.decrypt({ buffer: buf, key, meta });
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('encrypts then decrypts a 1 KB buffer', () => {
      const plaintext = randomBytes(1024);
      const { buf, meta } = service.encrypt({ buffer: plaintext, key });
      const decrypted = service.decrypt({ buffer: buf, key, meta });
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('encrypts then decrypts a 1 MB buffer', () => {
      const plaintext = randomBytes(1024 * 1024);
      const { buf, meta } = service.encrypt({ buffer: plaintext, key });
      const decrypted = service.decrypt({ buffer: buf, key, meta });
      expect(decrypted.equals(plaintext)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Wrong key
  // ---------------------------------------------------------------------------
  describe('wrong key', () => {
    it('throws INTEGRITY_ERROR when decrypting with a different key', () => {
      const keyA = randomBytes(32);
      const keyB = randomBytes(32);
      const plaintext = Buffer.from('secret message');

      const { buf, meta } = service.encrypt({ buffer: plaintext, key: keyA });

      expect(() => service.decrypt({ buffer: buf, key: keyB, meta })).toThrow(CasError);
      try {
        service.decrypt({ buffer: buf, key: keyB, meta });
      } catch (err) {
        expect(err.code).toBe('INTEGRITY_ERROR');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Tampered ciphertext
  // ---------------------------------------------------------------------------
  describe('tampered ciphertext', () => {
    it('throws INTEGRITY_ERROR when a bit is flipped in the encrypted buffer', () => {
      const key = randomBytes(32);
      const plaintext = Buffer.from('this is sensitive data');

      const { buf, meta } = service.encrypt({ buffer: plaintext, key });

      // Flip the first bit of the first byte
      const tampered = Buffer.from(buf);
      tampered[0] ^= 0x01;

      expect(() => service.decrypt({ buffer: tampered, key, meta })).toThrow(CasError);
      try {
        service.decrypt({ buffer: tampered, key, meta });
      } catch (err) {
        expect(err.code).toBe('INTEGRITY_ERROR');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Tampered auth tag
  // ---------------------------------------------------------------------------
  describe('tampered auth tag', () => {
    it('throws INTEGRITY_ERROR when the auth tag is modified', () => {
      const key = randomBytes(32);
      const plaintext = Buffer.from('protected payload');

      const { buf, meta } = service.encrypt({ buffer: plaintext, key });

      // Decode tag, flip one bit, re-encode
      const tagBuf = Buffer.from(meta.tag, 'base64');
      tagBuf[0] ^= 0x01;
      const tamperedMeta = { ...meta, tag: tagBuf.toString('base64') };

      expect(() => service.decrypt({ buffer: buf, key, meta: tamperedMeta })).toThrow(CasError);
      try {
        service.decrypt({ buffer: buf, key, meta: tamperedMeta });
      } catch (err) {
        expect(err.code).toBe('INTEGRITY_ERROR');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Tampered nonce
  // ---------------------------------------------------------------------------
  describe('tampered nonce', () => {
    it('throws INTEGRITY_ERROR when the nonce is modified', () => {
      const key = randomBytes(32);
      const plaintext = Buffer.from('nonce-sensitive content');

      const { buf, meta } = service.encrypt({ buffer: plaintext, key });

      // Decode nonce, flip one bit, re-encode
      const nonceBuf = Buffer.from(meta.nonce, 'base64');
      nonceBuf[0] ^= 0x01;
      const tamperedMeta = { ...meta, nonce: nonceBuf.toString('base64') };

      expect(() => service.decrypt({ buffer: buf, key, meta: tamperedMeta })).toThrow(CasError);
      try {
        service.decrypt({ buffer: buf, key, meta: tamperedMeta });
      } catch (err) {
        expect(err.code).toBe('INTEGRITY_ERROR');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Passthrough - meta.encrypted = false
  // ---------------------------------------------------------------------------
  describe('passthrough', () => {
    it('returns buffer unchanged when meta.encrypted is false', () => {
      const buffer = Buffer.from('not encrypted');
      const result = service.decrypt({ buffer, key: undefined, meta: { encrypted: false } });
      expect(result.equals(buffer)).toBe(true);
    });

    it('returns buffer unchanged when meta is undefined', () => {
      const buffer = Buffer.from('no meta at all');
      const result = service.decrypt({ buffer, key: undefined, meta: undefined });
      expect(result.equals(buffer)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Fuzz round-trip
  // ---------------------------------------------------------------------------
  describe('fuzz round-trip', () => {
    const key = randomBytes(32);

    for (let i = 0; i < 50; i++) {
      // Deterministic sizes from 0 to ~100 KB spread across 50 iterations
      const size = Math.floor((i / 49) * 100 * 1024);

      it(`round-trips a ${size}-byte buffer (iteration ${i})`, () => {
        // Build a deterministic buffer: each byte = (i + byteIndex) & 0xff
        const plaintext = Buffer.alloc(size);
        for (let b = 0; b < size; b++) {
          plaintext[b] = (i + b) & 0xff;
        }

        const { buf, meta } = service.encrypt({ buffer: plaintext, key });
        const decrypted = service.decrypt({ buffer: buf, key, meta });
        expect(decrypted.equals(plaintext)).toBe(true);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Fuzz tamper
  // ---------------------------------------------------------------------------
  describe('fuzz tamper', () => {
    const key = randomBytes(32);

    for (let i = 0; i < 50; i++) {
      // Use a minimum size of 1 so we always have at least one byte to tamper
      const size = Math.max(1, Math.floor((i / 49) * 1024));

      it(`detects tamper on a ${size}-byte buffer (iteration ${i})`, () => {
        const plaintext = Buffer.alloc(size);
        for (let b = 0; b < size; b++) {
          plaintext[b] = (i * 7 + b) & 0xff;
        }

        const { buf, meta } = service.encrypt({ buffer: plaintext, key });

        // Tamper one byte at a deterministic index
        const tampered = Buffer.from(buf);
        const tamperIndex = i % tampered.length;
        tampered[tamperIndex] ^= 0x01;

        expect(() => service.decrypt({ buffer: tampered, key, meta })).toThrow(CasError);
        try {
          service.decrypt({ buffer: tampered, key, meta });
        } catch (err) {
          expect(err.code).toBe('INTEGRITY_ERROR');
        }
      });
    }
  });
});
