/**
 * @fileoverview Convergent encryption service.
 *
 * Encapsulates per-chunk deterministic encryption where the key and nonce are
 * derived from the plaintext content hash. Identical plaintext chunks produce
 * identical ciphertext, preserving deduplication even with encryption enabled.
 *
 * Receives a CryptoPort via constructor injection — no platform dependencies.
 */
import CasError from '../errors/CasError.js';

const GCM_TAG_BYTES = 16;

/**
 * Per-chunk convergent encryption and decryption.
 *
 * Key derivation:
 *   chunkKey  = HMAC-SHA256(masterKey, "git-cas-convergent-key:<digest>")[0..31]
 *   chunkNonce = HMAC-SHA256(masterKey, "git-cas-convergent-nonce:<digest>")[0..11]
 *
 * Blob format: ciphertext || 16-byte GCM auth tag
 */
export default class ConvergentEncryption {
  /** @type {import('../../ports/CryptoPort.js').default} */
  #crypto;

  /**
   * @param {import('../../ports/CryptoPort.js').default} crypto - CryptoPort adapter.
   */
  constructor(crypto) {
    this.#crypto = crypto;
  }

  /**
   * Derives the per-chunk AES-256 key from the master key and chunk digest.
   * @param {Buffer} masterKey
   * @param {string} digest - 64-char hex SHA-256 of the plaintext chunk.
   * @returns {Buffer} 32-byte derived key.
   */
  deriveChunkKey(masterKey, digest) {
    return this.#crypto.hmacSha256(masterKey, `git-cas-convergent-key:${digest}`).subarray(0, 32);
  }

  /**
   * Derives the per-chunk 12-byte nonce from the master key and chunk digest.
   * @param {Buffer} masterKey
   * @param {string} digest - 64-char hex SHA-256 of the plaintext chunk.
   * @returns {Buffer} 12-byte derived nonce.
   */
  deriveChunkNonce(masterKey, digest) {
    return this.#crypto.hmacSha256(masterKey, `git-cas-convergent-nonce:${digest}`).subarray(0, 12);
  }

  /**
   * Encrypts a plaintext chunk for convergent storage.
   *
   * @param {Buffer} plaintext - Chunk data.
   * @param {Buffer} masterKey - Convergent master key.
   * @param {string} digest - SHA-256 hex digest of plaintext.
   * @returns {Promise<Buffer>} Blob data: ciphertext || 16-byte GCM tag.
   */
  async encryptChunk(plaintext, masterKey, digest) {
    const key = this.deriveChunkKey(masterKey, digest);
    const nonce = this.deriveChunkNonce(masterKey, digest);
    const { buf, tag } = await Promise.resolve(
      this.#crypto.encryptBufferWithNonce(plaintext, key, nonce),
    );
    return Buffer.concat([buf, tag]);
  }

  /**
   * Decrypts a convergent-encrypted chunk and verifies its plaintext digest.
   *
   * @param {Object} options
   * @param {Buffer} options.blob - Encrypted blob (ciphertext || 16-byte tag).
   * @param {Buffer} options.masterKey - Convergent master key.
   * @param {string} options.expectedDigest - Expected SHA-256 hex digest of plaintext.
   * @param {number} options.chunkIndex - Chunk index (for error context).
   * @returns {Promise<Buffer>} Verified plaintext.
   * @throws {CasError} INTEGRITY_ERROR on decryption failure or digest mismatch.
   */
  async decryptAndVerifyChunk({ blob, masterKey, expectedDigest, chunkIndex }) {
    if (blob.length < GCM_TAG_BYTES) {
      throw new CasError(
        `Convergent blob too short (${blob.length} bytes) — must contain at least ${GCM_TAG_BYTES}-byte GCM tag`,
        'INTEGRITY_ERROR',
        { chunkIndex, blobLength: blob.length, minLength: GCM_TAG_BYTES },
      );
    }
    const ciphertext = blob.subarray(0, -GCM_TAG_BYTES);
    const tag = blob.subarray(-GCM_TAG_BYTES);
    const key = this.deriveChunkKey(masterKey, expectedDigest);
    const nonce = this.deriveChunkNonce(masterKey, expectedDigest);

    let plaintext;
    try {
      plaintext = await Promise.resolve(
        this.#crypto.decryptBufferWithNonceTag(ciphertext, key, nonce, tag),
      );
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(
        `Chunk ${chunkIndex} convergent decryption failed`,
        'INTEGRITY_ERROR',
        { chunkIndex, expected: expectedDigest, originalError: err },
      );
    }

    const digest = await this.#crypto.sha256(plaintext);
    if (digest !== expectedDigest) {
      throw new CasError(
        `Chunk ${chunkIndex} integrity check failed after convergent decryption`,
        'INTEGRITY_ERROR',
        { chunkIndex, expected: expectedDigest, actual: digest },
      );
    }
    return plaintext;
  }
}
