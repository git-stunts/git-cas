import { describe, it, expect, vi } from 'vitest';
import RestoreWhole from '../../../../src/domain/strategies/RestoreWhole.js';

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
});
