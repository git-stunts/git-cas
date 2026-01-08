import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import Manifest from '../value-objects/Manifest.js';

/**
 * Domain service for Content Addressable Storage operations.
 */
export default class CasService {
  /**
   * @param {Object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {number} [options.chunkSize=262144] - 256 KiB
   */
  constructor({ persistence, chunkSize = 256 * 1024 }) {
    this.persistence = persistence;
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
   * Encrypts a buffer using AES-256-GCM.
   */
  encrypt({ buffer, key }) {
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
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
  }

  /**
   * Chunks a file and stores it in Git.
   */
  async storeFile({ filePath, slug, filename, encryptionKey }) {
    const manifestData = {
      slug,
      filename: filename || filePath.split('/').pop(),
      size: 0,
      chunks: [],
    };

    if (encryptionKey) {
      const sourceBuf = readFileSync(filePath);
      const { buf, meta } = this.encrypt({ buffer: sourceBuf, key: encryptionKey });
      manifestData.encryption = meta;
      
      for (let i = 0; i < buf.length; i += this.chunkSize) {
        const chunkBuf = buf.slice(i, i + this.chunkSize);
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
    } else {
      const fd = createReadStream(filePath, { highWaterMark: this.chunkSize });
      for await (const chunkBuf of fd) {
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

    return new Manifest(manifestData);
  }

  /**
   * Creates a Git tree from a manifest.
   */
  async createTree({ manifest }) {
    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestOid = await this.persistence.writeBlob(manifestJson);

    const treeEntries = [
      `100644 blob ${manifestOid}\tmanifest.json`,
      ...manifest.chunks.map((c) => `100644 blob ${c.blob}\t${c.digest}`),
    ];
    
    return await this.persistence.writeTree(treeEntries);
  }
}
