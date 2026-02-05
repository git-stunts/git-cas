import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';

describe('CasService – empty (0-byte) file handling', () => {
  let service;
  let mockPersistence;
  let tempDir;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
      readBlob: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    };
    service = new CasService({
      persistence: mockPersistence,
      crypto: new NodeCryptoAdapter(),
      codec: new JsonCodec(),
      chunkSize: 1024,
    });
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'cas-empty-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: writes a 0-byte file and returns its path.
   */
  function emptyFile(name = 'empty.bin') {
    const fp = path.join(tempDir, name);
    writeFileSync(fp, Buffer.alloc(0));
    return fp;
  }

  // ---------------------------------------------------------------
  // 1. Store 0-byte file -> manifest has size=0 and chunks=[]
  // ---------------------------------------------------------------
  it('stores a 0-byte file and produces a manifest with size=0 and no chunks', async () => {
    const filePath = emptyFile();

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

  // ---------------------------------------------------------------
  // 2. Store 0-byte file with encryption key -> valid manifest, chunks=[]
  // ---------------------------------------------------------------
  it('stores a 0-byte file with an encryption key and produces a valid encrypted manifest', async () => {
    const filePath = emptyFile();
    const encryptionKey = randomBytes(32);

    const manifest = await service.store({
      source: createReadStream(filePath),
      slug: 'enc-empty',
      filename: 'empty-enc.bin',
      encryptionKey,
    });

    // AES-256-GCM produces a 16-byte auth tag even for empty plaintext,
    // so cipher.final() may emit a small block. The encrypted stream for
    // an empty file still results in a non-zero ciphertext output from
    // the cipher finalisation.  Regardless of whether the cipher emits
    // bytes, the manifest must be structurally valid.
    expect(manifest.slug).toBe('enc-empty');
    expect(manifest.filename).toBe('empty-enc.bin');
    expect(manifest.encryption).toBeDefined();
    expect(manifest.encryption.algorithm).toBe('aes-256-gcm');
    expect(manifest.encryption.nonce).toEqual(expect.any(String));
    expect(manifest.encryption.tag).toEqual(expect.any(String));
    expect(manifest.encryption.encrypted).toBe(true);

    // Every chunk (if any) must still pass schema validation (index, digest, blob).
    for (const chunk of manifest.chunks) {
      expect(chunk.index).toBeGreaterThanOrEqual(0);
      expect(chunk.digest).toHaveLength(64);
      expect(chunk.blob).toBeTruthy();
    }
  });

  // ---------------------------------------------------------------
  // 3. writeBlob is NOT called for chunk content on a plain empty file
  // ---------------------------------------------------------------
  it('does not call writeBlob for chunk data when storing a plain 0-byte file', async () => {
    const filePath = emptyFile();

    await service.store({
      source: createReadStream(filePath),
      slug: 'no-blobs',
      filename: 'empty.bin',
    });

    // writeBlob must not have been called at all during store
    // (it is only called inside _chunkAndStore for chunk data).
    expect(mockPersistence.writeBlob).not.toHaveBeenCalled();
  });

  it('calls writeBlob exactly once (for the manifest) when createTree follows a plain 0-byte store', async () => {
    const filePath = emptyFile();

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

  // ---------------------------------------------------------------
  // 4. 100 repeated empty-file stores — no state leakage
  // ---------------------------------------------------------------
  it('handles 100 repeated empty-file stores without state leakage', async () => {
    for (let i = 0; i < 100; i++) {
      const filePath = emptyFile(`empty-${i}.bin`);
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
