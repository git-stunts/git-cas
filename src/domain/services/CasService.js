/* @ts-self-types="./CasService.d.ts" */
/**
 * @fileoverview Domain service for Content Addressable Storage operations.
 * @module
 */
import { gunzip, createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import Manifest from '../value-objects/Manifest.js';
import CasError from '../errors/CasError.js';
import Semaphore from './Semaphore.js';
import FixedChunker from '../../infrastructure/chunkers/FixedChunker.js';

const gunzipAsync = promisify(gunzip);

/**
 * Domain service for Content Addressable Storage operations.
 *
 * Provides chunking, encryption, and integrity verification for storing
 * arbitrary data in Git's object database.
 */
export default class CasService {
  /**
   * @param {Object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/CodecPort.js').default} options.codec
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   * @param {number} [options.chunkSize=262144] - 256 KiB
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {import('../../ports/ChunkingPort.js').default} [options.chunker] - Chunking strategy (default FixedChunker).
   */
  constructor({ persistence, codec, crypto, observability, chunkSize = 256 * 1024, merkleThreshold = 1000, concurrency = 1, chunker }) {
    CasService._validateObservability(observability);
    if (chunkSize < 1024) {
      throw new Error('Chunk size must be at least 1024 bytes');
    }
    this.persistence = persistence;
    this.codec = codec;
    this.crypto = crypto;
    this.observability = observability;
    this.chunkSize = chunkSize;
    /** @type {import('../../ports/ChunkingPort.js').default} */
    this.chunker = chunker || new FixedChunker({ chunkSize });
    if (!Number.isInteger(merkleThreshold) || merkleThreshold < 1) {
      throw new Error('Merkle threshold must be a positive integer');
    }
    this.merkleThreshold = merkleThreshold;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('Concurrency must be a positive integer');
    }
    this.concurrency = concurrency;
  }

  /**
   * Validates that observability implements ObservabilityPort.
   * @private
   * @param {*} observability
   */
  static _validateObservability(observability) {
    if (
      !observability ||
      typeof observability.metric !== 'function' ||
      typeof observability.log !== 'function' ||
      typeof observability.span !== 'function'
    ) {
      throw new Error('observability must implement ObservabilityPort');
    }
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
   * Stores a single buffer chunk in Git, returning its metadata.
   * @private
   * @param {Buffer} buf - The chunk data to store.
   * @param {number} index - Chunk index.
   * @returns {Promise<{ index: number, size: number, digest: string, blob: string }>}
   */
  async _storeChunk(buf, index) {
    const digest = await this._sha256(buf);
    const blob = await this.persistence.writeBlob(buf);
    this.observability.metric('chunk', { action: 'stored', index, size: buf.length, digest, blob });
    return { index, size: buf.length, digest, blob };
  }

  /**
   * Reads an async iterable source, splits it into chunks via the configured
   * chunker, and stores each chunk in Git.
   * @private
   * @param {AsyncIterable<Buffer>} source - The data source to chunk.
   * @param {Object} manifestData - Mutable manifest accumulator.
   * @throws {CasError} STREAM_ERROR if the source stream fails.
   */
  async _chunkAndStore(source, manifestData) {
    const sem = new Semaphore(this.concurrency);
    const pending = [];
    let nextIndex = 0;

    const launchWrite = (buf, idx) => {
      const p = sem.acquire().then(async () => {
        try {
          return await this._storeChunk(buf, idx);
        } finally {
          sem.release();
        }
      });
      pending.push(p);
    };

    try {
      for await (const chunk of this.chunker.chunk(source)) {
        launchWrite(chunk, nextIndex++);
      }
    } catch (err) {
      await Promise.allSettled(pending);
      if (err instanceof CasError) { throw err; }
      const casErr = new CasError(
        `Stream error during store: ${err.message}`,
        'STREAM_ERROR',
        { chunksDispatched: nextIndex, originalError: err },
      );
      await Promise.allSettled(pending);
      this.observability.metric('error', { code: casErr.code, message: casErr.message });
      throw casErr;
    }

    const results = await Promise.all(pending);
    results.sort((a, b) => a.index - b.index);
    for (const entry of results) {
      manifestData.chunks.push(entry);
      manifestData.size += entry.size;
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
   * Wraps an async iterable through gzip compression.
   * @private
   * @param {AsyncIterable<Buffer>} source
   * @returns {AsyncIterable<Buffer>}
   */
  async *_compressStream(source) {
    const gz = createGzip();
    const input = Readable.from(source);
    const compressed = input.pipe(gz);
    for await (const chunk of compressed) {
      yield chunk;
    }
  }

  /**
   * Wraps a DEK with a KEK using AES-256-GCM.
   * @private
   * @param {Buffer} dek - 32-byte data encryption key.
   * @param {Buffer} kek - 32-byte key encryption key.
   * @returns {{ wrappedDek: string, nonce: string, tag: string }}
   */
  _wrapDek(dek, kek) {
    const { buf, meta } = this.crypto.encryptBuffer(dek, kek);
    return {
      wrappedDek: buf.toString('base64'),
      nonce: meta.nonce,
      tag: meta.tag,
    };
  }

  /**
   * Unwraps a DEK from a recipient entry using the given KEK.
   * @private
   * @param {{ wrappedDek: string, nonce: string, tag: string }} recipientEntry
   * @param {Buffer} kek - 32-byte key encryption key.
   * @returns {Buffer} The unwrapped DEK.
   * @throws {CasError} DEK_UNWRAP_FAILED if decryption fails.
   */
  _unwrapDek(recipientEntry, kek) {
    try {
      const ciphertext = Buffer.from(recipientEntry.wrappedDek, 'base64');
      const meta = {
        algorithm: 'aes-256-gcm',
        nonce: recipientEntry.nonce,
        tag: recipientEntry.tag,
        encrypted: true,
      };
      return this.crypto.decryptBuffer(ciphertext, kek, meta);
    } catch (err) {
      if (err instanceof CasError && err.code === 'DEK_UNWRAP_FAILED') { throw err; }
      throw new CasError(
        'Failed to unwrap DEK: authentication failed',
        'DEK_UNWRAP_FAILED',
        { originalError: err },
      );
    }
  }

  /**
   * Resolves the decryption key from a manifest, handling both legacy and
   * envelope (multi-recipient) encrypted manifests.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Buffer} [encryptionKey]
   * @param {string} [passphrase]
   * @returns {Promise<Buffer|undefined>}
   */
  async _resolveDecryptionKey(manifest, encryptionKey, passphrase) {
    this._validateKeySourceExclusive(encryptionKey, passphrase);

    if (passphrase) {
      if (manifest.encryption?.kdf) {
        encryptionKey = await this._resolveKeyFromPassphrase(passphrase, manifest.encryption.kdf);
      } else {
        throw new CasError(
          'Manifest was not stored with passphrase-based encryption; provide encryptionKey instead',
          'MISSING_KEY',
        );
      }
    }

    if (!encryptionKey) {
      if (manifest.encryption?.encrypted) {
        throw new CasError('Encryption key required to restore encrypted content', 'MISSING_KEY');
      }
      return undefined;
    }

    this.crypto._validateKey(encryptionKey);

    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      // Legacy path — key is used directly
      return encryptionKey;
    }

    // Envelope path — try each recipient entry
    for (const entry of recipients) {
      try {
        return this._unwrapDek(entry, encryptionKey);
      } catch {
        // Not this recipient's KEK, try next
      }
    }

    throw new CasError(
      'No recipient entry could be unwrapped with the provided key',
      'NO_MATCHING_RECIPIENT',
    );
  }

  /**
   * Validates that passphrase and encryptionKey are not both provided.
   * @private
   */
  _validateKeySourceExclusive(encryptionKey, passphrase) {
    if (passphrase && encryptionKey) {
      throw new CasError(
        'Provide either encryptionKey or passphrase, not both',
        'INVALID_OPTIONS',
      );
    }
  }

  /**
   * Validates and normalizes compression options.
   * @private
   */
  _validateCompression(compression) {
    if (compression?.algorithm && compression.algorithm !== 'gzip') {
      throw new CasError(
        `Unsupported compression algorithm: ${compression.algorithm}`,
        'INVALID_OPTIONS',
      );
    }
  }

  /**
   * Validates that a chunking strategy is recognized.
   * @param {Object} [chunking] - Chunking options from a manifest.
   * @throws {CasError} INVALID_CHUNKING_STRATEGY if the strategy is unrecognized.
   * @private
   */
  _validateChunking(chunking) {
    if (!chunking) { return; }
    const validStrategies = ['fixed', 'cdc'];
    if (!validStrategies.includes(chunking.strategy)) {
      throw new CasError(
        `Unsupported chunking strategy: ${chunking.strategy}`,
        'INVALID_CHUNKING_STRATEGY',
        { strategy: chunking.strategy },
      );
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
   * @param {string} [options.passphrase] - Derive encryption key from passphrase instead.
   * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
   * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   */
  async store({ source, slug, filename, encryptionKey, passphrase, kdfOptions, compression, recipients }) {
    // Mutual exclusivity: recipients vs encryptionKey/passphrase
    if (recipients && (encryptionKey || passphrase)) {
      throw new CasError(
        'Provide recipients or encryptionKey/passphrase, not both',
        'INVALID_OPTIONS',
      );
    }

    this._validateKeySourceExclusive(encryptionKey, passphrase);
    this._validateCompression(compression);

    let kdfParams;
    let recipientEntries;
    let actualEncryptionKey;

    if (recipients) {
      // Envelope encryption: generate random DEK, wrap for each recipient
      for (const r of recipients) {
        this.crypto._validateKey(r.key);
      }
      const dek = this.crypto.randomBytes(32);
      recipientEntries = recipients.map((r) => ({
        label: r.label,
        ...this._wrapDek(dek, r.key),
      }));
      actualEncryptionKey = dek;
    } else {
      if (passphrase) {
        const derived = await this.deriveKey({ passphrase, ...kdfOptions });
        encryptionKey = derived.key;
        kdfParams = derived.params;
      }

      if (encryptionKey) {
        this.crypto._validateKey(encryptionKey);
      }
      actualEncryptionKey = encryptionKey;
    }

    const manifestData = { slug, filename, size: 0, chunks: [] };

    // Record chunking metadata for non-default strategies
    if (this.chunker.strategy !== 'fixed') {
      manifestData.chunking = {
        strategy: this.chunker.strategy,
        params: this.chunker.params,
      };
    }

    let processedSource = source;
    if (compression) {
      processedSource = this._compressStream(processedSource);
      manifestData.compression = { algorithm: 'gzip' };
    }

    if (actualEncryptionKey) {
      const { encrypt, finalize } = this.crypto.createEncryptionStream(actualEncryptionKey);
      await this._chunkAndStore(encrypt(processedSource), manifestData);
      const encMeta = finalize();
      if (kdfParams) {
        encMeta.kdf = kdfParams;
      }
      if (recipientEntries) {
        encMeta.recipients = recipientEntries;
      }
      manifestData.encryption = encMeta;
    } else {
      await this._chunkAndStore(processedSource, manifestData);
    }

    const manifest = new Manifest(manifestData);
    this.observability.metric('file', {
      action: 'stored', slug, size: manifest.size, chunkCount: manifest.chunks.length, encrypted: !!actualEncryptionKey,
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
    const chunks = manifest.chunks;

    if (chunks.length > this.merkleThreshold) {
      return await this._createMerkleTree({ manifest });
    }

    const serializedManifest = this.codec.encode(manifest.toJSON());
    const manifestOid = await this.persistence.writeBlob(serializedManifest);

    const treeEntries = [
      `100644 blob ${manifestOid}\tmanifest.${this.codec.extension}`,
      ...chunks.map((c) => `100644 blob ${c.blob}\t${c.digest}`),
    ];

    return await this.persistence.writeTree(treeEntries);
  }

  /**
   * Creates a Merkle tree by splitting chunks into sub-manifests.
   * @private
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @returns {Promise<string>} Git tree OID.
   */
  async _createMerkleTree({ manifest }) {
    const chunks = [...manifest.chunks];
    const subManifestRefs = [];
    const chunkBlobEntries = [];

    for (let i = 0; i < chunks.length; i += this.merkleThreshold) {
      const group = chunks.slice(i, i + this.merkleThreshold);
      const subManifestData = { chunks: group.map((c) => ({ index: c.index, size: c.size, digest: c.digest, blob: c.blob })) };
      const serialized = this.codec.encode(subManifestData);
      const oid = await this.persistence.writeBlob(serialized);

      subManifestRefs.push({
        oid,
        chunkCount: group.length,
        startIndex: i,
      });

      for (const c of group) {
        chunkBlobEntries.push(`100644 blob ${c.blob}\t${c.digest}`);
      }
    }

    const rootManifestData = {
      ...manifest.toJSON(),
      version: 2,
      chunks: [],
      subManifests: subManifestRefs,
    };

    const serializedRoot = this.codec.encode(rootManifestData);
    const rootOid = await this.persistence.writeBlob(serializedRoot);

    const subManifestEntries = subManifestRefs.map(
      (ref, idx) => `100644 blob ${ref.oid}\tsub-manifest-${idx}.${this.codec.extension}`,
    );

    const treeEntries = [
      `100644 blob ${rootOid}\tmanifest.${this.codec.extension}`,
      ...subManifestEntries,
      ...chunkBlobEntries,
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
        this.observability.metric('error', { code: err.code, message: err.message });
        throw err;
      }
      buffers.push(blob);
      this.observability.metric('chunk', { action: 'restored', index: chunk.index, size: blob.length, digest: chunk.digest });
    }
    return buffers;
  }

  /**
   * Resolves the encryption key from a passphrase using KDF params from the manifest.
   * @private
   * @param {string} passphrase
   * @param {Object} kdf - KDF params from manifest.encryption.kdf.
   * @returns {Promise<Buffer>}
   */
  async _resolveKeyFromPassphrase(passphrase, kdf) {
    const { key } = await this.deriveKey({
      passphrase,
      salt: Buffer.from(kdf.salt, 'base64'),
      algorithm: kdf.algorithm,
      iterations: kdf.iterations,
      cost: kdf.cost,
      blockSize: kdf.blockSize,
      parallelization: kdf.parallelization,
    });
    return key;
  }

  /**
   * Resolves the encryption key from passphrase or validates the provided key.
   * @private
   */
  async _resolveEncryptionKey(manifest, encryptionKey, passphrase) {
    this._validateKeySourceExclusive(encryptionKey, passphrase);

    if (passphrase) {
      if (manifest.encryption?.kdf) {
        return this._resolveKeyFromPassphrase(passphrase, manifest.encryption.kdf);
      }
      throw new CasError(
        'Manifest was not stored with passphrase-based encryption; provide encryptionKey instead',
        'MISSING_KEY',
      );
    }
    if (encryptionKey) {
      this.crypto._validateKey(encryptionKey);
    } else if (manifest.encryption?.encrypted) {
      throw new CasError('Encryption key required to restore encrypted content', 'MISSING_KEY');
    }
    return encryptionKey;
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
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @returns {Promise<{ buffer: Buffer, bytesWritten: number }>}
   * @throws {CasError} MISSING_KEY if manifest is encrypted but no key is provided.
   * @throws {CasError} INTEGRITY_ERROR if chunk verification or decryption fails.
   */
  async restore({ manifest, encryptionKey, passphrase }) {
    const chunks = [];
    for await (const chunk of this.restoreStream({ manifest, encryptionKey, passphrase })) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return { buffer, bytesWritten: buffer.length };
  }

  /**
   * Restores a file from its manifest as an async iterable of Buffer chunks.
   *
   * For unencrypted, uncompressed files this is true per-chunk streaming
   * with O(chunkSize) memory. For encrypted or compressed files, all chunks
   * are buffered internally for decryption/decompression, then yielded.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @param {Buffer} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * Note: For unencrypted files, each yielded buffer corresponds to an original
   * stored chunk. For encrypted/compressed files, yielded buffers are
   * chunkSize-sliced pieces of the decrypted/decompressed result and may not
   * correspond 1:1 to the original chunks.
   *
   * @yields {Buffer}
   * @throws {CasError} MISSING_KEY if manifest is encrypted but no key is provided.
   * @throws {CasError} INTEGRITY_ERROR if chunk verification or decryption fails.
   */
  async *restoreStream({ manifest, encryptionKey, passphrase }) {
    const key = await this._resolveDecryptionKey(manifest, encryptionKey, passphrase);

    if (manifest.chunks.length === 0) {
      this.observability.metric('file', {
        action: 'restored', slug: manifest.slug, size: 0, chunkCount: 0,
      });
      return;
    }

    if (manifest.encryption?.encrypted || manifest.compression) {
      yield* this._restoreBuffered(manifest, key);
    } else {
      yield* this._restoreStreaming(manifest);
    }
  }

  /**
   * Buffered restore path for encrypted/compressed manifests.
   * @private
   */
  async *_restoreBuffered(manifest, key) {
    let buffer = Buffer.concat(await this._readAndVerifyChunks(manifest.chunks));

    if (manifest.encryption?.encrypted) {
      buffer = await this.decrypt({ buffer, key, meta: manifest.encryption });
    }

    if (manifest.compression) {
      buffer = await this._decompress(buffer);
    }

    this.observability.metric('file', {
      action: 'restored', slug: manifest.slug, size: buffer.length, chunkCount: manifest.chunks.length,
    });

    for (let offset = 0; offset < buffer.length; offset += this.chunkSize) {
      yield buffer.subarray(offset, offset + this.chunkSize);
    }
  }

  /**
   * Per-chunk streaming restore with read-ahead.
   * @private
   */
  async *_restoreStreaming(manifest) {
    const chunks = manifest.chunks;
    const readAhead = this.concurrency;
    let totalSize = 0;

    const readAndVerify = async (chunk) => {
      const blob = await this.persistence.readBlob(chunk.blob);
      const digest = await this._sha256(blob);
      if (digest !== chunk.digest) {
        const err = new CasError(
          `Chunk ${chunk.index} integrity check failed`,
          'INTEGRITY_ERROR',
          { chunkIndex: chunk.index, expected: chunk.digest, actual: digest },
        );
        this.observability.metric('error', { code: err.code, message: err.message });
        throw err;
      }
      return blob;
    };

    const ahead = [];
    for (let i = 0; i < Math.min(readAhead, chunks.length); i++) {
      ahead.push(readAndVerify(chunks[i]));
    }

    try {
      for (let i = 0; i < chunks.length; i++) {
        const blob = await ahead[i % readAhead];
        this.observability.metric('chunk', { action: 'restored', index: chunks[i].index, size: blob.length, digest: chunks[i].digest });
        totalSize += blob.length;
        const nextIdx = i + readAhead;
        if (nextIdx < chunks.length) {
          ahead[i % readAhead] = readAndVerify(chunks[nextIdx]);
        }
        yield blob;
      }
    } finally {
      await Promise.allSettled(ahead);
    }

    this.observability.metric('file', {
      action: 'restored', slug: manifest.slug, size: totalSize, chunkCount: chunks.length,
    });
  }

  /**
   * Decompresses a gzip buffer.
   * @private
   */
  async _decompress(buffer) {
    try {
      return await gunzipAsync(buffer);
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(`Decompression failed: ${err.message}`, 'INTEGRITY_ERROR', { originalError: err });
    }
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

    if (decoded.version === 2 && decoded.subManifests?.length > 0) {
      decoded.chunks = await this._resolveSubManifests(decoded.subManifests, treeOid);
    }

    return new Manifest(decoded);
  }

  /**
   * Reads and flattens sub-manifest blobs into a single chunk array.
   * @private
   * @param {Array<{ oid: string }>} subManifests - Sub-manifest references.
   * @param {string} treeOid - Parent tree OID (for error context).
   * @returns {Promise<Array>} Flattened chunk entries.
   */
  async _resolveSubManifests(subManifests, treeOid) {
    const allChunks = [];
    for (const ref of subManifests) {
      const subBlob = await this._readSubManifestBlob(ref.oid, treeOid);
      const subDecoded = this.codec.decode(subBlob);
      allChunks.push(...subDecoded.chunks);
    }
    return allChunks;
  }

  /**
   * Reads a sub-manifest blob, wrapping errors as GIT_ERROR.
   * @private
   */
  async _readSubManifestBlob(oid, treeOid) {
    try {
      return await this.persistence.readBlob(oid);
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(
        `Failed to read sub-manifest blob ${oid}: ${err.message}`,
        'GIT_ERROR',
        { treeOid, subManifestOid: oid, originalError: err },
      );
    }
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
   * Derives an encryption key from a passphrase using PBKDF2 or scrypt.
   * @param {Object} options
   * @param {string} options.passphrase - The passphrase to derive a key from.
   * @param {Buffer} [options.salt] - Salt (random if omitted).
   * @param {'pbkdf2'|'scrypt'} [options.algorithm='pbkdf2'] - KDF algorithm.
   * @param {number} [options.iterations] - PBKDF2 iterations.
   * @param {number} [options.cost] - scrypt cost (N).
   * @param {number} [options.blockSize] - scrypt block size (r).
   * @param {number} [options.parallelization] - scrypt parallelization (p).
   * @param {number} [options.keyLength=32] - Derived key length.
   * @returns {Promise<{ key: Buffer, salt: Buffer, params: Object }>}
   */
  async deriveKey(options) {
    return await this.crypto.deriveKey(options);
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
        this.observability.metric('integrity', {
          action: 'fail', slug: manifest.slug, chunkIndex: chunk.index, expected: chunk.digest, actual: digest,
        });
        return false;
      }
    }
    this.observability.metric('integrity', { action: 'pass', slug: manifest.slug });
    return true;
  }
}
