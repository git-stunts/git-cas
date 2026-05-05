import { describe, it, expect, vi } from 'vitest';
import StoreFramed from '../../../../src/domain/strategies/StoreFramed.js';

describe('StoreFramed', () => {
  it('frames the source before chunk storage and stamps frameBytes', async () => {
    const framedSource = {};
    const chunks = { chunkAndStore: vi.fn() };
    const framed = { encryptFrames: vi.fn().mockReturnValue(framedSource) };
    const manifestData = { slug: 'asset', chunks: [], size: 0 };
    const key = new Uint8Array(32);

    await new StoreFramed({ chunks, framed }).execute({
      processedSource: {},
      manifestData,
      keyInfo: { key, encExtra: {} },
      encryptionConfig: { frameBytes: 2048 },
    });

    expect(framed.encryptFrames).toHaveBeenCalledWith({}, key, { frameBytes: 2048, slug: 'asset' });
    expect(chunks.chunkAndStore).toHaveBeenCalledWith(framedSource, manifestData);
    expect(manifestData.encryption).toMatchObject({ scheme: 'framed', frameBytes: 2048 });
  });
});
