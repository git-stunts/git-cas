/**
 * Port for cryptographic operations.
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
}
