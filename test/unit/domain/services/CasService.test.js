import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import { digestOf } from '../../../helpers/crypto.js';

/**
 * Shared factory: builds the standard test fixtures.
 */
function setup() {
  const mockPersistence = {
    writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockImplementation((oid) => Promise.resolve(Buffer.from(oid === 'b1' ? 'chunk1' : 'chunk2'))),
  };
  const service = new CasService({
    persistence: mockPersistence,
    crypto: new NodeCryptoAdapter(),
    codec: new JsonCodec(),
    chunkSize: 1024,
  });
  return { mockPersistence, service };
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------
describe('CasService – store', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('chunks a file and stores blobs', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cas-test-'));
    const filePath = path.join(tempDir, 'test.txt');
    // Create 2048 bytes (2 chunks)
    const content = 'A'.repeat(2048);
    writeFileSync(filePath, content);

    const manifest = await service.store({
      source: createReadStream(filePath),
      slug: 'test-slug',
      filename: 'test.txt',
    });

    expect(manifest.chunks).toHaveLength(2);
    expect(mockPersistence.writeBlob).toHaveBeenCalledTimes(2);
    expect(manifest.size).toBe(2048);

    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// createTree
// ---------------------------------------------------------------------------
describe('CasService – createTree', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    ({ service, mockPersistence } = setup());
  });

  it('creates a tree from manifest', async () => {
    const manifest = new Manifest({
      slug: 'test',
      filename: 'test.txt',
      size: 100,
      chunks: [
        { index: 0, size: 10, blob: 'b1', digest: digestOf('chunk-a') },
        { index: 1, size: 10, blob: 'b2', digest: digestOf('chunk-b') }
      ]
    });

    const treeOid = await service.createTree({ manifest });

    expect(treeOid).toBe('mock-tree-oid');
    expect(mockPersistence.writeBlob).toHaveBeenCalled(); // For the manifest.json
    expect(mockPersistence.writeTree).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringContaining('manifest.json'),
      expect.stringContaining(digestOf('chunk-a')),
      expect.stringContaining(digestOf('chunk-b'))
    ]));
  });
});

// ---------------------------------------------------------------------------
// verifyIntegrity
// ---------------------------------------------------------------------------
describe('CasService – verifyIntegrity', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('verifies integrity of chunks', async () => {
    // Helper to calc hash since service._sha256 is private
    const sha = async (d) => await service['_sha256'](Buffer.from(d));

    const manifest = new Manifest({
      slug: 'test',
      filename: 't.txt',
      size: 12,
      chunks: [
        { index: 0, size: 6, blob: 'b1', digest: await sha('chunk1') },
        { index: 1, size: 6, blob: 'b2', digest: await sha('chunk2') }
      ]
    });

    const isValid = await service.verifyIntegrity(manifest);
    expect(isValid).toBe(true);
  });
});