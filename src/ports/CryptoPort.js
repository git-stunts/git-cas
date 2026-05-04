import CasError from '../domain/errors/CasError.js';
import { normalizeKdfOptions, assertKdfPolicy } from '../helpers/kdfPolicy.js';
import { encodeBase64 } from '../domain/encoding/base64.js';

/**
 * Encryption metadata returned by AES-256-GCM operations.
 * @typedef {Object} EncryptionMeta
 * @property {string} [scheme] - Payload framing scheme identifier (e.g. `'whole'`).
 * @property {string} algorithm - Cipher algorithm identifier (e.g. `'aes-256-gcm'`).
 * @property {string} nonce - Base64-encoded 12-byte nonce.
 * @property {string} tag - Base64-encoded 16-byte GCM authentication tag.
 * @property {boolean} encrypted - Whether the data is encrypted.
 */

/**
 * KDF parameter set stored alongside derived keys.
 * @typedef {Object} KdfParamSet
 * @property {'pbkdf2'|'scrypt'} algorithm - KDF algorithm.
 * @property {string} salt - Base64-encoded salt.
 * @property {number} [iterations] - PBKDF2 iterations (present when algorithm is pbkdf2).
 * @property {number} [cost] - scrypt cost N (present when algorithm is scrypt).
 * @property {number} [blockSize] - scrypt block size r.
 * @property {number} [parallelization] - scrypt parallelization p.
 * @property {number} keyLength - Derived key length in bytes.
 */

/**
 * Normalized KDF options passed to `_doDeriveKey`.
 * @typedef {Object} DeriveKeyParams
 * @property {string} algorithm - KDF algorithm.
 * @property {number} iterations - PBKDF2 iteration count.
 * @property {number} cost - scrypt cost (N).
 * @property {number} blockSize - scrypt block size (r).
 * @property {number} parallelization - scrypt parallelization (p).
 * @property {number} keyLength - Derived key length in bytes.
 */

/**
 * Abstract port for cryptographic operations (hashing, random bytes, AES-256-GCM).
 * @abstract
 */
export default class CryptoPort {
  /**
   * Returns true if the adapter supports the given capability.
   * @param {'scrypt'} capability
   * @returns {boolean}
   */
  supports(capability) {
    if (capability === 'scrypt') { return true; }
    return false;
  }

  /**
   * Returns the SHA-256 hex digest of a buffer.
   * @param {Uint8Array} _buf - Data to hash.
   * @returns {Promise<string>} 64-char hex digest.
   */
  sha256(_buf) {
    throw new Error('Not implemented');
  }

  /**
   * Returns cryptographically random bytes.
   * @param {number} _n - Number of random bytes.
   * @returns {Uint8Array}
   */
  randomBytes(_n) {
    throw new Error('Not implemented');
  }

  /**
   * Encrypts a buffer using AES-256-GCM.
   * @param {Uint8Array} _buffer - Plaintext to encrypt.
   * @param {Uint8Array} _key - 32-byte encryption key.
   * @param {Uint8Array} [_aad] - Optional additional authenticated data (AAD).
   * @returns {{ buf: Uint8Array, meta: EncryptionMeta }|Promise<{ buf: Uint8Array, meta: EncryptionMeta }>}
   */
  encryptBuffer(_buffer, _key, _aad) {
    throw new Error('Not implemented');
  }

  /**
   * Decrypts a buffer using AES-256-GCM.
   * @param {Uint8Array} _buffer - Ciphertext to decrypt.
   * @param {Uint8Array} _key - 32-byte encryption key.
   * @param {EncryptionMeta} _meta - Encryption metadata from the encrypt operation.
   * @param {Uint8Array} [_aad] - Optional additional authenticated data (AAD). Must match the AAD used during encryption.
   * @returns {Uint8Array|Promise<Uint8Array>}
   * @throws on authentication failure.
   */
  decryptBuffer(_buffer, _key, _meta, _aad) { // eslint-disable-line max-params
    throw new Error('Not implemented');
  }

  /**
   * Creates a streaming encryption context.
   * @param {Uint8Array} _key - 32-byte encryption key.
   * @param {Uint8Array} [_aad] - Optional additional authenticated data (AAD).
   * @returns {{ encrypt: (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>, finalize: () => EncryptionMeta }}
   */
  createEncryptionStream(_key, _aad) {
    throw new Error('Not implemented');
  }

  /**
   * Creates a streaming decryption context.
   * The returned stream may yield tentative plaintext before final auth
   * succeeds, so callers must control publication semantics themselves.
   *
   * @param {Uint8Array} _key - 32-byte encryption key.
   * @param {EncryptionMeta} _meta - Encryption metadata from the encrypt operation.
   * @param {Uint8Array} [_aad] - Optional additional authenticated data (AAD). Must match the AAD used during encryption.
   * @returns {{ decrypt: (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array> }}
   */
  createDecryptionStream(_key, _meta, _aad) {
    throw new Error('Not implemented');
  }

