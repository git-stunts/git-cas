import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import CasError from '../../../../src/domain/errors/CasError.js';
import StorePipeline from '../../../../src/domain/services/StorePipeline.js';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function createPipeline({ chunks, storeChunk, concurrency = 2 }) {
  return new StorePipeline({
    chunker: {
      chunk: async function* chunkSource() {
        for (const item of chunks) {
          yield item;
        }
      },
    },
    concurrency,
    observability: {
      metric: vi.fn(),
      log: vi.fn(),
      span: vi.fn(),
    },
    storeChunk,
  });
}

describe('StorePipeline ordering', () => {
  it('keeps chunk entries in source order when writes resolve out of order', async () => {
    const pipeline = createPipeline({
      chunks: [new Uint8Array([1]), new Uint8Array([2, 3])],
      storeChunk: async (chunk, index) => {
        if (index === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return {
          index,
          size: chunk.length,
          digest: `digest-${index}`,
          blob: `blob-${index}`,
        };
      },
    });
    const manifestData = { size: 0, chunks: [] };

    await pipeline.chunkAndStore({}, manifestData);

    expect(manifestData.size).toBe(3);
    expect(manifestData.chunks.map((chunk) => chunk.index)).toEqual([0, 1]);
  });
});

describe('StorePipeline source failure metadata', () => {
  it('normalizes source failures with dispatched count and orphaned blobs', async () => {
    const sourceError = new Error('boom');
    const pipeline = new StorePipeline({
      chunker: {
        chunk: async function* chunk() {
          yield new Uint8Array([1]);
          throw sourceError;
        },
      },
      concurrency: 1,
      observability: {
        metric: vi.fn(),
        log: vi.fn(),
        span: vi.fn(),
      },
      storeChunk: async (chunk, index) => ({
        index,
        size: chunk.length,
        digest: `digest-${index}`,
        blob: `blob-${index}`,
      }),
    });

    await expect(pipeline.chunkAndStore({}, { size: 0, chunks: [] }))
      .rejects.toMatchObject({
        code: 'STREAM_ERROR',
        meta: {
          chunksDispatched: 1,
          orphanedBlobs: ['blob-0'],
          originalError: sourceError,
        },
      });
  });
});

describe('StorePipeline write failure metadata', () => {
  it('normalizes write failures with failed index metadata', async () => {
    const pipeline = createPipeline({
      chunks: [new Uint8Array([1])],
      concurrency: 1,
      storeChunk: async () => {
        throw new Error('write exploded');
      },
    });

    await expect(pipeline.chunkAndStore({}, { size: 0, chunks: [] }))
      .rejects.toMatchObject({
        code: 'STORE_ERROR',
        meta: {
          chunksDispatched: 1,
          failedIndex: 0,
          orphanedBlobs: [],
        },
      });
  });

  it('preserves existing CasError codes while adding write metadata', async () => {
    const pipeline = createPipeline({
      chunks: [new Uint8Array([1])],
      concurrency: 1,
      storeChunk: async () => {
        throw new CasError('nope', 'CUSTOM_WRITE');
      },
    });

    await expect(pipeline.chunkAndStore({}, { size: 0, chunks: [] }))
      .rejects.toMatchObject({
        code: 'CUSTOM_WRITE',
        meta: {
          chunksDispatched: 1,
          failedIndex: 0,
          orphanedBlobs: [],
        },
      });
  });
});

describe('CasService store-write boundary', () => {
  it('keeps semaphore-based store scheduling behind ChunkRepository and StorePipeline', () => {
    const casService = read('src/domain/services/CasService.js');
    const chunkRepository = read('src/domain/services/ChunkRepository.js');

    expect(chunkRepository).toContain("from './StorePipeline.js'");
    expect(casService).not.toContain("from './StorePipeline.js'");
    expect(casService).not.toContain("from './Semaphore.js'");
    expect(casService).not.toContain('_launchChunkWrite');
    expect(casService).not.toContain('_readNextStoreChunk');
    expect(casService).not.toContain('_buildStoreWriteError');
  });
});
