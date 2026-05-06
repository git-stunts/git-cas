import { describe, it, expect, vi } from 'vitest';
import RestoreWhole from '../../../../src/domain/strategies/RestoreWhole.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return chunks;
}

function createStreamingWholeFixture() {
  const ciphertext = [new Uint8Array([1]), new Uint8Array([2])];
  const plaintext = [new Uint8Array([3]), new Uint8Array([4])];
  const decrypt = vi.fn(async function* decryptSource(source) {
    expect(await collect(source)).toEqual(ciphertext);
    yield* plaintext;
  });
  const createDecryptionStream = vi.fn(() => ({ decrypt }));
  const strategy = new RestoreWhole({
    chunkSize: 1024,
    chunks: {
      iterVerifiedChunkBlobs: vi.fn(async function* iterVerifiedChunkBlobs() {
        yield* ciphertext;
      }),
    },
    compression: {},
    crypto: {
      createDecryptionStream,
    },
    isLegacyNoAad: () => false,
    maxRestoreBufferSize: 1,
    observability: { metric: vi.fn() },
  });
  return { createDecryptionStream, decrypt, plaintext, strategy };
}

describe('RestoreWhole', () => {
  it('enforces maxRestoreBufferSize before buffering ciphertext', async () => {
    const strategy = new RestoreWhole({
      chunkSize: 1024,
      chunks: {},
      compression: {},
      crypto: {},
      isLegacyNoAad: () => false,
      maxRestoreBufferSize: 8,
      observability: { metric: vi.fn() },
    });
    const manifest = { slug: 'asset', chunks: [{ size: 9 }] };
    const iterator = strategy.execute({ manifest, key: new Uint8Array(32), encryptionMeta: { scheme: 'whole' } })[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toMatchObject({ code: 'RESTORE_TOO_LARGE' });
  });

  it('uses streaming decrypt for bounded file publication', async () => {
    const { createDecryptionStream, decrypt, plaintext, strategy } = createStreamingWholeFixture();
    const manifest = {
      slug: 'whole-file',
      chunks: [{ size: 1024 }, { size: 1024 }],
    };

    await expect(collect(await strategy.createBoundedSource({
      manifest,
      key: new Uint8Array(32),
      encryptionMeta: { scheme: 'whole' },
    }))).resolves.toEqual(plaintext);

    expect(createDecryptionStream).toHaveBeenCalledTimes(1);
    expect(decrypt).toHaveBeenCalledTimes(1);
  });
});
