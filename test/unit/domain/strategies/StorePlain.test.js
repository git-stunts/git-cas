import { describe, it, expect, vi } from 'vitest';
import StorePlain from '../../../../src/domain/strategies/StorePlain.js';

describe('StorePlain', () => {
  it('delegates plaintext source storage to the chunk repository', async () => {
    const chunks = { chunkAndStore: vi.fn() };
    const manifestData = { chunks: [], size: 0 };
    const source = {};

    await new StorePlain(chunks).execute({ processedSource: source, manifestData });

    expect(chunks.chunkAndStore).toHaveBeenCalledWith(source, manifestData);
  });
});
