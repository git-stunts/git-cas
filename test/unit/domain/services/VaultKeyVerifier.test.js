import { describe, expect, it, vi } from 'vitest';
import CasError from '../../../../src/domain/errors/CasError.js';
import VaultKeyVerifier from '../../../../src/domain/services/VaultKeyVerifier.js';
import { utf8Encode } from '../../../../src/domain/encoding/utf8.js';

const RIGHT_KEY = Uint8Array.from([1]);
const WRONG_KEY = Uint8Array.from([2]);
const VERIFIER_TEXT = 'git-cas-vault-verifier-v1';

function mockCrypto() {
  return {
    encryptBuffer: vi.fn(async (plaintext) => ({
      buf: Uint8Array.from(plaintext),
      meta: {
        algorithm: 'aes-256-gcm',
        nonce: 'AAAAAAAAAAAAAAAA',
        tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
        encrypted: true,
      },
    })),
    decryptBuffer: vi.fn(async (_ciphertext, key) => (
      key === RIGHT_KEY ? utf8Encode(VERIFIER_TEXT) : utf8Encode('wrong verifier')
    )),
  };
}

describe('VaultKeyVerifier creation', () => {
  it('creates verifier metadata with encrypted ciphertext and AES-GCM metadata', async () => {
    const verifier = new VaultKeyVerifier({ crypto: mockCrypto() });

    await expect(verifier.create(RIGHT_KEY)).resolves.toMatchObject({
      version: 1,
      ciphertext: expect.any(String),
      meta: expect.objectContaining({
        algorithm: 'aes-256-gcm',
        encrypted: true,
      }),
    });
  });
});

describe('VaultKeyVerifier verification', () => {
  it('accepts the right key for existing verifier metadata', async () => {
    const crypto = mockCrypto();
    const verifier = new VaultKeyVerifier({ crypto });
    const metadata = { version: 1, encryption: { verifier: await verifier.create(RIGHT_KEY) } };

    await expect(verifier.verify(metadata, RIGHT_KEY)).resolves.toBe(true);
  });

  it('rejects the wrong key with INTEGRITY_ERROR', async () => {
    const verifier = new VaultKeyVerifier({ crypto: mockCrypto() });
    const metadata = { version: 1, encryption: { verifier: await verifier.create(RIGHT_KEY) } };

    await expect(verifier.verify(metadata, WRONG_KEY)).rejects.toMatchObject({
      code: 'INTEGRITY_ERROR',
      message: expect.stringContaining('Vault passphrase verification failed'),
    });
  });

  it('normalizes raw crypto failures into CasError', async () => {
    const rootCause = new TypeError('bad decrypt');
    const verifier = new VaultKeyVerifier({
      crypto: {
        encryptBuffer: vi.fn(),
        decryptBuffer: vi.fn(async () => { throw rootCause; }),
      },
    });
    const metadata = {
      version: 1,
      encryption: {
        verifier: {
          version: 1,
          ciphertext: 'ZGF0YQ==',
          meta: { algorithm: 'aes-256-gcm', nonce: 'n', tag: 't', encrypted: true },
        },
      },
    };

    await expect(verifier.verify(metadata, RIGHT_KEY)).rejects.toSatisfy(
      (err) => err instanceof CasError && err.code === 'INTEGRITY_ERROR',
    );
  });
});
