import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import CdcChunker from '../../../../src/infrastructure/chunkers/CdcChunker.js';
import ChunkingPort from '../../../../src/ports/ChunkingPort.js';

const testCrypto = await getTestCryptoAdapter();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContentStore() {
  const crypto = testCrypto;
  const blobStore = new Map();

  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation(async (content) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = await crypto.sha256(buf);
      blobStore.set(oid, buf);
      return oid;
    }),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockImplementation(async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return buf;
    }),
  };

  return { crypto, blobStore, mockPersistence };
}

function setup(opts = {}) {
  const { crypto, blobStore, mockPersistence } = makeContentStore();
  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunkSize: opts.chunkSize || 1024,
    concurrency: opts.concurrency || 1,
    chunker: opts.chunker,
  });
  return { crypto, blobStore, mockPersistence, service };
}

async function storeBuffer(svc, buf, opts = {}) {
  async function* source() { yield buf; }
  return svc.store({
    source: source(),
    slug: opts.slug || 'test',
    filename: opts.filename || 'test.bin',
    encryptionKey: opts.encryptionKey,
    compression: opts.compression,
  });
}

// ---------------------------------------------------------------------------
// Default chunker (backward compat)
// ---------------------------------------------------------------------------
describe('CasService – default chunker', () => {
  it('uses FixedChunker when no chunker is provided', () => {
    const { service } = setup();
    expect(service.chunker).toBeInstanceOf(FixedChunker);
    expect(service.chunker).toBeInstanceOf(ChunkingPort);
    expect(service.chunker.strategy).toBe('fixed');
  });

  it('default FixedChunker uses configured chunkSize', () => {
    const { service } = setup({ chunkSize: 2048 });
    expect(service.chunker.params).toEqual({ chunkSize: 2048 });
  });

  it('round-trip with default chunker is byte-identical', async () => {
    const { service } = setup();
    const original = randomBytes(4096);
    const manifest = await storeBuffer(service, original);
    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });

  it('produces same chunks as explicit FixedChunker', async () => {
    const chunkSize = 1024;
    const { service: defaultSvc } = setup({ chunkSize });
    const { service: explicitSvc } = setup({
      chunkSize,
      chunker: new FixedChunker({ chunkSize }),
    });

    const data = randomBytes(4096);
    const m1 = await storeBuffer(defaultSvc, data);
    const m2 = await storeBuffer(explicitSvc, data);

    expect(m1.chunks.length).toBe(m2.chunks.length);
    for (let i = 0; i < m1.chunks.length; i++) {
      expect(m1.chunks[i].size).toBe(m2.chunks[i].size);
      expect(m1.chunks[i].digest).toBe(m2.chunks[i].digest);
    }
  });
});

