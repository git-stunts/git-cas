import Manifest from '../value-objects/Manifest.js';
import CasError from '../errors/CasError.js';

/**
 * Domain service for Content Addressable Storage operations.
 */
export default class CasService {
  /**
   * @param {Object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/CodecPort.js').default} options.codec
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {number} [options.chunkSize=262144] - 256 KiB
   */
  constructor({ persistence, codec, crypto, chunkSize = 256 * 1024 }) {
    if (chunkSize < 1024) {
      throw new Error('Chunk size must be at least 1024 bytes');
    }
    this.persistence = persistence;
    this.codec = codec;
    this.crypto = crypto;
    this.chunkSize = chunkSize;
  }

  /**
   * Generates a SHA-256 hash for a buffer.
   * @private
   */
  _sha256(buf) {
    return this.crypto.sha256(buf);
  }

  /**
   * Helper to process an async iterable into chunks and store them.
   * @private
   * @param {AsyncIterable<Buffer>} source
   * @param {Object} manifestData
   */
  async _chunkAndStore(source, manifestData) {
    let buffer = Buffer.alloc(0);

    try {
      for await (const chunk of source) {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= this.chunkSize) {
          const chunkBuf = buffer.slice(0, this.chunkSize);
          buffer = buffer.slice(this.chunkSize);

          const digest = this._sha256(chunkBuf);
          const blob = await this.persistence.writeBlob(chunkBuf);

          manifestData.chunks.push({
            index: manifestData.chunks.length,
            size: chunkBuf.length,
            digest,
            blob
          });
          manifestData.size += chunkBuf.length;
        }
      }
    } catch (err) {
      if (err instanceof CasError) throw err;
      throw new CasError(
        `Stream error during store: ${err.message}`,
        'STREAM_ERROR',
        { chunksWritten: manifestData.chunks.length, originalError: err },
      );
    }

    // Process remaining buffer
    if (buffer.length > 0) {
      const digest = this._sha256(buffer);
      const blob = await this.persistence.writeBlob(buffer);

      manifestData.chunks.push({
        index: manifestData.chunks.length,
        size: buffer.length,
        digest,
        blob
      });
      manifestData.size += buffer.length;
    }
  }

  /**
   * Validates that an encryption key is a 32-byte Buffer.
   * @private
   * @param {*} key
   * @throws {CasError} INVALID_KEY_TYPE if key is not a Buffer
   * @throws {CasError} INVALID_KEY_LENGTH if key is not 32 bytes
   */
  _validateKey(key) {
    if (!Buffer.isBuffer(key)) {
      throw new CasError(
        'Encryption key must be a Buffer',
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
   * Encrypts a buffer using AES-256-GCM.
   */
  encrypt({ buffer, key }) {
    this._validateKey(key);
    return this.crypto.encryptBuffer(buffer, key);
  }

  /**
   * Decrypts a buffer.
   */
  decrypt({ buffer, key, meta }) {
    if (!meta?.encrypted) {
      return buffer;
    }
    try {
      return this.crypto.decryptBuffer(buffer, key, meta);
    } catch (err) {
      if (err instanceof CasError) throw err;
      throw new CasError('Decryption failed: Integrity check error', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /**
   * Chunks an async iterable source and stores it in Git.
   *
   * If `encryptionKey` is provided, the content (and manifest) will be encrypted
   * using AES-256-GCM, and the `encryption` field in the manifest will be populated.
   *
   * @param {Object} options
   * @param {AsyncIterable<Buffer>} options.source
   * @param {string} options.slug
   * @param {string} options.filename
   * @param {Buffer} [options.encryptionKey]
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   */
  async store({ source, slug, filename, encryptionKey }) {
    if (encryptionKey) {
      this._validateKey(encryptionKey);
    }

    const manifestData = {
      slug,
      filename,
      size: 0,
      chunks: [],
    };

    if (encryptionKey) {
      const { encrypt, finalize } = this.crypto.createEncryptionStream(encryptionKey);
      await this._chunkAndStore(encrypt(source), manifestData);
      manifestData.encryption = finalize();
    } else {
      await this._chunkAndStore(source, manifestData);
    }

    return new Manifest(manifestData);
  }

  /**
   * Creates a Git tree from a manifest.
   */
  async createTree({ manifest }) {
    const serializedManifest = this.codec.encode(manifest.toJSON());
    const manifestOid = await this.persistence.writeBlob(serializedManifest);

    const treeEntries = [
      `100644 blob ${manifestOid}\tmanifest.${this.codec.extension}`,
      ...manifest.chunks.map((c) => `100644 blob ${c.blob}\t${c.digest}`),
    ];

    return await this.persistence.writeTree(treeEntries);
  }

  /**
   * Restores a file from its manifest by reading and reassembling chunks.
   *
   * If the manifest has encryption metadata, decrypts the reassembled
   * ciphertext using the provided key.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {Buffer} [options.encryptionKey]
   * @returns {Promise<{ buffer: Buffer, bytesWritten: number }>}
   */
  async restore({ manifest, encryptionKey }) {
    if (encryptionKey) {
      this._validateKey(encryptionKey);
    }

    if (manifest.chunks.length === 0) {
      return { buffer: Buffer.alloc(0), bytesWritten: 0 };
    }

    const chunks = [];
    for (const chunk of manifest.chunks) {
      const blob = await this.persistence.readBlob(chunk.blob);
      const digest = this._sha256(blob);
      if (digest !== chunk.digest) {
        throw new CasError(
          `Chunk ${chunk.index} integrity check failed`,
          'INTEGRITY_ERROR',
          { chunkIndex: chunk.index, expected: chunk.digest, actual: digest },
        );
      }
      chunks.push(blob);
    }

    let buffer = Buffer.concat(chunks);

    if (manifest.encryption?.encrypted && encryptionKey) {
      buffer = this.decrypt({
        buffer,
        key: encryptionKey,
        meta: manifest.encryption,
      });
    }

    return { buffer, bytesWritten: buffer.length };
  }

  /**
   * Verifies the integrity of a stored file by re-hashing its chunks.
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {Promise<boolean>}
   */
  async verifyIntegrity(manifest) {
    for (const chunk of manifest.chunks) {
      const blob = await this.persistence.readBlob(chunk.blob);
      const digest = this._sha256(blob);
      if (digest !== chunk.digest) {
        return false;
      }
    }
    return true;
  }
}
