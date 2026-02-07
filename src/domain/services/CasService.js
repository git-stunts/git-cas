/* @ts-self-types="./CasService.d.ts" */
/**
 * @fileoverview Domain service for Content Addressable Storage operations.
 * @module
 */
import { EventEmitter } from 'node:events';
import Manifest from '../value-objects/Manifest.js';
import CasError from '../errors/CasError.js';

/**
 * Domain service for Content Addressable Storage operations.
 *
 * Provides chunking, encryption, and integrity verification for storing
 * arbitrary data in Git's object database. Extends {@link EventEmitter} to
 * emit progress events during store/restore operations.
 *
 * @fires CasService#chunk:stored
 * @fires CasService#chunk:restored
 * @fires CasService#file:stored
 * @fires CasService#file:restored
 * @fires CasService#integrity:pass
 * @fires CasService#integrity:fail
 * @fires CasService#error
 */
export default class CasService extends EventEmitter {
  /**
   * @param {Object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/CodecPort.js').default} options.codec
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {number} [options.chunkSize=262144] - 256 KiB
   */
  constructor({ persistence, codec, crypto, chunkSize = 256 * 1024 }) {
    super();
    if (chunkSize < 1024) {
      throw new Error('Chunk size must be at least 1024 bytes');
    }
    this.persistence = persistence;
    this.codec = codec;
    this.crypto = crypto;
    this.chunkSize = chunkSize;
  }

  /**
   * Generates a SHA-256 hex digest for a buffer.
   * @private
   * @param {Buffer} buf - Data to hash.
   * @returns {Promise<string>} 64-character hex digest.
   */
  async _sha256(buf) {
    return await this.crypto.sha256(buf);
  }

  /**
   * Stores a single buffer chunk in Git and appends its metadata to the manifest.
   * @private
   * @param {Buffer} buf - The chunk data to store.
   * @param {Object} manifestData - Mutable manifest accumulator.
   */
  async _storeChunk(buf, manifestData) {
    const digest = await this._sha256(buf);
    const blob = await this.persistence.writeBlob(buf);
    const entry = { index: manifestData.chunks.length, size: buf.length, digest, blob };
    manifestData.chunks.push(entry);
    manifestData.size += buf.length;
    this.emit('chunk:stored', { index: entry.index, size: entry.size, digest, blob });
  }

  /**
   * Reads an async iterable source, splits it into fixed-size chunks, and stores each in Git.
   * @private
   * @param {AsyncIterable<Buffer>} source - The data source to chunk.
   * @param {Object} manifestData - Mutable manifest accumulator.
   * @throws {CasError} STREAM_ERROR if the source stream fails.
   */
  async _chunkAndStore(source, manifestData) {
    let buffer = Buffer.alloc(0);

    try {
      for await (const chunk of source) {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= this.chunkSize) {
          await this._storeChunk(buffer.slice(0, this.chunkSize), manifestData);
          buffer = buffer.slice(this.chunkSize);
        }
      }
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      const casErr = new CasError(
        `Stream error during store: ${err.message}`,
        'STREAM_ERROR',
        { chunksWritten: manifestData.chunks.length, originalError: err },
      );
      if (this.listenerCount('error') > 0) {
        this.emit('error', { code: casErr.code, message: casErr.message });
      }
      throw casErr;
    }

