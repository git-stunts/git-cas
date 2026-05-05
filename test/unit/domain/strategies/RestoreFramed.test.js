import { describe, it, expect, vi } from 'vitest';
import RestoreFramed from '../../../../src/domain/strategies/RestoreFramed.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('RestoreFramed', () => {
  it('decrypts framed records and emits plaintext chunks', async () => {
    const chunks = { iterVerifiedChunkBlobs: vi.fn().mockReturnValue({}) };
    const framed = { async *decryptSource() { yield new Uint8Array([4]); } };
    const compression = { decompress: vi.fn() };
    const observability = { metric: vi.fn() };
    const manifest = { slug: 'asset', chunks: [{}] };

    await expect(collect(new RestoreFramed({
      chunks,
      compression,
      framed,
      isLegacyNoAad: () => false,
      observability,
    }).execute({ manifest, key: new Uint8Array(32), encryptionMeta: { frameBytes: 1024 } })))
      .resolves.toEqual([new Uint8Array([4])]);
  });
});
