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
  deriveKey(_options) {
    throw new Error('Not implemented');
  }
}
