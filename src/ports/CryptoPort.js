import CasError from '../domain/errors/CasError.js';

/**
 * Encryption metadata returned by AES-256-GCM operations.
 * @typedef {Object} EncryptionMeta
 * @property {string} [scheme] - Payload framing scheme identifier (e.g. `'whole-v1'`).
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
   * Returns the SHA-256 hex digest of a buffer.
   * @param {Buffer|Uint8Array} _buf - Data to hash.
   * @returns {Promise<string>} 64-char hex digest.
   */
  sha256(_buf) {
    throw new Error('Not implemented');
  }

  /**
   * Returns a Buffer of n cryptographically random bytes.
   * @param {number} _n - Number of random bytes.
   * @returns {Buffer|Uint8Array}
   */
  randomBytes(_n) {
    throw new Error('Not implemented');
  }

  /**
   * Encrypts a buffer using AES-256-GCM.
   * @param {Buffer|Uint8Array} _buffer - Plaintext to encrypt.
   * @param {Buffer|Uint8Array} _key - 32-byte encryption key.
   * @returns {{ buf: Buffer, meta: EncryptionMeta }|Promise<{ buf: Buffer, meta: EncryptionMeta }>}
   */
  encryptBuffer(_buffer, _key) {
    throw new Error('Not implemented');
  }

  /**
   * Decrypts a buffer using AES-256-GCM.
   * @param {Buffer|Uint8Array} _buffer - Ciphertext to decrypt.
   * @param {Buffer|Uint8Array} _key - 32-byte encryption key.
   * @param {EncryptionMeta} _meta - Encryption metadata from the encrypt operation.
   * @returns {Buffer|Promise<Buffer>}
   * @throws on authentication failure.
   */
  decryptBuffer(_buffer, _key, _meta) {
    throw new Error('Not implemented');
  }

  /**
   * Creates a streaming encryption context.
   * @param {Buffer|Uint8Array} _key - 32-byte encryption key.
   * @returns {{ encrypt: (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>, finalize: () => EncryptionMeta }}
   */
  createEncryptionStream(_key) {
    throw new Error('Not implemented');
  }

  /**
   * Creates a streaming decryption context.
   * The returned stream may yield tentative plaintext before final auth
   * succeeds, so callers must control publication semantics themselves.
   *
   * @param {Buffer|Uint8Array} _key - 32-byte encryption key.
   * @param {EncryptionMeta} _meta - Encryption metadata from the encrypt operation.
   * @returns {{ decrypt: (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer> }}
   */
  createDecryptionStream(_key, _meta) {
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
   * @param {Buffer|Uint8Array} [options.salt] - Salt for the KDF (random if omitted).
   * @param {'pbkdf2'|'scrypt'} [options.algorithm='pbkdf2'] - KDF algorithm.
   * @param {number} [options.iterations=100000] - PBKDF2 iteration count.
   * @param {number} [options.cost=16384] - scrypt cost parameter (N).
   * @param {number} [options.blockSize=8] - scrypt block size (r).
   * @param {number} [options.parallelization=1] - scrypt parallelization (p).
   * @param {number} [options.keyLength=32] - Derived key length in bytes.
   * @returns {Promise<{ key: Buffer, salt: Buffer, params: KdfParamSet }>}
   */
  async deriveKey({
    passphrase,
    salt,
    algorithm = 'pbkdf2',
    iterations = 100_000,
    cost = 16384,
    blockSize = 8,
    parallelization = 1,
    keyLength = 32,
  }) {
    const saltBuf = salt || this.randomBytes(32);

    /** @type {KdfParamSet} */
    const params = {
      algorithm,
      salt: Buffer.from(saltBuf).toString('base64'),
      keyLength,
    };

    if (algorithm === 'pbkdf2') {
      params.iterations = iterations;
    } else if (algorithm === 'scrypt') {
      params.cost = cost;
      params.blockSize = blockSize;
      params.parallelization = parallelization;
    } else {
      throw new Error(`Unsupported KDF algorithm: ${algorithm}`);
    }

    const key = await this._doDeriveKey(passphrase, saltBuf, {
      algorithm,
      iterations,
      cost,
      blockSize,
      parallelization,
      keyLength,
    });

    return { key: Buffer.from(key), salt: Buffer.from(saltBuf), params };
  }

  /**
   * Adapter-specific key derivation. Override in subclasses.
   * @abstract
   * @param {string} _passphrase - The passphrase.
   * @param {Buffer|Uint8Array} _saltBuf - Salt bytes.
   * @param {DeriveKeyParams} _params - Normalized KDF parameters.
   * @returns {Promise<Buffer|Uint8Array>} Derived key bytes.
   */
  async _doDeriveKey(_passphrase, _saltBuf, _params) {
    throw new Error('Not implemented');
  }

  /**
   * Validates that a key is a 32-byte Buffer or Uint8Array.
   * @param {Buffer|Uint8Array} key - Key to validate.
   * @throws {CasError} INVALID_KEY_TYPE if key is not a Buffer or Uint8Array.
   * @throws {CasError} INVALID_KEY_LENGTH if key is not 32 bytes.
   */
  _validateKey(key) {
    if (!globalThis.Buffer?.isBuffer(key) && !(key instanceof Uint8Array)) {
      throw new CasError(
        'Encryption key must be a Buffer or Uint8Array',
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
   * @returns {EncryptionMeta}
   */
  _buildMeta(nonce64, tag64) {
    return {
      scheme: 'whole-v1',
      algorithm: 'aes-256-gcm',
      nonce: nonce64,
      tag: tag64,
      encrypted: true,
    };
  }
}
