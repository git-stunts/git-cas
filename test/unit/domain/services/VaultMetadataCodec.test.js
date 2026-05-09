import { describe, expect, it } from 'vitest';
import CasError from '../../../../src/domain/errors/CasError.js';
import VaultMetadataCodec from '../../../../src/domain/services/VaultMetadataCodec.js';
import { utf8Encode } from '../../../../src/domain/encoding/utf8.js';

const VALID_SALT = 'qqqqqqqqqqqqqqqqqqqqqg==';

function bytes(value) {
  return utf8Encode(JSON.stringify(value));
}

function encryptedMetadata(overrides = {}) {
  return {
    version: 1,
    encryption: {
      cipher: 'aes-256-gcm',
      kdf: {
        algorithm: 'pbkdf2',
        salt: VALID_SALT,
        iterations: 100000,
        keyLength: 32,
      },
    },
    ...overrides,
  };
}

describe('VaultMetadataCodec encoding', () => {
  it('decodes valid vault metadata from bytes', () => {
    const codec = new VaultMetadataCodec();

    expect(codec.decode(bytes({ version: 1 }))).toEqual({ version: 1 });
  });

  it('encodes metadata as deterministic UTF-8 JSON bytes', () => {
    const codec = new VaultMetadataCodec();

    const encoded = codec.encode({ version: 1 });

    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(codec.decode(encoded)).toEqual({ version: 1 });
  });
});

describe('VaultMetadataCodec version validation', () => {
  it('rejects unsupported metadata versions with a domain error', () => {
    const codec = new VaultMetadataCodec();

    expect(() => codec.decode(bytes({ version: 2 }))).toThrow(CasError);
    expect(() => codec.decode(bytes({ version: 2 }))).toThrow(
      expect.objectContaining({ code: 'VAULT_METADATA_INVALID' }),
    );
  });
});

describe('VaultMetadataCodec cipher validation', () => {
  it('rejects unsupported encryption ciphers at the boundary', () => {
    const codec = new VaultMetadataCodec();
    const metadata = encryptedMetadata({
      encryption: {
        ...encryptedMetadata().encryption,
        cipher: 'chacha20-poly1305',
      },
    });

    expect(() => codec.decode(bytes(metadata))).toThrow(
      expect.objectContaining({
        code: 'VAULT_METADATA_INVALID',
        meta: expect.objectContaining({
          field: 'encryption.cipher',
          expected: 'aes-256-gcm',
        }),
      }),
    );
  });
});

describe('VaultMetadataCodec encryption validation', () => {
  it('normalizes malformed KDF metadata to VAULT_METADATA_INVALID', () => {
    const codec = new VaultMetadataCodec();
    const metadata = encryptedMetadata({
      encryption: {
        cipher: 'aes-256-gcm',
        kdf: { algorithm: 'pbkdf2', salt: VALID_SALT, iterations: 100000 },
      },
    });

    expect(() => codec.decode(bytes(metadata))).toThrow(
      expect.objectContaining({ code: 'VAULT_METADATA_INVALID' }),
    );
  });

  it('normalizes unsupported KDF algorithms to VAULT_METADATA_INVALID', () => {
    const codec = new VaultMetadataCodec();
    const metadata = encryptedMetadata({
      encryption: {
        cipher: 'aes-256-gcm',
        kdf: {
          algorithm: 'argon2id',
          salt: VALID_SALT,
          iterations: 100000,
          keyLength: 32,
        },
      },
    });

    let thrown;
    try {
      codec.decode(bytes(metadata));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({
      code: 'VAULT_METADATA_INVALID',
      meta: {
        originalError: expect.objectContaining({ code: 'KDF_POLICY_VIOLATION' }),
      },
    });
  });
});

describe('VaultMetadataCodec verifier validation', () => {
  it('rejects invalid verifier metadata without leaking raw errors', () => {
    const codec = new VaultMetadataCodec();
    const metadata = encryptedMetadata({
      encryption: {
        ...encryptedMetadata().encryption,
        verifier: {
          version: 1,
          ciphertext: 'not-base64',
          meta: { algorithm: 'aes-256-gcm', nonce: 'n', tag: 't', encrypted: true },
        },
      },
    });

    expect(() => codec.decode(bytes(metadata))).toThrow(
      expect.objectContaining({ code: 'VAULT_METADATA_INVALID' }),
    );
  });

  it('rejects encryptionCount values outside the vault nonce budget', () => {
    const codec = new VaultMetadataCodec();
    const metadata = encryptedMetadata({ encryptionCount: 2 ** 32 });

    expect(() => codec.decode(bytes(metadata))).toThrow(
      expect.objectContaining({
        code: 'VAULT_METADATA_INVALID',
        meta: expect.objectContaining({ field: 'encryptionCount' }),
      }),
    );
  });
});
