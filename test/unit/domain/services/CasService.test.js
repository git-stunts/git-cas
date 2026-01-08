import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

describe('CasService', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
      readBlob: vi.fn().mockImplementation((oid) => Promise.resolve(Buffer.from(oid === 'b1' ? 'chunk1' : 'chunk2'))),
    };
    service = new CasService({ persistence: mockPersistence, chunkSize: 1024 });
  });

  it('chunks a file and stores blobs', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cas-test-'));
    const filePath = path.join(tempDir, 'test.txt');
    // Create 2048 bytes (2 chunks)
    const content = 'A'.repeat(2048);
    writeFileSync(filePath, content);

    const manifest = await service.storeFile({ 
      filePath, 
      slug: 'test-slug',
      filename: 'test.txt'
    });

    expect(manifest.chunks).toHaveLength(2);
    expect(mockPersistence.writeBlob).toHaveBeenCalledTimes(2);
    expect(manifest.size).toBe(2048);
    
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a tree from manifest', async () => {
    const manifest = new Manifest({
      slug: 'test',
      filename: 'test.txt',
      size: 100,
      chunks: [
        { index: 0, size: 10, blob: 'b1', digest: 'a'.repeat(64) },
        { index: 1, size: 10, blob: 'b2', digest: 'b'.repeat(64) }
      ]
    });

    const treeOid = await service.createTree({ manifest });
    
    expect(treeOid).toBe('mock-tree-oid');
    expect(mockPersistence.writeBlob).toHaveBeenCalled(); // For the manifest.json
    expect(mockPersistence.writeTree).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringContaining('manifest.json'),
      expect.stringContaining('a'.repeat(64)),
      expect.stringContaining('b'.repeat(64))
    ]));
  });

  it('verifies integrity of chunks', async () => {
    // Helper to calc hash since service._sha256 is private
    const sha = (d) => service['_sha256'](Buffer.from(d));

    const manifest = new Manifest({
      slug: 'test',
      filename: 't.txt',
      size: 12,
      chunks: [
        { index: 0, size: 6, blob: 'b1', digest: sha('chunk1') },
        { index: 1, size: 6, blob: 'b2', digest: sha('chunk2') }
      ]
    });

    const isValid = await service.verifyIntegrity(manifest);
    expect(isValid).toBe(true);
  });
});