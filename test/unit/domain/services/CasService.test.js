import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';

describe('CasService', () => {
  let service;
  let mockPersistence;

  beforeEach(() => {
    mockPersistence = {
      writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
      writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    };
    service = new CasService({ persistence: mockPersistence, chunkSize: 10 });
  });

  it('chunks a file and stores blobs', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cas-test-'));
    const filePath = path.join(tempDir, 'test.txt');
    writeFileSync(filePath, '0123456789ABCDEFGHIJ'); // 20 bytes -> 2 chunks

    const manifest = await service.storeFile({ 
      filePath, 
      slug: 'test-slug',
      filename: 'test.txt'
    });

    expect(manifest.chunks).toHaveLength(2);
    expect(mockPersistence.writeBlob).toHaveBeenCalledTimes(2);
    expect(manifest.size).toBe(20);
    
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a tree from manifest', async () => {
    const manifest = {
      chunks: [
        { blob: 'b1', digest: 'd1' },
        { blob: 'b2', digest: 'd2' }
      ]
    };

    const treeOid = await service.createTree({ manifest });
    
    expect(treeOid).toBe('mock-tree-oid');
    expect(mockPersistence.writeBlob).toHaveBeenCalled(); // For the manifest.json
    expect(mockPersistence.writeTree).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringContaining('manifest.json'),
      expect.stringContaining('d1'),
      expect.stringContaining('d2')
    ]));
  });
});
