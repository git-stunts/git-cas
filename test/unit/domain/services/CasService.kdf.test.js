import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();
const SLOW_KDF_TEST_TIMEOUT_MS = 20000;
const SUPPORTS_SCRYPT = testCrypto.constructor.name !== 'WebCryptoAdapter';
const itScrypt = SUPPORTS_SCRYPT ? it : it.skip;
const itNoScrypt = SUPPORTS_SCRYPT ? it.skip : it;

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
  const crypto = testCrypto;
  const blobs = new Map();
  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation(async (content) => {
      const oid = await crypto.sha256(Buffer.isBuffer(content) ? content : Buffer.from(content));
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
    observability: new SilentObserver(),
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
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

    expect(result.key).toBeInstanceOf(Uint8Array);
    expect(result.key.length).toBe(32);
    expect(result.salt).toBeInstanceOf(Uint8Array);
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

  itScrypt('deriveKey with scrypt returns 32-byte key', async () => {
    const result = await service.deriveKey({
      passphrase: 'test-passphrase',
      algorithm: 'scrypt',
    });

    expect(result.key).toBeInstanceOf(Uint8Array);
    expect(result.key.length).toBe(32);
    expect(result.salt).toBeInstanceOf(Uint8Array);
    expect(result.salt.length).toBe(32);
    expect(result.params).toBeDefined();
    expect(result.params.algorithm).toBe('scrypt');
    expect(result.params.keyLength).toBe(32);
    expect(typeof result.params.cost).toBe('number');
    expect(typeof result.params.blockSize).toBe('number');
    expect(typeof result.params.parallelization).toBe('number');
    // scrypt params should NOT have iterations
    expect(result.params.iterations).toBeUndefined();
  }, SLOW_KDF_TEST_TIMEOUT_MS);

  itNoScrypt('reports scrypt unavailability on WebCrypto runtimes', async () => {
    await expect(service.deriveKey({
      passphrase: 'test-passphrase',
      algorithm: 'scrypt',
    })).rejects.toThrow(/scrypt KDF is unavailable in WebCryptoAdapter/);
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

    expect(Buffer.from(result1.key).equals(result2.key)).toBe(true);
  });

  itScrypt('same passphrase + salt yields same key with scrypt', async () => {
    const salt = randomBytes(32);
    const passphrase = 'deterministic-passphrase-scrypt';

    const result1 = await service.deriveKey({ passphrase, salt, algorithm: 'scrypt' });
    const result2 = await service.deriveKey({ passphrase, salt, algorithm: 'scrypt' });

    expect(Buffer.from(result1.key).equals(result2.key)).toBe(true);
  }, SLOW_KDF_TEST_TIMEOUT_MS);
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

    expect(Buffer.from(result1.key).equals(result2.key)).toBe(false);
  });

  itScrypt('different salts yield different keys with scrypt', async () => {
    const passphrase = 'same-passphrase-scrypt';
    const salt1 = randomBytes(32);
    const salt2 = randomBytes(32);

    const result1 = await service.deriveKey({ passphrase, salt: salt1, algorithm: 'scrypt' });
    const result2 = await service.deriveKey({ passphrase, salt: salt2, algorithm: 'scrypt' });

    expect(Buffer.from(result1.key).equals(result2.key)).toBe(false);
  }, SLOW_KDF_TEST_TIMEOUT_MS);
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
    expect(manifest.encryption.scheme).toBe('framed');
    expect(manifest.encryption.kdf).toBeDefined();

    const { buffer, bytesWritten } = await service.restore({ manifest, passphrase });
    expect(Buffer.from(buffer).equals(original)).toBe(true);
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

    expect(manifest.chunks.length).toBeGreaterThan(1);
    expect(manifest.encryption.kdf).toBeDefined();

    const { buffer } = await service.restore({ manifest, passphrase: 'multi-chunk-passphrase' });
    expect(Buffer.from(buffer).equals(original)).toBe(true);
  });

  it('round-trips an exact chunk-boundary file with passphrase', async () => {
    const original = randomBytes(2 * 1024);
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-exact',
      filename: 'kdf-exact.bin',
      passphrase: 'exact-boundary',
    });

    expect(manifest.chunks.length).toBeGreaterThan(1);

    const { buffer } = await service.restore({ manifest, passphrase: 'exact-boundary' });
    expect(Buffer.from(buffer).equals(original)).toBe(true);
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
  }, SLOW_KDF_TEST_TIMEOUT_MS);
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
    expect(kdf.iterations).toBe(600_000);
  });
});

describe('CasService – manifest KDF metadata (scrypt)', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  itScrypt('manifest includes KDF params in encryption metadata', async () => {
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
    expect(kdf.cost).toBe(131_072);
    expect(typeof kdf.blockSize).toBe('number');
    expect(kdf.iterations).toBeUndefined();
  }, SLOW_KDF_TEST_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// 8. passphrase store with scrypt + restore round-trip
// ---------------------------------------------------------------------------
describe('CasService – scrypt passphrase round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  itScrypt('passphrase store with scrypt + restore round-trip', async () => {
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
    expect(Buffer.from(buffer).equals(original)).toBe(true);
  }, SLOW_KDF_TEST_TIMEOUT_MS);

  itScrypt('scrypt round-trip with multi-chunk data', async () => {
    const original = randomBytes(3 * 1024);
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'kdf-scrypt-multi',
      filename: 'kdf-scrypt-multi.bin',
      passphrase: 'scrypt-multi-chunk',
      kdfOptions: { algorithm: 'scrypt' },
    });

    expect(manifest.chunks.length).toBeGreaterThan(1);
    const { buffer } = await service.restore({ manifest, passphrase: 'scrypt-multi-chunk' });
    expect(Buffer.from(buffer).equals(original)).toBe(true);
  }, SLOW_KDF_TEST_TIMEOUT_MS);
});

describe('CasService – wrong scrypt passphrase', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  itScrypt('wrong passphrase with scrypt fails with INTEGRITY_ERROR', async () => {
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
  }, SLOW_KDF_TEST_TIMEOUT_MS);
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
    expect(Buffer.from(buffer).equals(original)).toBe(true);
  });

  itScrypt('passphrase + compression round-trip with scrypt', async () => {
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
    expect(Buffer.from(buffer).equals(original)).toBe(true);
  }, SLOW_KDF_TEST_TIMEOUT_MS);
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
    expect(Buffer.from(buffer).equals(original)).toBe(true);
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

describe('CasService – KDF policy rejection', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('rejects out-of-policy PBKDF2 iterations before storing encrypted content', async () => {
    await expect(service.store({
      source: bufferSource(Buffer.from('policy guard')),
      slug: 'kdf-policy-low',
      filename: 'kdf-policy-low.bin',
      passphrase: 'policy-passphrase',
      kdfOptions: { iterations: 99_999 },
    })).rejects.toThrow(expect.objectContaining({ code: 'KDF_POLICY_VIOLATION' }));
  });
});
