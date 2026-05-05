import { describe, it, expect, vi } from 'vitest';
import IntegrityVerifier from '../../../../src/domain/services/IntegrityVerifier.js';

describe('IntegrityVerifier', () => {
  it('passes unencrypted chunk digest verification', async () => {
    const observability = { metric: vi.fn() };
    const verifier = new IntegrityVerifier({
      chunks: { readChunkBlob: vi.fn().mockResolvedValue(new Uint8Array([1])) },
      crypto: { sha256: vi.fn().mockResolvedValue('a'.repeat(64)) },
      framed: {},
      isLegacyNoAad: () => false,
      keyResolver: {},
      observability,
      validateEncryptionMeta: () => undefined,
    });
    const manifest = {
      slug: 'asset',
      chunks: [{ index: 0, digest: 'a'.repeat(64), blob: 'b'.repeat(40) }],
    };

    await expect(verifier.verify(manifest)).resolves.toBe(true);
    expect(observability.metric).toHaveBeenCalledWith('integrity', { action: 'pass', slug: 'asset' });
  });
});
