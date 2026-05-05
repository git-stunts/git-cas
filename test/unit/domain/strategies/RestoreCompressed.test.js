import { describe, it, expect, vi } from 'vitest';
import RestoreCompressed from '../../../../src/domain/strategies/RestoreCompressed.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('RestoreCompressed', () => {
  it('decompresses verified chunk blobs', async () => {
    const chunks = { iterVerifiedChunkBlobs: vi.fn().mockReturnValue({}) };
    const compression = { async *decompress() { yield new Uint8Array([2]); } };
    const observability = { metric: vi.fn() };
    const manifest = { slug: 'asset', chunks: [{}], compression: { algorithm: 'gzip' } };

    await expect(collect(new RestoreCompressed({ chunks, compression, observability }).execute({ manifest })))
      .resolves.toEqual([new Uint8Array([2])]);
  });
});
