import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';

// ---------------------------------------------------------------------------
// 1. Round-trip golden path
// ---------------------------------------------------------------------------
describe('CasService encryption – round-trip golden path', () => {
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
// 2a. Integrity failures – wrong key and tampered ciphertext
// ---------------------------------------------------------------------------
describe('CasService encryption – wrong key and tampered ciphertext', () => {
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

  it('throws INTEGRITY_ERROR when a bit is flipped in the encrypted buffer', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('this is sensitive data');

    const { buf, meta } = service.encrypt({ buffer: plaintext, key });

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
// 2b. Integrity failures – tampered auth tag and tampered nonce
// ---------------------------------------------------------------------------
describe('CasService encryption – tampered auth tag', () => {
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

  it('throws INTEGRITY_ERROR when the auth tag is modified', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('protected payload');

    const { buf, meta } = service.encrypt({ buffer: plaintext, key });

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
// 2c. Integrity failures – tampered nonce
// ---------------------------------------------------------------------------
describe('CasService encryption – tampered nonce', () => {
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

  it('throws INTEGRITY_ERROR when the nonce is modified', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('nonce-sensitive content');

    const { buf, meta } = service.encrypt({ buffer: plaintext, key });

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
// 3. Passthrough (no encryption)
// ---------------------------------------------------------------------------
describe('CasService encryption – passthrough', () => {
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
// 4. Fuzz round-trip
// ---------------------------------------------------------------------------
describe('CasService encryption – fuzz round-trip', () => {
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

  const key = randomBytes(32);

  for (let i = 0; i < 50; i++) {
    const size = Math.floor((i / 49) * 100 * 1024);

    it(`round-trips a ${size}-byte buffer (iteration ${i})`, () => {
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
// 5. Fuzz tamper detection
// ---------------------------------------------------------------------------
describe('CasService encryption – fuzz tamper', () => {
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

  const key = randomBytes(32);

  for (let i = 0; i < 50; i++) {
    const size = Math.max(1, Math.floor((i / 49) * 1024));

    it(`detects tamper on a ${size}-byte buffer (iteration ${i})`, () => {
      const plaintext = Buffer.alloc(size);
      for (let b = 0; b < size; b++) {
        plaintext[b] = (i * 7 + b) & 0xff;
      }

      const { buf, meta } = service.encrypt({ buffer: plaintext, key });

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
