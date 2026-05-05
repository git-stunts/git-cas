import { describe, it, expect, vi } from 'vitest';
import RestorePlain from '../../../../src/domain/strategies/RestorePlain.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('RestorePlain', () => {
  it('emits verified chunk blobs and records a file metric', async () => {
    const chunks = { async *iterVerifiedChunkBlobs() { yield new Uint8Array([1]); } };
    const observability = { metric: vi.fn() };
    const manifest = { slug: 'asset', chunks: [{}] };

    await expect(collect(new RestorePlain({ chunks, observability }).execute({ manifest })))
      .resolves.toEqual([new Uint8Array([1])]);
    expect(observability.metric).toHaveBeenCalledWith('file', expect.objectContaining({ action: 'restored', size: 1 }));
  });
});
