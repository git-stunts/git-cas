import { describe, it, expect, vi } from 'vitest';
import StoreWhole from '../../../../src/domain/strategies/StoreWhole.js';

describe('StoreWhole', () => {
  it('encrypts through the crypto stream and stamps final metadata', async () => {
    const encryptedSource = {};
    const chunks = { chunkAndStore: vi.fn() };
    const crypto = {
      createEncryptionStream: vi.fn().mockReturnValue({
        encrypt: vi.fn().mockReturnValue(encryptedSource),
        finalize: vi.fn().mockReturnValue({ encrypted: true, algorithm: 'aes-256-gcm', nonce: 'n', tag: 't' }),
      }),
    };
    const manifestData = { slug: 'asset', chunks: [], size: 0 };

    await new StoreWhole({ chunks, crypto }).execute({
      processedSource: {},
      manifestData,
      keyInfo: { key: new Uint8Array(32), encExtra: {} },
    });

    expect(chunks.chunkAndStore).toHaveBeenCalledWith(encryptedSource, manifestData);
    expect(manifestData.encryption).toMatchObject({ scheme: 'whole', encrypted: true });
  });
});
