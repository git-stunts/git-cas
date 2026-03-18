import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import CasError from '../../../../src/domain/errors/CasError.js';

const testCrypto = await getTestCryptoAdapter();
const SLOW_ENVELOPE_TEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Deterministic PRNG (xorshift32) — keeps fuzz tests reproducible
// ---------------------------------------------------------------------------
function createSeededRng(seed = 42) {
  let s = seed >>> 0 || 1;
  return (max) => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) % max;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setup() {
  const crypto = testCrypto;
  const blobStore = new Map();

  const mockPersistence = {
    writeBlob: async (content) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = await crypto.sha256(buf);
      blobStore.set(oid, buf);
      return oid;
    },
    writeTree: async () => 'mock-tree-oid',
    readBlob: async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return buf;
    },
  };

  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec: new JsonCodec(),
    chunkSize: 1024,
    observability: new SilentObserver(),
  });

  return { service, blobStore, crypto };
}

async function* bufferSource(buf) {
  yield buf;
}

// ---------------------------------------------------------------------------
// Single recipient (degenerate case)
// ---------------------------------------------------------------------------
describe('CasService – envelope encryption (single recipient)', () => {
  let service;
  beforeEach(() => { ({ service } = setup()); });

  it('store with 1 recipient → restore round-trips', async () => {
    const kek = randomBytes(32);
    const original = Buffer.from('hello envelope');

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'test',
      filename: 'test.bin',
      recipients: [{ label: 'alice', key: kek }],
    });

    expect(manifest.encryption).toBeDefined();
    expect(manifest.encryption.recipients).toHaveLength(1);
    expect(manifest.encryption.recipients[0].label).toBe('alice');

    const { buffer } = await service.restore({ manifest, encryptionKey: kek });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-recipient golden path
// ---------------------------------------------------------------------------
describe('CasService – envelope encryption (multi-recipient)', () => { // eslint-disable-line max-lines-per-function
  let service;
  beforeEach(() => { ({ service } = setup()); });

  it('store with 3 recipients → each can restore', async () => {
    const keys = [randomBytes(32), randomBytes(32), randomBytes(32)];
    const original = randomBytes(2048);

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'multi',
      filename: 'multi.bin',
      recipients: [
        { label: 'alice', key: keys[0] },
        { label: 'bob', key: keys[1] },
        { label: 'carol', key: keys[2] },
      ],
    });

    expect(manifest.encryption.recipients).toHaveLength(3);

    for (const key of keys) {
      const { buffer } = await service.restore({ manifest, encryptionKey: key });
      expect(buffer.equals(original)).toBe(true);
    }
  });

  it('non-recipient KEK fails with NO_MATCHING_RECIPIENT', async () => {
    const kek = randomBytes(32);
    const wrongKey = randomBytes(32);
    const original = Buffer.from('secret');

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'test',
      filename: 'test.bin',
      recipients: [{ label: 'alice', key: kek }],
    });

    await expect(
      service.restore({ manifest, encryptionKey: wrongKey }),
    ).rejects.toMatchObject({ name: 'CasError', code: 'NO_MATCHING_RECIPIENT' });
  });

  it('tampered wrappedDek fails with NO_MATCHING_RECIPIENT', async () => {
    const kek = randomBytes(32);
    const original = Buffer.from('test data');

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'tamper',
      filename: 'tamper.bin',
      recipients: [{ label: 'alice', key: kek }],
    });

    // Tamper with the wrappedDek
    const tampered = manifest.toJSON();
    const originalDek = Buffer.from(tampered.encryption.recipients[0].wrappedDek, 'base64');
    originalDek[0] ^= 0x01;
    tampered.encryption.recipients[0].wrappedDek = originalDek.toString('base64');

    const Manifest = (await import('../../../../src/domain/value-objects/Manifest.js')).default;
    const tamperedManifest = new Manifest(tampered);

    await expect(
      service.restore({ manifest: tamperedManifest, encryptionKey: kek }),
    ).rejects.toMatchObject({ name: 'CasError', code: 'NO_MATCHING_RECIPIENT' });
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------
describe('CasService – envelope encryption (backward compat)', () => {
  let service;
  beforeEach(() => { ({ service } = setup()); });

  it('old-style manifest (no recipients) restores with direct key', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('legacy encrypted data');

    // Store using legacy encryptionKey path
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'legacy',
      filename: 'legacy.bin',
      encryptionKey: key,
    });

    expect(manifest.encryption.recipients).toBeUndefined();

    const { buffer } = await service.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);
  });

  it('unencrypted manifest restores without key', async () => {
    const original = Buffer.from('plaintext data');

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'plain',
      filename: 'plain.bin',
    });

    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('CasService – envelope encryption (edge cases)', () => { // eslint-disable-line max-lines-per-function
  let service;
  beforeEach(() => { ({ service } = setup()); });

  it('10 recipients all restore correctly', async () => {
    const keys = Array.from({ length: 10 }, () => randomBytes(32));
    const original = randomBytes(512);

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'many',
      filename: 'many.bin',
      recipients: keys.map((key, i) => ({ label: `r${i}`, key })),
    });

    expect(manifest.encryption.recipients).toHaveLength(10);

    for (const key of keys) {
      const { buffer } = await service.restore({ manifest, encryptionKey: key });
      expect(buffer.equals(original)).toBe(true);
    }
  });

  it('mutual exclusivity: recipients + encryptionKey → INVALID_OPTIONS', async () => {
    const key = randomBytes(32);

    await expect(
      service.store({
        source: bufferSource(Buffer.from('x')),
        slug: 'test',
        filename: 'test.bin',
        encryptionKey: key,
        recipients: [{ label: 'a', key }],
      }),
    ).rejects.toThrow(/recipients or encryptionKey/);
  });

  it('mutual exclusivity: recipients + passphrase → INVALID_OPTIONS', async () => {
    const key = randomBytes(32);

    await expect(
      service.store({
        source: bufferSource(Buffer.from('x')),
        slug: 'test',
        filename: 'test.bin',
        passphrase: 'secret',
        recipients: [{ label: 'a', key }],
      }),
    ).rejects.toThrow(/recipients or encryptionKey/);
  });

  it('empty recipients array → INVALID_OPTIONS', async () => {
    await expect(
      service.store({
        source: bufferSource(Buffer.from('x')),
        slug: 'test',
        filename: 'test.bin',
        recipients: [],
      }),
    ).rejects.toThrow(/At least one recipient/);
  });

  it('duplicate recipient labels → INVALID_OPTIONS', async () => {
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);

    await expect(
      service.store({
        source: bufferSource(Buffer.from('x')),
        slug: 'test',
        filename: 'test.bin',
        recipients: [
          { label: 'alice', key: key1 },
          { label: 'alice', key: key2 },
        ],
      }),
    ).rejects.toThrow(/Duplicate recipient labels/);
  });

  it('envelope manifest includes encryption metadata (algorithm, nonce, tag)', async () => {
    const kek = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'meta',
      filename: 'meta.bin',
      recipients: [{ label: 'alice', key: kek }],
    });

    expect(manifest.encryption.algorithm).toBe('aes-256-gcm');
    expect(manifest.encryption.nonce).toBeDefined();
    expect(manifest.encryption.tag).toBeDefined();
    expect(manifest.encryption.encrypted).toBe(true);
  });

  it('envelope + compression round-trips', async () => {
    const kek = randomBytes(32);
    const original = randomBytes(2048);

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'comp',
      filename: 'comp.bin',
      recipients: [{ label: 'alice', key: kek }],
      compression: { algorithm: 'gzip' },
    });

    expect(manifest.encryption).toBeDefined();
    expect(manifest.compression).toEqual({ algorithm: 'gzip' });

    const { buffer } = await service.restore({ manifest, encryptionKey: kek });
    expect(buffer.equals(original)).toBe(true);
  }, SLOW_ENVELOPE_TEST_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// Fuzz — round-trips