    if (buffer.length > 0) {
      await this._storeChunk(buffer, manifestData);
    }
  }

  /**
   * Validates that an encryption key is a 32-byte Buffer or Uint8Array.
   * @private
   * @param {*} key
   * @throws {CasError} INVALID_KEY_TYPE if key is not a Buffer
   * @throws {CasError} INVALID_KEY_LENGTH if key is not 32 bytes
   */
  _validateKey(key) {
    if (!Buffer.isBuffer(key) && !(key instanceof Uint8Array)) {
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
   * Encrypts a buffer using AES-256-GCM.
   * @param {Object} options
   * @param {Buffer} options.buffer - Plaintext data to encrypt.
   * @param {Buffer} options.key - 32-byte encryption key.
   * @returns {Promise<{ buf: Buffer, meta: { algorithm: string, nonce: string, tag: string, encrypted: boolean } }>}
   * @throws {CasError} INVALID_KEY_TYPE | INVALID_KEY_LENGTH if the key is invalid.
   */
  async encrypt({ buffer, key }) {
    this._validateKey(key);
    return await this.crypto.encryptBuffer(buffer, key);
  }

  /**
   * Decrypts a buffer. Returns the buffer unchanged if `meta.encrypted` is falsy.
   * @param {Object} options
   * @param {Buffer} options.buffer - Ciphertext to decrypt.
   * @param {Buffer} options.key - 32-byte encryption key.
   * @param {{ encrypted: boolean, algorithm: string, nonce: string, tag: string }} options.meta - Encryption metadata from the manifest.
   * @returns {Promise<Buffer>} Decrypted plaintext.
   * @throws {CasError} INTEGRITY_ERROR if authentication tag verification fails.
   */
  async decrypt({ buffer, key, meta }) {
    if (!meta?.encrypted) {
      return buffer;
    }
    try {
      return await this.crypto.decryptBuffer(buffer, key, meta);
    } catch (err) {
      if (err instanceof CasError) {throw err;}
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

    const manifest = new Manifest(manifestData);
    this.emit('file:stored', {
      slug, size: manifest.size, chunkCount: manifest.chunks.length, encrypted: !!encryptionKey,
    });
    return manifest;
  }

  /**
   * Creates a Git tree object from a manifest.
   *
   * The tree contains the serialized manifest file and one blob entry per chunk,
   * keyed by its SHA-256 digest.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @returns {Promise<string>} Git OID of the created tree.
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
   * Reads chunk blobs from Git and verifies their SHA-256 digests.
   * @private
   * @param {import('../value-objects/Chunk.js').default[]} chunks - Chunk metadata from the manifest.
   * @returns {Promise<Buffer[]>} Verified chunk buffers in order.
   * @throws {CasError} INTEGRITY_ERROR if any chunk digest does not match.
   */
  async _readAndVerifyChunks(chunks) {
    const buffers = [];
    for (const chunk of chunks) {
      const blob = await this.persistence.readBlob(chunk.blob);
      const digest = await this._sha256(blob);
      if (digest !== chunk.digest) {
        const err = new CasError(
          `Chunk ${chunk.index} integrity check failed`,
          'INTEGRITY_ERROR',
          { chunkIndex: chunk.index, expected: chunk.digest, actual: digest },
        );
        if (this.listenerCount('error') > 0) {
          this.emit('error', { code: err.code, message: err.message });
        }
        throw err;
      }
      buffers.push(blob);
      this.emit('chunk:restored', { index: chunk.index, size: blob.length, digest: chunk.digest });
    }
    return buffers;
  }

  /**
   * Restores a file from its manifest by reading and reassembling chunks.
   *
   * If the manifest has encryption metadata, decrypts the reassembled
   * ciphertext using the provided key.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @param {Buffer} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @returns {Promise<{ buffer: Buffer, bytesWritten: number }>}
   * @throws {CasError} MISSING_KEY if manifest is encrypted but no key is provided.
   * @throws {CasError} INTEGRITY_ERROR if chunk verification or decryption fails.
   */
  async restore({ manifest, encryptionKey }) {
    if (encryptionKey) {
      this._validateKey(encryptionKey);
    }

    if (manifest.encryption?.encrypted && !encryptionKey) {
      throw new CasError(
        'Encryption key required to restore encrypted content',
        'MISSING_KEY',
      );
    }

    if (manifest.chunks.length === 0) {
      return { buffer: Buffer.alloc(0), bytesWritten: 0 };
    }

    const chunks = await this._readAndVerifyChunks(manifest.chunks);
    let buffer = Buffer.concat(chunks);

    if (manifest.encryption?.encrypted) {
      buffer = await this.decrypt({
        buffer,
        key: encryptionKey,
        meta: manifest.encryption,
      });
    }

    this.emit('file:restored', {
      slug: manifest.slug, size: buffer.length, chunkCount: manifest.chunks.length,
    });
    return { buffer, bytesWritten: buffer.length };
  }

  /**
   * Reads a manifest from a Git tree OID.
   *
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID to read the manifest from
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   * @throws {CasError} MANIFEST_NOT_FOUND if no manifest entry exists in the tree
   * @throws {CasError} GIT_ERROR if the underlying Git command fails
   */
  async readManifest({ treeOid }) {
    let entries;
    try {
      entries = await this.persistence.readTree(treeOid);
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(
        `Failed to read tree ${treeOid}: ${err.message}`,
        'GIT_ERROR',
        { treeOid, originalError: err },
      );
    }

    const manifestName = `manifest.${this.codec.extension}`;
    const manifestEntry = entries.find((e) => e.name === manifestName);

    if (!manifestEntry) {
      throw new CasError(
        `No manifest entry (${manifestName}) found in tree ${treeOid}`,
        'MANIFEST_NOT_FOUND',
        { treeOid, expectedName: manifestName },
      );
    }

    let blob;
    try {
      blob = await this.persistence.readBlob(manifestEntry.oid);
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(
        `Failed to read manifest blob ${manifestEntry.oid}: ${err.message}`,
        'GIT_ERROR',
        { treeOid, manifestOid: manifestEntry.oid, originalError: err },
      );
    }

    const decoded = this.codec.decode(blob);
    return new Manifest(decoded);
  }

  /**
   * Returns deletion metadata for an asset stored in a Git tree.
   * Does not perform any destructive Git operations.
   *
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID of the asset
   * @returns {Promise<{ chunksOrphaned: number, slug: string }>}
   * @throws {CasError} MANIFEST_NOT_FOUND if the tree has no manifest
   */
  async deleteAsset({ treeOid }) {
    const manifest = await this.readManifest({ treeOid });
    return {
      slug: manifest.slug,
      chunksOrphaned: manifest.chunks.length,
    };
  }

  /**
   * Aggregates referenced chunk blob OIDs across multiple stored assets.
   * Analysis only — does not delete or modify anything.
   *
   * @param {Object} options
   * @param {string[]} options.treeOids - Git tree OIDs to analyze
   * @returns {Promise<{ referenced: Set<string>, total: number }>}
   * @throws {CasError} MANIFEST_NOT_FOUND if any treeOid lacks a manifest
   */
  async findOrphanedChunks({ treeOids }) {
    const referenced = new Set();
    let total = 0;

    for (const treeOid of treeOids) {
      const manifest = await this.readManifest({ treeOid });
      for (const chunk of manifest.chunks) {
        referenced.add(chunk.blob);
        total += 1;
      }
    }

    return { referenced, total };
  }

  /**
   * Verifies the integrity of a stored file by re-hashing its chunks.
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {Promise<boolean>}
   */
  async verifyIntegrity(manifest) {
    for (const chunk of manifest.chunks) {
      const blob = await this.persistence.readBlob(chunk.blob);
      const digest = await this._sha256(blob);
      if (digest !== chunk.digest) {
        this.emit('integrity:fail', {
          slug: manifest.slug, chunkIndex: chunk.index, expected: chunk.digest, actual: digest,
        });
        return false;
      }
    }
    this.emit('integrity:pass', { slug: manifest.slug });
    return true;
  }
}
