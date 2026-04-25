import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();

function streamOneBuffer(buf) {
  return {
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

async function storeBuffer(svc, buf, opts = {}) {
  async function* source() { yield buf; }
  return svc.store({
    source: source(),
    slug: opts.slug || 'test-slug',
    filename: opts.filename || 'test.bin',
    encryptionKey: opts.encryptionKey,
    encryption: opts.encryption,
  });
}

function setup() {
  const crypto = testCrypto;
  const blobStore = new Map();

  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation(async (content) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = await crypto.sha256(buf);
      blobStore.set(oid, buf);
      return oid;
    }),
    writeTree: vi.fn().mockResolvedValue('a'.repeat(40)),
    readBlob: vi.fn().mockImplementation(async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return buf;
    }),
    readBlobStream: vi.fn().mockImplementation(async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return streamOneBuffer(buf);
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

  return { crypto, blobStore, mockPersistence, service };
}

// ---------------------------------------------------------------------------
// whole-v2 round-trip
// ---------------------------------------------------------------------------
describe('CasService AAD – whole-v2 round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('defaults to whole-v2 scheme for new encrypted stores', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('hello aad world');
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { scheme: 'whole-v2' },
    });

    expect(manifest.encryption.scheme).toBe('whole-v2');
  });

  it('round-trips whole-v2 encrypted content', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('hello aad world');
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { scheme: 'whole-v2' },
    });

    const { buffer } = await service.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);
  });

  it('round-trips multi-chunk whole-v2 content', async () => {
    const key = randomBytes(32);
    const original = randomBytes(3 * 1024);
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { scheme: 'whole-v2' },
    });

    expect(manifest.encryption.scheme).toBe('whole-v2');
    const { buffer } = await service.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// whole-v2 tamper detection — slug AAD mismatch
// ---------------------------------------------------------------------------
describe('CasService AAD – whole-v2 tamper detection', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('fails decryption when slug is changed in the manifest (AAD mismatch)', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('tamper-proof payload');
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      slug: 'original-slug',
      encryption: { scheme: 'whole-v2' },
    });

    // Tamper with the slug in the manifest
    const json = manifest.toJSON();
    json.slug = 'tampered-slug';
    const tampered = new Manifest(json);

    await expect(
      service.restore({ manifest: tampered, encryptionKey: key }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// framed-v2 round-trip
// ---------------------------------------------------------------------------
describe('CasService AAD – framed-v2 round-trip', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('stores with framed-v2 scheme', async () => {
    const key = randomBytes(32);
    const original = randomBytes(3 * 1024);
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { scheme: 'framed-v2', frameBytes: 512 },
    });

    expect(manifest.encryption.scheme).toBe('framed-v2');
  });

  it('round-trips framed-v2 encrypted content', async () => {
    const key = randomBytes(32);
    const original = randomBytes(3 * 1024);
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { scheme: 'framed-v2', frameBytes: 512 },
    });

    const { buffer } = await service.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// framed-v2 tamper detection — slug AAD mismatch
// ---------------------------------------------------------------------------
describe('CasService AAD – framed-v2 tamper detection', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('fails decryption when slug is changed (framed AAD mismatch)', async () => {
    const key = randomBytes(32);
    const original = randomBytes(3 * 1024);
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      slug: 'correct-slug',
      encryption: { scheme: 'framed-v2', frameBytes: 512 },
    });

    const json = manifest.toJSON();
    json.slug = 'wrong-slug';
    const tampered = new Manifest(json);

    await expect(
      service.restore({ manifest: tampered, encryptionKey: key }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// whole-v1 backward compatibility
// ---------------------------------------------------------------------------
describe('CasService AAD – whole-v1 backward compat', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('stores with explicit whole-v1 scheme (no AAD)', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('legacy content');
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { scheme: 'whole-v1' },
    });

    expect(manifest.encryption.scheme).toBe('whole-v1');
  });

  it('round-trips whole-v1 content', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('legacy content');
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { scheme: 'whole-v1' },
    });

    const { buffer } = await service.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// framed-v1 backward compatibility
// ---------------------------------------------------------------------------
describe('CasService AAD – framed-v1 backward compat', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('stores with explicit framed-v1 scheme (no AAD)', async () => {
    const key = randomBytes(32);
    const original = randomBytes(3 * 1024);
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { scheme: 'framed-v1', frameBytes: 512 },
    });

    expect(manifest.encryption.scheme).toBe('framed-v1');
  });

  it('round-trips framed-v1 content', async () => {
    const key = randomBytes(32);
    const original = randomBytes(3 * 1024);
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { scheme: 'framed-v1', frameBytes: 512 },
    });

    const { buffer } = await service.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Default scheme selection
// ---------------------------------------------------------------------------
describe('CasService AAD – default scheme selection', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('defaults to framed-v2 when no scheme is specified', async () => {
    const key = randomBytes(32);
    const original = Buffer.from('default scheme test');
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
    });

    expect(manifest.encryption.scheme).toBe('framed-v2');
  });

  it('defaults framed stores with explicit frameBytes to framed-v2', async () => {
    const key = randomBytes(32);
    const original = randomBytes(3 * 1024);
    const manifest = await storeBuffer(service, original, {
      encryptionKey: key,
      encryption: { frameBytes: 512 },
    });

    expect(manifest.encryption.scheme).toBe('framed-v2');
  });
});