// ---------------------------------------------------------------------------
// Explicit FixedChunker
// ---------------------------------------------------------------------------
describe('CasService – explicit FixedChunker', () => {
  it('uses the provided FixedChunker', () => {
    const chunker = new FixedChunker({ chunkSize: 2048 });
    const { service } = setup({ chunker });
    expect(service.chunker).toBe(chunker);
    expect(service.chunker.strategy).toBe('fixed');
  });

  it('round-trip is byte-identical', async () => {
    const chunker = new FixedChunker({ chunkSize: 1024 });
    const { service } = setup({ chunker });
    const original = randomBytes(4096);
    const manifest = await storeBuffer(service, original);
    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });

  it('fixed chunker manifest does NOT include chunking field', async () => {
    const { service } = setup();
    const manifest = await storeBuffer(service, randomBytes(2048));
    expect(manifest.chunking).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CdcChunker — basics
// ---------------------------------------------------------------------------

const cdcOpts = {
  minChunkSize: 256,
  maxChunkSize: 4096,
  targetChunkSize: 1024,
};

describe('CasService – CdcChunker basics', () => {
  it('uses the provided CdcChunker', () => {
    const chunker = new CdcChunker(cdcOpts);
    const { service } = setup({ chunker });
    expect(service.chunker).toBe(chunker);
    expect(service.chunker.strategy).toBe('cdc');
  });

  it('round-trip is byte-identical', async () => {
    const chunker = new CdcChunker(cdcOpts);
    const { service } = setup({ chunker });
    const original = randomBytes(8192);
    const manifest = await storeBuffer(service, original);
    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });

  it('CDC chunks respect min/max bounds (except last)', async () => {
    const chunker = new CdcChunker(cdcOpts);
    const { service } = setup({ chunker });
    const manifest = await storeBuffer(service, randomBytes(16384));

    for (let i = 0; i < manifest.chunks.length - 1; i++) {
      expect(manifest.chunks[i].size).toBeGreaterThanOrEqual(cdcOpts.minChunkSize);
      expect(manifest.chunks[i].size).toBeLessThanOrEqual(cdcOpts.maxChunkSize);
    }
    // Last chunk may be smaller than min
    const last = manifest.chunks[manifest.chunks.length - 1];
    expect(last.size).toBeLessThanOrEqual(cdcOpts.maxChunkSize);
  });
});

// ---------------------------------------------------------------------------
// CdcChunker — manifest metadata
// ---------------------------------------------------------------------------
describe('CasService – CdcChunker manifest metadata', () => {
  it('CDC manifest includes chunking field', async () => {
    const chunker = new CdcChunker(cdcOpts);
    const { service } = setup({ chunker });
    const manifest = await storeBuffer(service, randomBytes(8192));
    expect(manifest.chunking).toBeDefined();
    expect(manifest.chunking.strategy).toBe('cdc');
    expect(manifest.chunking.params).toEqual({
      target: cdcOpts.targetChunkSize,
      min: cdcOpts.minChunkSize,
      max: cdcOpts.maxChunkSize,
    });
  });

  it('CDC manifest toJSON includes chunking', async () => {
    const chunker = new CdcChunker(cdcOpts);
    const { service } = setup({ chunker });
    const manifest = await storeBuffer(service, randomBytes(8192));
    const json = manifest.toJSON();
    expect(json.chunking).toBeDefined();
    expect(json.chunking.strategy).toBe('cdc');
  });
});

// ---------------------------------------------------------------------------
// CdcChunker — with encryption / compression / concurrency
// ---------------------------------------------------------------------------
describe('CasService – CdcChunker with encryption/compression', () => {
  it('CDC with encryption round-trips correctly', async () => {
    const chunker = new CdcChunker(cdcOpts);
    const { service } = setup({ chunker });
    const original = randomBytes(8192);
    const key = randomBytes(32);
    const manifest = await storeBuffer(service, original, { encryptionKey: key });
    expect(manifest.encryption).toBeDefined();
    expect(manifest.chunking).toBeDefined();
    const { buffer } = await service.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);
  });

  it('CDC with compression round-trips correctly', async () => {
    const chunker = new CdcChunker(cdcOpts);
    const { service } = setup({ chunker });
    const original = Buffer.alloc(8192, 'ABCDEFGH');
    const manifest = await storeBuffer(service, original, {
      compression: { algorithm: 'gzip' },
    });
    expect(manifest.compression).toBeDefined();
    expect(manifest.chunking).toBeDefined();
    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });

  it('CDC with concurrency round-trips correctly', async () => {
    const chunker = new CdcChunker(cdcOpts);
    const { service } = setup({ chunker, concurrency: 4 });
    const original = randomBytes(16384);
    const manifest = await storeBuffer(service, original);
    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty file
// ---------------------------------------------------------------------------
describe('CasService – chunker with empty file', () => {
  it('CDC chunker produces empty manifest for empty input', async () => {
    const chunker = new CdcChunker({
      minChunkSize: 256,
      maxChunkSize: 4096,
      targetChunkSize: 1024,
    });
    const { service } = setup({ chunker });
    const manifest = await storeBuffer(service, Buffer.alloc(0));
    expect(manifest.chunks).toHaveLength(0);
    expect(manifest.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Small files (< min chunk size)
// ---------------------------------------------------------------------------
describe('CasService – CDC with small file', () => {
  it('file smaller than minChunkSize produces single chunk', async () => {
    const chunker = new CdcChunker({
      minChunkSize: 1024,
      maxChunkSize: 4096,
      targetChunkSize: 2048,
    });
    const { service } = setup({ chunker });
    const original = randomBytes(512);
    const manifest = await storeBuffer(service, original);
    expect(manifest.chunks).toHaveLength(1);
    expect(manifest.chunks[0].size).toBe(512);
    const { buffer } = await service.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
  });
});
