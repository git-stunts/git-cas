import CasError from '../domain/errors/CasError.js';

/**
 * Abstract port for cryptographic operations (hashing, random bytes, AES-256-GCM).
 * @abstract
 */
export default class CryptoPort {
  /**
   * Returns the SHA-256 hex digest of a buffer.
   * @param {Buffer} buf
   * @returns {string} 64-char hex digest
   */
  sha256(_buf) {
    throw new Error('Not implemented');
  }

  /**
   * Returns a Buffer of n cryptographically random bytes.
   * @param {number} n
   * @returns {Buffer}
   */
  randomBytes(_n) {
    throw new Error('Not implemented');
  }

  /**
   * Encrypts a buffer using AES-256-GCM.
   * @param {Buffer} buffer
   * @param {Buffer} key - 32-byte encryption key
   * @returns {{ buf: Buffer, meta: { algorithm: string, nonce: string, tag: string, encrypted: boolean } }}
   */
  encryptBuffer(_buffer, _key) {
    throw new Error('Not implemented');
  }

  /**
   * Decrypts a buffer using AES-256-GCM.
   * @param {Buffer} buffer
   * @param {Buffer} key - 32-byte encryption key
   * @param {{ algorithm: string, nonce: string, tag: string, encrypted: boolean }} meta
   * @returns {Buffer}
   * @throws on authentication failure
   */
  decryptBuffer(_buffer, _key, _meta) {
    throw new Error('Not implemented');
  }

  /**
   * Creates a streaming encryption context.
   * @param {Buffer} key - 32-byte encryption key
   * @returns {{ encrypt: (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>, finalize: () => { algorithm: string, nonce: string, tag: string, encrypted: boolean } }}
   */
  createEncryptionStream(_key) {
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
   * @param {Buffer} [options.salt] - Salt for the KDF (random if omitted).
   * @param {'pbkdf2'|'scrypt'} [options.algorithm='pbkdf2'] - KDF algorithm.
   * @param {number} [options.iterations=100000] - PBKDF2 iteration count.
   * @param {number} [options.cost=16384] - scrypt cost parameter (N).
   * @param {number} [options.blockSize=8] - scrypt block size (r).
   * @param {number} [options.parallelization=1] - scrypt parallelization (p).
   * @param {number} [options.keyLength=32] - Derived key length in bytes.
   * @returns {Promise<{ key: Buffer, salt: Buffer, params: { algorithm: string, salt: string, iterations?: number, cost?: number, blockSize?: number, parallelization?: number, keyLength: number } }>}
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
   * @param {string} passphrase
   * @param {Buffer|Uint8Array} saltBuf
   * @param {Object} params - Normalized KDF parameters.
   * @returns {Promise<Buffer|Uint8Array>} Derived key bytes.
   */
  async _doDeriveKey(_passphrase, _saltBuf, _params) {
    throw new Error('Not implemented');
  }

  /**
   * Validates that a key is a 32-byte Buffer or Uint8Array.
   * @param {Buffer|Uint8Array} key
   * @throws {CasError} INVALID_KEY_TYPE if key is not a Buffer or Uint8Array
   * @throws {CasError} INVALID_KEY_LENGTH if key is not 32 bytes
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
   * @returns {{ algorithm: string, nonce: string, tag: string, encrypted: boolean }}
   */
  _buildMeta(nonce64, tag64) {
    return {
      algorithm: 'aes-256-gcm',
      nonce: nonce64,
      tag: tag64,
      encrypted: true,
    };
  }
}
