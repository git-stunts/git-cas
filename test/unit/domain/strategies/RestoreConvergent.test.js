import { describe, it, expect, vi } from 'vitest';
import RestoreConvergent from '../../../../src/domain/strategies/RestoreConvergent.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('RestoreConvergent', () => {
  it('restores convergent chunks through the chunk repository', async () => {
    const chunks = { async *iterConvergentChunks() { yield new Uint8Array([3]); } };
    const compression = { decompress: vi.fn() };
    const observability = { metric: vi.fn() };
    const manifest = { slug: 'asset', chunks: [{}] };

    await expect(collect(new RestoreConvergent({ chunks, compression, observability }).execute({
      manifest,
      key: new Uint8Array(32),
    }))).resolves.toEqual([new Uint8Array([3])]);
  });
});
