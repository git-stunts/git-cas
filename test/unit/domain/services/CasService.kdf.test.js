import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* bufferSource(buf) {
  yield buf;
}

/**
 * Shared factory: builds the standard test fixtures (crypto, blobStore,
 * mockPersistence, service) used by every describe block.
 */
function setup() {
  const crypto = new NodeCryptoAdapter();
  const blobs = new Map();
  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation((content) => {
      const oid = crypto.sha256(Buffer.isBuffer(content) ? content : Buffer.from(content));
      blobs.set(oid, Buffer.isBuffer(content) ? content : Buffer.from(content));
      return Promise.resolve(oid);
    }),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockImplementation((oid) => {
      const blob = blobs.get(oid);
      if (!blob) {return Promise.reject(new Error(`Blob not found: ${oid}`));}
      return Promise.resolve(blob);
    }),
  };
  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec: new JsonCodec(),
    chunkSize: 1024,
  });
  return { mockPersistence, service, blobs, crypto };
}

// ---------------------------------------------------------------------------
// 1. deriveKey with pbkdf2 returns 32-byte key
// ---------------------------------------------------------------------------
describe('CasService.deriveKey() – pbkdf2', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('deriveKey with pbkdf2 returns 32-byte key', async () => {
    const result = await service.deriveKey({ passphrase: 'test-passphrase' });

    expect(Buffer.isBuffer(result.key)).toBe(true);
    expect(result.key.length).toBe(32);
    expect(Buffer.isBuffer(result.salt)).toBe(true);
    expect(result.salt.length).toBe(32);
    expect(result.params).toBeDefined();
    expect(result.params.algorithm).toBe('pbkdf2');
    expect(result.params.keyLength).toBe(32);
    expect(typeof result.params.iterations).toBe('number');
    expect(result.params.iterations).toBeGreaterThan(0);
    expect(typeof result.params.salt).toBe('string'); // base64-encoded
  });
});