// ---------------------------------------------------------------------------
describe('CasService – envelope encryption (fuzz round-trips)', () => {
  let service;
  beforeEach(() => { ({ service } = setup()); });

  it('50 random plaintexts × 3 random KEKs all round-trip', async () => {
    const rng = createSeededRng(12345);
    for (let i = 0; i < 50; i++) {
      const size = rng(4096);
      const original = randomBytes(size);
      const keys = [randomBytes(32), randomBytes(32), randomBytes(32)];

      const manifest = await service.store({
        source: bufferSource(original),
        slug: `fuzz-${i}`,
        filename: `fuzz-${i}.bin`,
        recipients: keys.map((key, j) => ({ label: `k${j}`, key })),
      });

      const idx = rng(3);
      const { buffer } = await service.restore({ manifest, encryptionKey: keys[idx] });
      expect(buffer.equals(original)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Fuzz — tamper detection
// ---------------------------------------------------------------------------
describe('CasService – envelope encryption (fuzz tamper)', () => {
  let service;
  beforeEach(() => { ({ service } = setup()); });

  it('tamper each recipient entry independently → fails', async () => {
    const keys = [randomBytes(32), randomBytes(32), randomBytes(32)];
    const original = randomBytes(256);

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'tamper-fuzz',
      filename: 'tamper.bin',
      recipients: keys.map((key, j) => ({ label: `k${j}`, key })),
    });

    const Manifest = (await import('../../../../src/domain/value-objects/Manifest.js')).default;

    for (let t = 0; t < 3; t++) {
      const json = JSON.parse(JSON.stringify(manifest.toJSON()));
      const dek = Buffer.from(json.encryption.recipients[t].wrappedDek, 'base64');
      dek[0] ^= 0xff;
      json.encryption.recipients[t].wrappedDek = dek.toString('base64');
      json.encryption.recipients = [json.encryption.recipients[t]];
      const tamperedManifest = new Manifest(json);

      await expect(
        service.restore({ manifest: tamperedManifest, encryptionKey: keys[t] }),
      ).rejects.toThrow(CasError);
    }
  });
});
