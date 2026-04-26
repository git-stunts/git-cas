import { describe, expect, it } from 'vitest';
import validateAesGcmMeta from '../../../src/helpers/aesGcmMeta.js';

function base64Bytes(length, fill) {
  return Buffer.alloc(length, fill).toString('base64');
}

describe('validateAesGcmMeta()', () => {
  const valid = {
    encrypted: true,
    algorithm: 'aes-256-gcm',
    nonce: base64Bytes(12, 0x11),
    tag: base64Bytes(16, 0x22),
  };

  it('decodes valid metadata', () => {
    const decoded = validateAesGcmMeta(valid);
    expect(Buffer.from(decoded.nonce)).toHaveLength(12);
    expect(Buffer.from(decoded.tag)).toHaveLength(16);
  });

  it('rejects an unexpected algorithm', () => {
    expect(() => validateAesGcmMeta({
      ...valid,
      algorithm: 'aes-128-cbc',
    })).toThrow(expect.objectContaining({
      code: 'INTEGRITY_ERROR',
      meta: expect.objectContaining({ reason: 'invalid-encryption-meta', field: 'algorithm' }),
    }));
  });

  it('rejects non-canonical nonce base64', () => {
    expect(() => validateAesGcmMeta({
      ...valid,
      nonce: '%%%not-base64%%%',
    })).toThrow(expect.objectContaining({
      code: 'INTEGRITY_ERROR',
      meta: expect.objectContaining({ reason: 'invalid-encryption-meta', field: 'nonce' }),
    }));
  });

  it('rejects short auth tags', () => {
    expect(() => validateAesGcmMeta({
      ...valid,
      tag: base64Bytes(8, 0x33),
    })).toThrow(expect.objectContaining({
      code: 'INTEGRITY_ERROR',
      meta: expect.objectContaining({ reason: 'invalid-encryption-meta', field: 'tag' }),
    }));
  });
});
