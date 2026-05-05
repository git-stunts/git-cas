import { describe, it, expect, vi } from 'vitest';
import StoreConvergent from '../../../../src/domain/strategies/StoreConvergent.js';

describe('StoreConvergent', () => {
  it('stores with a convergent key and stamps encryption metadata', async () => {
    const chunks = { chunkAndStore: vi.fn() };
    const manifestData = { chunks: [], size: 0 };
    const key = new Uint8Array(32);

    await new StoreConvergent(chunks).execute({
      processedSource: {},
      manifestData,
      keyInfo: { key, encExtra: { kdf: { algorithm: 'pbkdf2' } } },
    });

    expect(chunks.chunkAndStore).toHaveBeenCalledWith({}, manifestData, { convergentKey: key });
    expect(manifestData.encryption).toMatchObject({ scheme: 'convergent', encrypted: true });
  });
});
