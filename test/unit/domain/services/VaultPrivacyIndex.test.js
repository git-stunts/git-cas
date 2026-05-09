import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import VaultPrivacyIndex from '../../../../src/domain/services/VaultPrivacyIndex.js';
import { utf8Decode, utf8Encode } from '../../../../src/domain/encoding/utf8.js';

function mockCrypto() {
  return {
    hmacSha256(key, data) {
      return createHmac('sha256', key).update(data).digest();
    },
    encryptBuffer: vi.fn(async (plaintext) => ({
      buf: Uint8Array.from(plaintext),
      meta: { algorithm: 'aes-256-gcm', nonce: 'n', tag: 't', encrypted: true },
    })),
    decryptBuffer: vi.fn(async (ciphertext) => Uint8Array.from(ciphertext)),
  };
}

describe('VaultPrivacyIndex persisted names', () => {
  it('derives stable persisted names for the same key and slug', async () => {
    const privacy = new VaultPrivacyIndex({ crypto: mockCrypto() });
    const key = Uint8Array.from(Array(32).fill(7));

    const first = await privacy.persistedNameForSlug({ encryptionKey: key, slug: 'demo/hello' });
    const second = await privacy.persistedNameForSlug({ encryptionKey: key, slug: 'demo/hello' });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses different persisted names for different encryption keys', async () => {
    const privacy = new VaultPrivacyIndex({ crypto: mockCrypto() });

    await expect(Promise.all([
      privacy.persistedNameForSlug({
        encryptionKey: Uint8Array.from(Array(32).fill(1)),
        slug: 'demo/hello',
      }),
      privacy.persistedNameForSlug({
        encryptionKey: Uint8Array.from(Array(32).fill(2)),
        slug: 'demo/hello',
      }),
    ])).resolves.toSatisfy(([first, second]) => first !== second);
  });
});

describe('VaultPrivacyIndex index codec', () => {
  it('encrypts and decrypts the slug-to-HMAC index through the crypto port', async () => {
    const crypto = mockCrypto();
    const privacy = new VaultPrivacyIndex({ crypto });
    const slugToHmac = new Map([['demo/hello', 'a'.repeat(64)]]);

    const encrypted = await privacy.encryptIndex({ slugToHmac, encryptionKey: Uint8Array.from([1]) });
    const decoded = JSON.parse(utf8Decode(encrypted.bytes));
    const decrypted = await privacy.decryptIndex({
      bytes: encrypted.bytes,
      encryptionKey: Uint8Array.from([1]),
      meta: encrypted.meta,
    });

    expect(decoded).toEqual({ 'demo/hello': 'a'.repeat(64) });
    expect(decrypted).toEqual(slugToHmac);
    expect(crypto.encryptBuffer).toHaveBeenCalledOnce();
    expect(crypto.decryptBuffer).toHaveBeenCalledOnce();
  });

  it('rejects decrypted index payloads with invalid persisted names', async () => {
    const crypto = mockCrypto();
    crypto.decryptBuffer = vi.fn(async () => utf8Encode(JSON.stringify({ 'demo/hello': 'bad' })));
    const privacy = new VaultPrivacyIndex({ crypto });

    await expect(privacy.decryptIndex({
      bytes: Uint8Array.from([1]),
      encryptionKey: Uint8Array.from([1]),
      meta: {},
    })).rejects.toMatchObject({
      code: 'VAULT_PRIVACY_INDEX_INVALID',
      meta: expect.objectContaining({ field: 'persistedName' }),
    });
  });
});
