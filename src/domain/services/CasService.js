import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import Manifest from '../value-objects/Manifest.js';
import JsonCodec from '../../infrastructure/codecs/JsonCodec.js';
import CasError from '../errors/CasError.js';

/**
 * Domain service for Content Addressable Storage operations.
 */
export default class CasService {
  /**
   * @param {Object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/CodecPort.js').default} [options.codec]
   * @param {number} [options.chunkSize=262144] - 256 KiB
   */
  constructor({ persistence, codec = new JsonCodec(), chunkSize = 256 * 1024 }) {
    if (chunkSize < 1024) {
      throw new Error('Chunk size must be at least 1024 bytes');
    }
    this.persistence = persistence;
    this.codec = codec;
    this.chunkSize = chunkSize;
  }

  /**
   * Generates a SHA-256 hash for a buffer.
   * @private
   */
  _sha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
  }

  /**
   * Helper to process a stream into chunks and store them.
   * @private
   * @param {Readable} stream
   * @param {Object} manifestData
   */
  async _chunkAndStore(stream, manifestData) {
    let buffer = Buffer.alloc(0);
    
    for await (const chunk of stream) {
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
   * Note: kept for small buffer convenience, but use storeFile for large files.
   */
  encrypt({ buffer, key }) {
    this._validateKey(key);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      buf: enc,
      meta: {
        algorithm: 'aes-256-gcm',
        nonce: nonce.toString('base64'),
        tag: tag.toString('base64'),
        encrypted: true,
      },
    };
  }

  /**
   * Decrypts a buffer.
   */
  decrypt({ buffer, key, meta }) {
    if (!meta?.encrypted) {
      return buffer;
    }
    const nonce = Buffer.from(meta.nonce, 'base64');
    const tag = Buffer.from(meta.tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    
    try {
      return Buffer.concat([decipher.update(buffer), decipher.final()]);
    } catch (err) {
      throw new CasError('Decryption failed: Integrity check error', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /**
   * Chunks a file and stores it in Git.
   * 
   * If `encryptionKey` is provided, the content (and manifest) will be encrypted
   * using AES-256-GCM, and the `encryption` field in the manifest will be populated.
   * 
   * @param {Object} options
   * @param {string} options.filePath
   * @param {string} options.slug
   * @param {string} options.filename
   * @param {Buffer} [options.encryptionKey]
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   */
  async storeFile({ filePath, slug, filename, encryptionKey }) {
    if (encryptionKey) {
      this._validateKey(encryptionKey);
    }

    const manifestData = {
      slug,
      filename: filename || filePath.split('/').pop(),
      size: 0,
      chunks: [],
    };

    const inputStream = createReadStream(filePath);

    if (encryptionKey) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
      
      // Pipe input through cipher
      const encryptedStream = inputStream.pipe(cipher);
      
      await this._chunkAndStore(encryptedStream, manifestData);
      
      // Get auth tag after stream ends
      const tag = cipher.getAuthTag();
      
      manifestData.encryption = {
        algorithm: 'aes-256-gcm',
        nonce: nonce.toString('base64'),
        tag: tag.toString('base64'),
        encrypted: true,
      };
    } else {
      await this._chunkAndStore(inputStream, manifestData);
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
