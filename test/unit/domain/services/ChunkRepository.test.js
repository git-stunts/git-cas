import { describe, it, expect, vi } from 'vitest';
import ChunkRepository from '../../../../src/domain/services/ChunkRepository.js';
import { InvalidOidError } from '../../../../src/domain/errors/index.js';

describe('ChunkRepository', () => {
  it('stores chunks with digest metadata', async () => {
    const repository = new ChunkRepository({
      chunker: {},
      concurrency: 1,
      convergent: {},
      hashBytes: vi.fn().mockResolvedValue('a'.repeat(64)),
      observability: { metric: vi.fn() },
      persistence: { writeBlob: vi.fn().mockResolvedValue('b'.repeat(40)) },
    });

    await expect(repository.storeChunk(new Uint8Array([1]), 0))
      .resolves.toMatchObject({ index: 0, size: 1, digest: 'a'.repeat(64), blob: 'b'.repeat(40) });
  });

  it('rejects invalid blob OIDs before reading persistence', async () => {
    const persistence = { readBlob: vi.fn() };
    const repository = new ChunkRepository({
      chunker: {},
      concurrency: 1,
      convergent: {},
      hashBytes: vi.fn(),
      observability: { metric: vi.fn() },
      persistence,
    });

    await expect(repository.readChunkBlob('nope'))
      .rejects.toBeInstanceOf(InvalidOidError);
    expect(persistence.readBlob).not.toHaveBeenCalled();
  });
});