// ---------------------------------------------------------------------------
// 2. deriveKey with scrypt returns 32-byte key
// ---------------------------------------------------------------------------
describe('CasService.deriveKey() – scrypt', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('deriveKey with scrypt returns 32-byte key', async () => {
    const result = await service.deriveKey({
      passphrase: 'test-passphrase',
      algorithm: 'scrypt',
    });

    expect(Buffer.isBuffer(result.key)).toBe(true);
    expect(result.key.length).toBe(32);
    expect(Buffer.isBuffer(result.salt)).toBe(true);
    expect(result.salt.length).toBe(32);
    expect(result.params).toBeDefined();
    expect(result.params.algorithm).toBe('scrypt');
    expect(result.params.keyLength).toBe(32);
    expect(typeof result.params.cost).toBe('number');
    expect(typeof result.params.blockSize).toBe('number');
    expect(typeof result.params.parallelization).toBe('number');
    // scrypt params should NOT have iterations
    expect(result.params.iterations).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. same passphrase + salt yields same key (determinism)
// ---------------------------------------------------------------------------
describe('CasService.deriveKey() – determinism', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('same passphrase + salt yields same key', async () => {
    const salt = randomBytes(32);
    const passphrase = 'deterministic-passphrase';

    const result1 = await service.deriveKey({ passphrase, salt });
    const result2 = await service.deriveKey({ passphrase, salt });

    expect(result1.key.equals(result2.key)).toBe(true);
  });

  it('same passphrase + salt yields same key with scrypt', async () => {
    const salt = randomBytes(32);
    const passphrase = 'deterministic-passphrase-scrypt';

    const result1 = await service.deriveKey({ passphrase, salt, algorithm: 'scrypt' });
    const result2 = await service.deriveKey({ passphrase, salt, algorithm: 'scrypt' });

    expect(result1.key.equals(result2.key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. different salts yield different keys
// ---------------------------------------------------------------------------
describe('CasService.deriveKey() – different salts', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('different salts yield different keys', async () => {
    const passphrase = 'same-passphrase';
    const salt1 = randomBytes(32);
    const salt2 = randomBytes(32);

    const result1 = await service.deriveKey({ passphrase, salt: salt1 });
    const result2 = await service.deriveKey({ passphrase, salt: salt2 });

    expect(result1.key.equals(result2.key)).toBe(false);
  });

  it('different salts yield different keys with scrypt', async () => {
    const passphrase = 'same-passphrase-scrypt';
    const salt1 = randomBytes(32);
    const salt2 = randomBytes(32);

    const result1 = await service.deriveKey({ passphrase, salt: salt1, algorithm: 'scrypt' });
    const result2 = await service.deriveKey({ passphrase, salt: salt2, algorithm: 'scrypt' });

    expect(result1.key.equals(result2.key)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. store with passphrase + restore with passphrase round-trip
// ---------------------------------------------------------------------------
describe('CasService – passphrase store/restore round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('store with passphrase + restore with passphrase round-trip', async () => {
    const original = Buffer.from('hello, passphrase-based encryption');
    const passphrase = 'my-secret-passphrase';

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-test',
      filename: 'kdf-test.bin',
      passphrase,
    });

    expect(manifest.encryption).toBeDefined();
    expect(manifest.encryption.encrypted).toBe(true);
    expect(manifest.encryption.kdf).toBeDefined();

    const { buffer, bytesWritten } = await service.restore({ manifest, passphrase });
    expect(buffer.equals(original)).toBe(true);
    expect(bytesWritten).toBe(original.length);
  });
});

describe('CasService – passphrase multi-chunk round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('round-trips a multi-chunk file with passphrase', async () => {
    const original = randomBytes(3 * 1024);
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-multi',
      filename: 'kdf-multi.bin',
      passphrase: 'multi-chunk-passphrase',
    });

    expect(manifest.chunks.length).toBe(3);
    expect(manifest.encryption.kdf).toBeDefined();

    const { buffer } = await service.restore({ manifest, passphrase: 'multi-chunk-passphrase' });
    expect(buffer.equals(original)).toBe(true);
  });

  it('round-trips an exact chunk-boundary file with passphrase', async () => {
    const original = randomBytes(2 * 1024);
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-exact',
      filename: 'kdf-exact.bin',
      passphrase: 'exact-boundary',
    });

    expect(manifest.chunks.length).toBe(2);

    const { buffer } = await service.restore({ manifest, passphrase: 'exact-boundary' });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. wrong passphrase fails restore with INTEGRITY_ERROR
// ---------------------------------------------------------------------------
describe('CasService – wrong passphrase fails restore', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('wrong passphrase fails restore with INTEGRITY_ERROR', async () => {
    const original = Buffer.from('sensitive payload');
    const correctPassphrase = 'correct-horse-battery-staple';
    const wrongPassphrase = 'wrong-horse-battery-staple';

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-wrong',
      filename: 'kdf-wrong.bin',
      passphrase: correctPassphrase,
    });

    await expect(
      service.restore({ manifest, passphrase: wrongPassphrase }),
    ).rejects.toThrow(CasError);

    try {
      await service.restore({ manifest, passphrase: wrongPassphrase });
    } catch (err) {
      expect(err.code).toBe('INTEGRITY_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. manifest includes KDF params in encryption metadata
// ---------------------------------------------------------------------------
describe('CasService – manifest KDF metadata (pbkdf2)', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('manifest includes KDF params in encryption metadata', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('metadata check')),
      slug: 'kdf-meta',
      filename: 'kdf-meta.bin',
      passphrase: 'metadata-passphrase',
    });

    expect(manifest.encryption).toBeDefined();
    expect(manifest.encryption.encrypted).toBe(true);
    expect(manifest.encryption.algorithm).toBe('aes-256-gcm');

    const kdf = manifest.encryption.kdf;
    expect(kdf).toBeDefined();
    expect(kdf.algorithm).toBe('pbkdf2');
    expect(typeof kdf.salt).toBe('string');
    expect(kdf.keyLength).toBe(32);
    expect(typeof kdf.iterations).toBe('number');
  });
});

describe('CasService – manifest KDF metadata (scrypt)', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('manifest includes KDF params in encryption metadata', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('scrypt metadata check')),
      slug: 'kdf-meta-scrypt',
      filename: 'kdf-meta-scrypt.bin',
      passphrase: 'scrypt-metadata-passphrase',
      kdfOptions: { algorithm: 'scrypt' },
    });

    const kdf = manifest.encryption.kdf;
    expect(kdf).toBeDefined();
    expect(kdf.algorithm).toBe('scrypt');
    expect(typeof kdf.salt).toBe('string');
    expect(kdf.keyLength).toBe(32);
    expect(typeof kdf.cost).toBe('number');
    expect(typeof kdf.blockSize).toBe('number');
    expect(kdf.iterations).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. passphrase store with scrypt + restore round-trip
// ---------------------------------------------------------------------------
describe('CasService – scrypt passphrase round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('passphrase store with scrypt + restore round-trip', async () => {
    const original = Buffer.from('scrypt round-trip content');
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-scrypt',
      filename: 'kdf-scrypt.bin',
      passphrase: 'scrypt-passphrase',
      kdfOptions: { algorithm: 'scrypt' },
    });

    expect(manifest.encryption.kdf.algorithm).toBe('scrypt');
    const { buffer } = await service.restore({ manifest, passphrase: 'scrypt-passphrase' });
    expect(buffer.equals(original)).toBe(true);
  });

  it('scrypt round-trip with multi-chunk data', async () => {
    const original = randomBytes(3 * 1024);
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-scrypt-multi',
      filename: 'kdf-scrypt-multi.bin',
      passphrase: 'scrypt-multi-chunk',
      kdfOptions: { algorithm: 'scrypt' },
    });

    expect(manifest.chunks.length).toBe(3);
    const { buffer } = await service.restore({ manifest, passphrase: 'scrypt-multi-chunk' });
    expect(buffer.equals(original)).toBe(true);
  });
});