  /**
   * Derives an encryption key from a passphrase using a KDF.
   *
   * Normalizes parameters (defaults, salt generation), then delegates to the
   * adapter-specific `_doDeriveKey()` template method.
   *
   * @param {Object} options
   * @param {string} options.passphrase - The passphrase to derive a key from.
   * @param {Uint8Array} [options.salt] - Salt for the KDF (random if omitted).
   * @param {'pbkdf2'|'scrypt'} [options.algorithm='pbkdf2'] - KDF algorithm.
   * @param {number} [options.iterations=600000] - PBKDF2 iteration count.
   * @param {number} [options.cost=131072] - scrypt cost parameter (N).
   * @param {number} [options.blockSize=8] - scrypt block size (r).
   * @param {number} [options.parallelization=1] - scrypt parallelization (p).
   * @param {number} [options.keyLength=32] - Derived key length in bytes.
   * @returns {Promise<{ key: Uint8Array, salt: Uint8Array, params: KdfParamSet }>}
   */
  async deriveKey({
    passphrase,
    salt,
    algorithm = 'pbkdf2',
    iterations,
    cost,
    blockSize,
    parallelization,
    keyLength,
  }) {
    const normalized = normalizeKdfOptions({
      algorithm,
      iterations,
      cost,
      blockSize,
      parallelization,
      keyLength,
    });
    assertKdfPolicy(normalized, { source: 'deriveKey' });
    const saltBuf = salt || this.randomBytes(32);

    /** @type {KdfParamSet} */
    const params = {
      algorithm: normalized.algorithm,
      salt: encodeBase64(saltBuf),
      keyLength: normalized.keyLength,
    };

    if (normalized.algorithm === 'pbkdf2') {
      params.iterations = normalized.iterations;
    } else if (normalized.algorithm === 'scrypt') {
      params.cost = normalized.cost;
      params.blockSize = normalized.blockSize;
      params.parallelization = normalized.parallelization;
    } else {
      throw new Error(`Unsupported KDF algorithm: ${normalized.algorithm}`);
    }

    const key = await this._doDeriveKey(passphrase, saltBuf, {
      algorithm: normalized.algorithm,
      iterations: normalized.iterations,
      cost: normalized.cost,
      blockSize: normalized.blockSize,
      parallelization: normalized.parallelization,
      keyLength: normalized.keyLength,
    });

    return { key, salt: saltBuf, params };
  }

  /**
   * Adapter-specific key derivation. Override in subclasses.
   * @abstract
   * @param {string} _passphrase - The passphrase.
   * @param {Uint8Array} _saltBuf - Salt bytes.
   * @param {DeriveKeyParams} _params - Normalized KDF parameters.
   * @returns {Promise<Uint8Array>} Derived key bytes.
   */
  async _doDeriveKey(_passphrase, _saltBuf, _params) {
    throw new Error('Not implemented');
  }

  /**
   * Computes HMAC-SHA256 of the given data with the given key.
   *
   * @abstract
   * @param {Uint8Array} key - HMAC key.
   * @param {Uint8Array} data - Data to authenticate.
   * @returns {Uint8Array|Promise<Uint8Array>} 32-byte HMAC digest.
   */
  hmacSha256(_key, _data) {
    throw new Error('Not implemented');
  }

  /**
   * Encrypts a buffer using AES-256-GCM with a caller-provided nonce.
   *
   * Used by convergent encryption where the nonce must be deterministic
   * (derived from content hash) to enable deduplication.
   *
   * @abstract
   * @param {Uint8Array} _buffer - Plaintext to encrypt.
   * @param {Uint8Array} _key - 32-byte encryption key.
   * @param {Uint8Array} _nonce - 12-byte nonce (IV).
   * @returns {{ buf: Uint8Array, tag: Uint8Array }|Promise<{ buf: Uint8Array, tag: Uint8Array }>}
   */
  encryptBufferWithNonce(_buffer, _key, _nonce) {
    throw new Error('Not implemented');
  }

  /**
   * Decrypts a buffer using AES-256-GCM with explicit nonce and tag.
   *
   * Used by convergent encryption to decrypt per-chunk ciphertext
   * where the nonce and tag are stored/derived externally.
   *
   * @abstract
   * @param {Uint8Array} _buffer - Ciphertext to decrypt.
   * @param {Uint8Array} _key - 32-byte encryption key.
   * @param {Uint8Array} _nonce - 12-byte nonce (IV).
   * @param {Uint8Array} _tag - 16-byte GCM authentication tag.
   * @returns {Uint8Array|Promise<Uint8Array>}
   * @throws on authentication failure.
   */
  decryptBufferWithNonceTag(_buffer, _key, _nonce, _tag) { // eslint-disable-line max-params
    throw new Error('Not implemented');
  }

  /**
   * Validates that a key is a 32-byte Uint8Array.
   * @param {Uint8Array} key - Key to validate.
   * @throws {CasError} INVALID_KEY_TYPE if key is not a Uint8Array.
   * @throws {CasError} INVALID_KEY_LENGTH if key is not 32 bytes.
   */
  _validateKey(key) {
    if (!(key instanceof Uint8Array)) {
      throw new CasError(
        'Encryption key must be a Uint8Array',
        'INVALID_KEY_TYPE',
      );
    }
    if (key.length !== 32) {
      throw new CasError(
        `Encryption key must be 32 bytes, got ${key.length}`,
        'INVALID_KEY_LENGTH',
        { expected: 32, actual: key.length },
      );
    }
  }

  /**
   * Builds the encryption metadata object from base64-encoded nonce and tag.
   * @param {string} nonce64 - Base64-encoded 12-byte AES-GCM nonce.
   * @param {string} tag64 - Base64-encoded 16-byte GCM authentication tag.
   * @param {string} [scheme='whole'] - Payload framing scheme identifier.
   * @returns {EncryptionMeta}
   */
  _buildMeta(nonce64, tag64, scheme = 'whole') {
    return {
      scheme,
      algorithm: 'aes-256-gcm',
      nonce: nonce64,
      tag: tag64,
      encrypted: true,
    };
  }
}
