import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';

/**
 * Helper: writes a 0-byte file and returns its path.
 */
function emptyFile(tempDir, name = 'empty.bin') {
  const fp = path.join(tempDir, name);
  writeFileSync(fp, Buffer.alloc(0));
  return fp;
}

/**
 * Shared factory: builds the standard test fixtures.
 */
function setup() {
  const mockPersistence = {
    writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  };
  const service = new CasService({
    persistence: mockPersistence,
    crypto: new NodeCryptoAdapter(),
    codec: new JsonCodec(),
    chunkSize: 1024,
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cas-empty-'));
  return { mockPersistence, service, tempDir };
}

// ---------------------------------------------------------------------------
// 1. Store – plaintext
// ---------------------------------------------------------------------------
describe('CasService – empty file store plaintext', () => {
  let service;
  let tempDir;

  beforeEach(() => {
    ({ service, tempDir } = setup());
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores a 0-byte file and produces a manifest with size=0 and no chunks', async () => {
    const filePath = emptyFile(tempDir);

    const manifest = await service.store({
      source: createReadStream(filePath),
      slug: 'empty-slug',
      filename: 'empty.bin',
    });

    expect(manifest.size).toBe(0);
    expect(manifest.chunks).toEqual([]);
    expect(manifest.slug).toBe('empty-slug');
    expect(manifest.filename).toBe('empty.bin');
    expect(manifest.encryption).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Store – encrypted
// ---------------------------------------------------------------------------
describe('CasService – empty file store encrypted', () => {
  let service;
  let tempDir;

  beforeEach(() => {
    ({ service, tempDir } = setup());
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores a 0-byte file with an encryption key and produces a valid encrypted manifest', async () => {
    const filePath = emptyFile(tempDir);
    const encryptionKey = randomBytes(32);

    const manifest = await service.store({
      source: createReadStream(filePath),
      slug: 'enc-empty',
      filename: 'empty-enc.bin',
      encryptionKey,
    });

    expect(manifest.slug).toBe('enc-empty');
    expect(manifest.filename).toBe('empty-enc.bin');
    expect(manifest.encryption).toBeDefined();
    expect(manifest.encryption.algorithm).toBe('aes-256-gcm');
    expect(manifest.encryption.nonce).toEqual(expect.any(String));
    expect(manifest.encryption.tag).toEqual(expect.any(String));
    expect(manifest.encryption.encrypted).toBe(true);

    // Every chunk (if any) must still pass schema validation.
    for (const chunk of manifest.chunks) {
      expect(chunk.index).toBeGreaterThanOrEqual(0);
      expect(chunk.digest).toHaveLength(64);
      expect(chunk.blob).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. writeBlob not called for chunk data
// ---------------------------------------------------------------------------
describe('CasService – empty file writeBlob not called', () => {
  let service;
  let mockPersistence;
  let tempDir;

  beforeEach(() => {
    ({ service, mockPersistence, tempDir } = setup());
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not call writeBlob for chunk data when storing a plain 0-byte file', async () => {
    const filePath = emptyFile(tempDir);

    await service.store({
      source: createReadStream(filePath),
      slug: 'no-blobs',
      filename: 'empty.bin',
    });

    // writeBlob must not have been called at all during store
    // (it is only called inside _chunkAndStore for chunk data).
    expect(mockPersistence.writeBlob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. writeBlob called once for createTree
// ---------------------------------------------------------------------------
describe('CasService – empty file writeBlob createTree', () => {
  let service;
  let mockPersistence;
  let tempDir;

  beforeEach(() => {
    ({ service, mockPersistence, tempDir } = setup());
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('calls writeBlob exactly once (for the manifest) when createTree follows a plain 0-byte store', async () => {
    const filePath = emptyFile(tempDir);

    const manifest = await service.store({
      source: createReadStream(filePath),
      slug: 'tree-empty',
      filename: 'empty.bin',
    });

    // Reset call count after store (which should be 0 already).
    mockPersistence.writeBlob.mockClear();

    await service.createTree({ manifest });

    // createTree writes exactly one blob: the serialised manifest.
    expect(mockPersistence.writeBlob).toHaveBeenCalledTimes(1);
    // The argument should be a JSON string (the encoded manifest).
    const writtenPayload = mockPersistence.writeBlob.mock.calls[0][0];
    const parsed = JSON.parse(writtenPayload);
    expect(parsed.slug).toBe('tree-empty');
    expect(parsed.chunks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. 100 repeated empty-file stores — no state leakage
// ---------------------------------------------------------------------------
describe('CasService – empty file repeated stores', () => {
  let service;
  let mockPersistence;
  let tempDir;

  beforeEach(() => {
    ({ service, mockPersistence, tempDir } = setup());
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('handles 100 repeated empty-file stores without state leakage', async () => {
    for (let i = 0; i < 100; i++) {
      const filePath = emptyFile(tempDir, `empty-${i}.bin`);
      const manifest = await service.store({
        source: createReadStream(filePath),
        slug: `iter-${i}`,
        filename: 'empty.bin',
      });

      expect(manifest.size).toBe(0);
      expect(manifest.chunks).toEqual([]);
      expect(manifest.slug).toBe(`iter-${i}`);
    }

    // writeBlob should never have been called across all 100 iterations.
    expect(mockPersistence.writeBlob).not.toHaveBeenCalled();
  });
});
