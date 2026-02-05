import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createReadStream, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

/** Deterministic SHA-256 hex digest for a given string. */
const sha256 = (str) => createHash('sha256').update(str).digest('hex');

describe('CasService – error paths', () => {
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
      readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
    };
  });

  // ─── constructor validation ─────────────────────────────────────────

  describe('constructor – chunkSize validation', () => {
    it('throws when chunkSize is 0', () => {
      expect(
        () => new CasService({ persistence: mockPersistence, crypto: new NodeCryptoAdapter(), codec: new JsonCodec(), chunkSize: 0 }),
      ).toThrow('Chunk size must be at least 1024 bytes');
    });

    it('throws when chunkSize is 512', () => {
      expect(
        () => new CasService({ persistence: mockPersistence, crypto: new NodeCryptoAdapter(), codec: new JsonCodec(), chunkSize: 512 }),
      ).toThrow('Chunk size must be at least 1024 bytes');
    });

    it('accepts chunkSize of exactly 1024', () => {
      const service = new CasService({
        persistence: mockPersistence,
        crypto: new NodeCryptoAdapter(),
        codec: new JsonCodec(),
        chunkSize: 1024,
      });
      expect(service.chunkSize).toBe(1024);
    });
  });

  // ─── store – nonexistent file ───────────────────────────────────

  describe('store', () => {
    it('rejects when source stream errors (nonexistent file)', async () => {
      const service = new CasService({
        persistence: mockPersistence,
        crypto: new NodeCryptoAdapter(),
        codec: new JsonCodec(),
        chunkSize: 1024,
      });

      await expect(
        service.store({
          source: createReadStream('/no/such/file.bin'),
          slug: 'bad-path',
          filename: 'file.bin',
        }),
      ).rejects.toThrow();
    });
  });

  // ─── verifyIntegrity – corrupted blob ───────────────────────────────

  describe('verifyIntegrity', () => {
    it('returns false (not throws) when blob data is corrupted', async () => {
      const originalData = 'original-content';
      const correctDigest = sha256(originalData);

      // readBlob returns corrupted data that does not match the digest
      mockPersistence.readBlob = vi
        .fn()
        .mockResolvedValue(Buffer.from('corrupted-content'));

      const service = new CasService({
        persistence: mockPersistence,
        crypto: new NodeCryptoAdapter(),
        codec: new JsonCodec(),
        chunkSize: 1024,
      });

      const manifest = new Manifest({
        slug: 'integrity-test',
        filename: 'file.bin',
        size: originalData.length,
        chunks: [
          {
            index: 0,
            size: originalData.length,
            blob: 'blob-oid-1',
            digest: correctDigest,
          },
        ],
      });

      const result = await service.verifyIntegrity(manifest);
      expect(result).toBe(false);
    });
  });

  // ─── createTree – invalid manifest ──────────────────────────────────

  describe('createTree', () => {
    it('throws when manifest is not a valid Manifest object', async () => {
      const service = new CasService({
        persistence: mockPersistence,
        crypto: new NodeCryptoAdapter(),
        codec: new JsonCodec(),
        chunkSize: 1024,
      });

      // A plain object that lacks .toJSON() and .chunks
      await expect(
        service.createTree({ manifest: {} }),
      ).rejects.toThrow();
    });

    it('throws when manifest.toJSON is not a function', async () => {
      const service = new CasService({
        persistence: mockPersistence,
        crypto: new NodeCryptoAdapter(),
        codec: new JsonCodec(),
        chunkSize: 1024,
      });

      const badManifest = { toJSON: 'not-a-function', chunks: [] };

      await expect(
        service.createTree({ manifest: badManifest }),
      ).rejects.toThrow();
    });
  });
});