describe('CasService – wrong scrypt passphrase', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('wrong passphrase with scrypt fails with INTEGRITY_ERROR', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('scrypt integrity test')),
      slug: 'kdf-scrypt-wrong',
      filename: 'kdf-scrypt-wrong.bin',
      passphrase: 'correct-scrypt-pass',
      kdfOptions: { algorithm: 'scrypt' },
    });

    await expect(
      service.restore({ manifest, passphrase: 'wrong-scrypt-pass' }),
    ).rejects.toThrow(CasError);
  });
});

// ---------------------------------------------------------------------------
// 9. passphrase + compression round-trip
// ---------------------------------------------------------------------------
describe('CasService – passphrase + compression round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('passphrase + compression round-trip', async () => {
    const original = Buffer.alloc(2048, 'abcdefghij');
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-compress',
      filename: 'kdf-compress.bin',
      passphrase: 'compress-and-encrypt',
      compression: { algorithm: 'gzip' },
    });

    expect(manifest.encryption.kdf).toBeDefined();
    expect(manifest.compression.algorithm).toBe('gzip');

    const { buffer } = await service.restore({ manifest, passphrase: 'compress-and-encrypt' });
    expect(buffer.equals(original)).toBe(true);
  });

  it('passphrase + compression round-trip with scrypt', async () => {
    const original = Buffer.alloc(3072, 'compressible-pattern-');
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-scrypt-compress',
      filename: 'kdf-scrypt-compress.bin',
      passphrase: 'scrypt-compress',
      kdfOptions: { algorithm: 'scrypt' },
      compression: { algorithm: 'gzip' },
    });

    expect(manifest.encryption.kdf.algorithm).toBe('scrypt');
    const { buffer } = await service.restore({ manifest, passphrase: 'scrypt-compress' });
    expect(buffer.equals(original)).toBe(true);
  });
});

describe('CasService – passphrase + compression edge cases', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('passphrase + compression round-trip with random data', async () => {
    const original = randomBytes(2 * 1024);
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-compress-random',
      filename: 'kdf-compress-random.bin',
      passphrase: 'random-compress-encrypt',
      compression: { algorithm: 'gzip' },
    });

    const { buffer } = await service.restore({ manifest, passphrase: 'random-compress-encrypt' });
    expect(buffer.equals(original)).toBe(true);
  });

  it('wrong passphrase with compression fails with INTEGRITY_ERROR', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.alloc(1024, 'repeated')),
      slug: 'kdf-compress-wrong',
      filename: 'kdf-compress-wrong.bin',
      passphrase: 'correct-compress-pass',
      compression: { algorithm: 'gzip' },
    });

    await expect(
      service.restore({ manifest, passphrase: 'wrong-compress-pass' }),
    ).rejects.toThrow(CasError);
  });
});
