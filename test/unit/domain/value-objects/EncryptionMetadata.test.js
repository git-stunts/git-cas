import { describe, it, expect } from 'vitest';
import EncryptionMetadata from '../../../../src/domain/value-objects/EncryptionMetadata.js';

describe('EncryptionMetadata', () => {
  it('returns undefined for plaintext manifests', () => {
    expect(EncryptionMetadata.fromManifest({ slug: 'plain' })).toBeUndefined();
  });

  it('freezes validated framed metadata', () => {
    const meta = EncryptionMetadata.fromManifest({
      slug: 'asset',
      encryption: {
        scheme: 'framed',
        algorithm: 'aes-256-gcm',
        encrypted: true,
        frameBytes: 1024,
      },
    });

    expect(meta.scheme).toBe('framed');
    expect(Object.isFrozen(meta)).toBe(true);
  });

  it('rejects encrypted metadata downgrades', () => {
    expect(() => EncryptionMetadata.fromManifest({
      slug: 'asset',
      encryption: { scheme: 'whole', algorithm: 'aes-256-gcm', encrypted: false },
    })).toThrow(/downgraded/);
  });
});
