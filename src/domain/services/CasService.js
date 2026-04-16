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
import KeyResolver from './KeyResolver.js';

const gunzipAsync = promisify(gunzip);

/**
 * Domain service for Content Addressable Storage operations.
 *
 * Provides chunking, encryption, and integrity verification for storing
 * arbitrary data in Git's object database.
 */
export default class CasService {
  /** @type {KeyResolver} */
  #keyResolver;

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
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max bytes for buffered restore (default 512 MiB).
   */
  constructor({ persistence, codec, crypto, observability, chunkSize = 256 * 1024, merkleThreshold = 1000, concurrency = 1, chunker, maxRestoreBufferSize = 512 * 1024 * 1024 }) {
    CasService._validateObservability(observability);
    CasService.#validateConstructorArgs({ chunkSize, merkleThreshold, concurrency, maxRestoreBufferSize });
    this.persistence = persistence;
    this.codec = codec;
    this.crypto = crypto;
    this.observability = observability;
    this.chunkSize = chunkSize;
    if (chunkSize > 10 * 1024 * 1024) {
      observability.log('warn', `Chunk size ${chunkSize} exceeds 10 MiB — consider a smaller value`, { chunkSize });
    }
    /** @type {import('../../ports/ChunkingPort.js').default} */
    this.chunker = chunker || new FixedChunker({ chunkSize });
    this.merkleThreshold = merkleThreshold;
    this.concurrency = concurrency;
    this.maxRestoreBufferSize = maxRestoreBufferSize;
    this.#keyResolver = new KeyResolver(crypto);
  }

  /**
   * Validates constructor numeric arguments.
   * @private
   */
  static #validateConstructorArgs({ chunkSize, merkleThreshold, concurrency, maxRestoreBufferSize }) {
    if (!Number.isInteger(chunkSize) || chunkSize < 1024) {
      throw new Error('Chunk size must be an integer >= 1024 bytes');
    }
    const MAX_CHUNK_SIZE = 100 * 1024 * 1024;
    if (chunkSize > MAX_CHUNK_SIZE) {
      throw new Error(`Chunk size must not exceed ${MAX_CHUNK_SIZE} bytes (100 MiB)`);
    }
    if (!Number.isInteger(merkleThreshold) || merkleThreshold < 1) {
      throw new Error('Merkle threshold must be a positive integer');
    }
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('Concurrency must be a positive integer');
    }
    if (!Number.isInteger(maxRestoreBufferSize) || maxRestoreBufferSize < 1024) {
      throw new Error('maxRestoreBufferSize must be a positive integer >= 1024');
    }
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
    const iterator = this.chunker.chunk(source)[Symbol.asyncIterator]();
    const results = [];
    const inFlight = new Set();
    const orphanedBlobs = [];
    const state = { nextIndex: 0, writeError: null };

    while (true) {
      // Acquire capacity before pulling the next chunk so slow writes apply
      // backpressure all the way to the upstream source iterator.
      await sem.acquire();

      if (state.writeError) {
        sem.release();
        await this._closeAsyncIterator(iterator);
        break;
      }

      const step = await this._readNextStoreChunk({
        iterator, sem, inFlight, orphanedBlobs, nextIndex: state.nextIndex,
      });

      if (step.done) {
        sem.release();
        break;
      }

      this._launchChunkWrite({
        buf: step.value, idx: state.nextIndex++, sem, results, orphanedBlobs, inFlight, state,
      });
    }

    await this._awaitChunkWrites({ inFlight, state });
    this._appendChunkEntries(manifestData, results);
  }

  /**
   * Starts one bounded chunk write and tracks its lifecycle.
   * @private
   */
  _launchChunkWrite({ buf, idx, sem, results, orphanedBlobs, inFlight, state }) {
    const task = (async () => {
      try {
        const entry = await this._storeChunk(buf, idx);
        results[idx] = entry;
        orphanedBlobs.push(entry.blob);
      } finally {
        sem.release();
      }
    })().catch((err) => {
      state.writeError ??= err;
      throw err;
    });

    inFlight.add(task);
    task.then(
      () => inFlight.delete(task),
      () => inFlight.delete(task),
    );
  }

  /**
   * Reads the next chunk step and wraps source failures as STREAM_ERROR.
   * @private
   */
  async _readNextStoreChunk({ iterator, sem, inFlight, orphanedBlobs, nextIndex }) {
    try {
      return await iterator.next();
    } catch (err) {
      sem.release();
      await Promise.allSettled(inFlight);
      await this._closeAsyncIterator(iterator);
      throw this._buildStoreStreamError(err, nextIndex, orphanedBlobs);
    }
  }

  /**
   * Finalizes in-flight writes and rethrows the first write failure, if any.
   * @private
   */
  async _awaitChunkWrites({ inFlight, state }) {
    const settled = await Promise.allSettled(inFlight);
    if (state.writeError) {
      throw state.writeError;
    }
    for (const result of settled) {
      if (result.status !== 'fulfilled') {
        throw result.reason;
      }
    }
  }

  /**
   * Appends chunk entries to the manifest accumulator in index order.
   * @private
   */
  _appendChunkEntries(manifestData, results) {
    for (const entry of results) {
      manifestData.chunks.push(entry);
      manifestData.size += entry.size;
    }
  }

  /**
   * Closes an async iterator if it supports early termination.
   * @private
   */
  async _closeAsyncIterator(iterator) {
    if (typeof iterator.return !== 'function') {
      return;
    }
    try {
      await iterator.return();
    } catch {
      // Prefer surfacing the original store failure.
    }
  }

  /**
   * Normalizes store-stream failures and annotates them with orphaned blobs.
   * @private
   */
  _buildStoreStreamError(err, nextIndex, orphanedBlobs) {
    if (err instanceof CasError) {
      err.meta = { ...err.meta, orphanedBlobs };
      return err;
    }

    const casErr = new CasError(
      `Stream error during store: ${err.message}`,
      'STREAM_ERROR',
      { chunksDispatched: nextIndex, orphanedBlobs, originalError: err },
    );
    this.observability.metric('error', {
      code: casErr.code, message: casErr.message,
      orphanedBlobs: orphanedBlobs.length,
    });
    return casErr;
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
   * Treats manifest encryption metadata as security-critical when present.
   * @private
   * @param {{ slug?: string, encryption?: { encrypted?: boolean, algorithm?: string } }} manifest
   * @returns {undefined|{ encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }}
   * @throws {CasError} INTEGRITY_ERROR if encryption metadata was downgraded or tampered.
   */
  _validatedEncryptionMeta(manifest) {
    const meta = manifest.encryption;
    if (!meta) {
      return undefined;
    }
    if (meta.encrypted !== true) {
      throw new CasError(
        'Encrypted manifest metadata was downgraded or is invalid',
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-downgrade' },
      );
    }
    if (meta.algorithm !== 'aes-256-gcm') {
      throw new CasError(
        `Encrypted manifest uses unexpected algorithm: ${meta.algorithm}`,
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-algorithm', algorithm: meta.algorithm },
      );
    }
    return /** @type {{ encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }} */ (meta);
  }

  /**
   * Emits a normalized integrity failure event/metric.
   * @private
   * @param {{ slug?: string }} manifest
   * @param {Record<string, unknown>} [extra]
   */
  _emitIntegrityFail(manifest, extra = {}) {
    this.observability.metric('integrity', {
      action: 'fail',
      slug: manifest.slug,
      ...extra,
    });
  }

  /**
   * Validates encryption metadata for verifyIntegrity(), returning false on
   * integrity-style manifest failures without throwing.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {false|undefined|{ encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }}
   */
  _getVerifyEncryptionMeta(manifest) {
    try {
      return this._validatedEncryptionMeta(manifest);
    } catch (err) {
      if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
        this._emitIntegrityFail(manifest, err.meta);
        return false;
      }
      throw err;
    }
  }

  /**
   * Verifies chunk digests and collects buffers for any later auth step.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {Promise<false|Buffer[]>}
   */
  async _verifyChunkDigests(manifest) {
    const buffers = [];
    for (const chunk of manifest.chunks) {
      const blob = await this._readChunkBlob(chunk.blob);
      const digest = await this._sha256(blob);
      if (digest !== chunk.digest) {
        this._emitIntegrityFail(manifest, {
          chunkIndex: chunk.index,
          expected: chunk.digest,
          actual: digest,
        });
        return false;
      }
      buffers.push(blob);
    }
    return buffers;
  }

  /**
   * Resolves a verification key for encrypted content without throwing on
   * auth-style failures.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {{ encryptionKey?: Buffer, passphrase?: string }} options
   * @returns {Promise<false|Buffer>}
   */
  async _resolveVerifyKey(manifest, options) {
    try {
      return await this.#keyResolver.resolveForDecryption(
        manifest,
        options.encryptionKey,
        options.passphrase,
      );
    } catch (err) {
      if (err instanceof CasError && ['MISSING_KEY', 'NO_MATCHING_RECIPIENT', 'DEK_UNWRAP_FAILED'].includes(err.code)) {
        this._emitIntegrityFail(manifest, { reason: 'auth', code: err.code });
        return false;
      }
      throw err;
    }
  }

  /**
   * Authenticates encrypted content during verifyIntegrity().
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {{ encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }} encryptionMeta
   * @param {Buffer} key
   * @param {Buffer[]} buffers
   * @returns {Promise<boolean>}
   */
  async _verifyEncryptedAuth({ manifest, encryptionMeta, key, buffers }) {
    try {
      await this.decrypt({
        buffer: Buffer.concat(buffers),
        key,
        meta: encryptionMeta,
      });
      return true;
    } catch (err) {
      if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
        this._emitIntegrityFail(manifest, { reason: 'auth', code: err.code });
        return false;
      }
      throw err;
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
   * Supports two encryption modes: direct key/passphrase or envelope encryption
   * via `recipients` (DEK/KEK model). The modes are mutually exclusive.
   *
   * @param {Object} options
   * @param {AsyncIterable<Buffer>} options.source
   * @param {string} options.slug
   * @param {string} options.filename
   * @param {Buffer} [options.encryptionKey]
   * @param {string} [options.passphrase] - Derive encryption key from passphrase instead.
   * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
   * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
   * @param {Array<{label: string, key: Buffer}>} [options.recipients] - Envelope recipients (mutually exclusive with encryptionKey/passphrase).
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   */
  async store({ source, slug, filename, encryptionKey, passphrase, kdfOptions, compression, recipients }) {
    if (recipients && (encryptionKey || passphrase)) {
      throw new CasError('Provide recipients or encryptionKey/passphrase, not both', 'INVALID_OPTIONS');
    }
    KeyResolver.validateKeySourceExclusive(encryptionKey, passphrase);
    this._validateCompression(compression);

    const keyInfo = recipients
      ? await this.#keyResolver.resolveRecipients(recipients)
      : await this.#keyResolver.resolveForStore(encryptionKey, passphrase, kdfOptions);

    const manifestData = this._buildManifestData(slug, filename, compression);
    const processedSource = compression ? this._compressStream(source) : source;

    if (keyInfo.key && this.chunker.strategy === 'cdc') {
      this.observability.log(
        'warn',
        'CDC deduplication is ineffective with encryption — ciphertext is pseudorandom',
        { strategy: 'cdc' },
      );
    }
    if (keyInfo.key) {
      const { encrypt, finalize } = this.crypto.createEncryptionStream(keyInfo.key);
      await this._chunkAndStore(encrypt(processedSource), manifestData);
      manifestData.encryption = { ...finalize(), ...keyInfo.encExtra };
    } else {
      await this._chunkAndStore(processedSource, manifestData);
    }

    const manifest = new Manifest(manifestData);
    this.observability.metric('file', {
      action: 'stored', slug, size: manifest.size, chunkCount: manifest.chunks.length, encrypted: !!keyInfo.key,
    });
    return manifest;
  }

  /**
   * Builds initial manifest data with optional chunking and compression metadata.
   * @private
   */
  _buildManifestData(slug, filename, compression) {
    const data = { slug, filename, size: 0, chunks: [] };
    if (this.chunker.strategy !== 'fixed') {
      data.chunking = { strategy: this.chunker.strategy, params: this.chunker.params };
    }
    if (compression) { data.compression = { algorithm: 'gzip' }; }
    return data;
  }

  /**
   * Builds unique chunk blob tree entries in first-seen order.
   *
   * Tree entries keep chunk blobs reachable in Git. The manifest remains the
   * authoritative ordered list of chunk occurrences, so repeated digests only
   * need one tree entry.
   *
   * @private
   * @param {import('../value-objects/Chunk.js').default[]} chunks
   * @returns {string[]}
   */
  _createChunkTreeEntries(chunks) {
    const treeEntries = [];
    const seenDigests = new Set();

    for (const chunk of chunks) {
      if (seenDigests.has(chunk.digest)) {
        continue;
      }
      seenDigests.add(chunk.digest);
      treeEntries.push(`100644 blob ${chunk.blob}\t${chunk.digest}`);
    }

    return treeEntries;
  }

  /**
   * Creates a Git tree object from a manifest.
   *
   * The tree contains the serialized manifest file and one blob entry per
   * unique chunk digest, preserving first-seen order.
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
      ...this._createChunkTreeEntries(chunks),
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
      ...this._createChunkTreeEntries(chunks),
    ];

    return await this.persistence.writeTree(treeEntries);
  }

  /**
   * Reads a single chunk blob from Git and verifies its SHA-256 digest.
   * @private
   * @param {{ index: number, size: number, digest: string, blob: string }} chunk - Chunk metadata.
   * @returns {Promise<Buffer>} Verified chunk buffer.
   * @throws {CasError} INTEGRITY_ERROR if the chunk digest does not match.
   */
  async _readAndVerifyChunk(chunk) {
    const blob = await this._readChunkBlob(chunk.blob);
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
  }

  /**
   * Reads a chunk blob, preferring stream-native reads when supported.
   * Falls back to readBlob() for compatibility with older adapters and mocks.
   *
   * @private
   * @param {string} oid - Chunk blob OID.
   * @returns {Promise<Buffer>}
   */
  async _readChunkBlob(oid) {
    if (typeof this.persistence.readBlobStream !== 'function') {
      return await this.persistence.readBlob(oid);
    }
    const chunks = [];
    for await (const chunk of await this.persistence.readBlobStream(oid)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
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
      const blob = await this._readAndVerifyChunk(chunk);
      buffers.push(blob);
      this.observability.metric('chunk', { action: 'restored', index: chunk.index, size: blob.length, digest: chunk.digest });
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
    const encryptionMeta = this._validatedEncryptionMeta(manifest);
    const key = await this.#keyResolver.resolveForDecryption(manifest, encryptionKey, passphrase);

    if (manifest.chunks.length === 0) {
      this.observability.metric('file', {
        action: 'restored', slug: manifest.slug, size: 0, chunkCount: 0,
      });
      return;
    }

    if (encryptionMeta || manifest.compression) {
      yield* this._restoreBuffered(manifest, key, encryptionMeta);
    } else {
      yield* this._restoreStreaming(manifest);
    }
  }

  /**
   * Buffered restore path for encrypted/compressed manifests.
   * @private
   */
  async *_restoreBuffered(manifest, key, encryptionMeta = this._validatedEncryptionMeta(manifest)) {
    const totalSize = manifest.chunks.reduce((acc, c) => acc + c.size, 0);
    if (totalSize > this.maxRestoreBufferSize) {
      throw new CasError(
        `Encrypted/compressed restore would buffer ${totalSize} bytes ` +
        `(limit: ${this.maxRestoreBufferSize}). Increase maxRestoreBufferSize ` +
        'or store without encryption.',
        'RESTORE_TOO_LARGE',
        { size: totalSize, limit: this.maxRestoreBufferSize },
      );
    }
    let buffer = Buffer.concat(await this._readAndVerifyChunks(manifest.chunks));

    if (encryptionMeta) {
      try {
        buffer = await this.decrypt({ buffer, key, meta: encryptionMeta });
      } catch (err) {
        if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
          this.observability.metric('error', { action: 'decryption_failed', slug: manifest.slug });
        }
        throw err;
      }
    }

    if (manifest.compression) {
      buffer = await this._decompress(buffer);
      if (buffer.length > this.maxRestoreBufferSize) {
        throw new CasError(
          `Decompressed restore is ${buffer.length} bytes (limit: ${this.maxRestoreBufferSize})`,
          'RESTORE_TOO_LARGE',
          { size: buffer.length, limit: this.maxRestoreBufferSize },
        );
      }
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

    const readAndVerify = (chunk) => this._readAndVerifyChunk(chunk);

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
   * Reads a manifest from a Git tree and returns inspection metadata.
   * Does not perform any destructive Git operations.
   *
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID of the asset
   * @returns {Promise<{ chunksOrphaned: number, slug: string }>}
   * @throws {CasError} MANIFEST_NOT_FOUND if the tree has no manifest
   */
  async inspectAsset({ treeOid }) {
    const manifest = await this.readManifest({ treeOid });
    return {
      slug: manifest.slug,
      chunksOrphaned: manifest.chunks.length,
    };
  }

  /**
   * @deprecated Use {@link inspectAsset} instead.
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID of the asset
   * @returns {Promise<{ chunksOrphaned: number, slug: string }>}
   */
  async deleteAsset(options) {
    this.observability.log('warn', 'deleteAsset() is deprecated — use inspectAsset()');
    return await this.inspectAsset(options);
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
  async collectReferencedChunks({ treeOids }) {
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
   * @deprecated Use {@link collectReferencedChunks} instead.
   * @param {Object} options
   * @param {string[]} options.treeOids - Git tree OIDs to analyze
   * @returns {Promise<{ referenced: Set<string>, total: number }>}
   */
  async findOrphanedChunks(options) {
    this.observability.log('warn', 'findOrphanedChunks() is deprecated — use collectReferencedChunks()');
    return await this.collectReferencedChunks(options);
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
   * Adds a new recipient to an envelope-encrypted manifest.
   *
   * Unwraps the DEK using `existingKey`, wraps it with `newRecipientKey`,
   * and returns a new Manifest with the appended recipient entry.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {Buffer} options.existingKey - KEK of an existing recipient.
   * @param {Buffer} options.newRecipientKey - KEK for the new recipient.
   * @param {string} options.label - Label for the new recipient.
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   * @throws {CasError} INVALID_OPTIONS if manifest has no recipients.
   * @throws {CasError} RECIPIENT_ALREADY_EXISTS if label is a duplicate.
   * @throws {CasError} DEK_UNWRAP_FAILED if existingKey doesn't match any recipient.
   */
  async addRecipient({ manifest, existingKey, newRecipientKey, label }) {
    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      throw new CasError(
        'Manifest does not use envelope encryption (no recipients)',
        'INVALID_OPTIONS',
      );
    }

    if (recipients.some((r) => r.label === label)) {
      throw new CasError(
        `Recipient "${label}" already exists`,
        'RECIPIENT_ALREADY_EXISTS',
        { label },
      );
    }

    this.crypto._validateKey(existingKey);
    this.crypto._validateKey(newRecipientKey);

    // Unwrap DEK using the existing key
    let dek;
    try {
      dek = await this.#keyResolver.resolveKeyForRecipients(manifest, existingKey);
    } catch (err) {
      if (err instanceof CasError && err.code === 'NO_MATCHING_RECIPIENT') {
        throw new CasError('Failed to unwrap DEK: authentication failed', 'DEK_UNWRAP_FAILED', { originalError: err });
      }
      throw err;
    }

    // Wrap DEK for the new recipient
    const newEntry = { label, ...(await this.#keyResolver.wrapDek(dek, newRecipientKey)) };

    const json = manifest.toJSON();
    const updatedEncryption = {
      ...json.encryption,
      recipients: [...recipients.map((r) => ({ ...r })), newEntry],
    };

    return new Manifest({ ...json, encryption: updatedEncryption });
  }

  /**
   * Removes a recipient from an envelope-encrypted manifest.
   *
   * Returns a new Manifest with the recipient entry removed. Does not
   * require a key — this is a manifest-only mutation.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {string} options.label - Label of the recipient to remove.
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   * @throws {CasError} RECIPIENT_NOT_FOUND if label doesn't exist.
   * @throws {CasError} CANNOT_REMOVE_LAST_RECIPIENT if only one recipient remains.
   */
  async removeRecipient({ manifest, label }) {
    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      throw new CasError(
        'Manifest does not use envelope encryption (no recipients)',
        'INVALID_OPTIONS',
      );
    }
    if (!recipients.some((r) => r.label === label)) {
      throw new CasError(
        `Recipient "${label}" not found`,
        'RECIPIENT_NOT_FOUND',
        { label },
      );
    }

    if (recipients.length === 1) {
      throw new CasError(
        'Cannot remove the last recipient',
        'CANNOT_REMOVE_LAST_RECIPIENT',
      );
    }

    const filtered = recipients.filter((r) => r.label !== label).map((r) => ({ ...r }));
    if (filtered.length === 0) {
      throw new CasError(
        'Cannot remove the last recipient',
        'CANNOT_REMOVE_LAST_RECIPIENT',
      );
    }
    const json = manifest.toJSON();
    const updatedEncryption = { ...json.encryption, recipients: filtered };

    return new Manifest({ ...json, encryption: updatedEncryption });
  }

  /**
   * Lists recipient labels from an envelope-encrypted manifest.
   *
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {string[]} Recipient labels, or empty array if not envelope-encrypted.
   */
  listRecipients(manifest) {
    return (manifest.encryption?.recipients || []).map((r) => r.label);
  }

  /**
   * Rotates a recipient's key without re-encrypting data blobs.
   *
   * Re-wraps the DEK with `newKey` for the matched recipient entry.
   * Increments `keyVersion` at both manifest-level and recipient-level.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {Buffer} options.oldKey - Current KEK of the recipient to rotate.
   * @param {Buffer} options.newKey - New KEK to wrap the DEK with.
   * @param {string} [options.label] - If provided, only rotate the named recipient.
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   * @throws {CasError} ROTATION_NOT_SUPPORTED if manifest has no recipients.
   * @throws {CasError} RECIPIENT_NOT_FOUND if label doesn't exist.
   * @throws {CasError} DEK_UNWRAP_FAILED if oldKey doesn't match the recipient.
   * @throws {CasError} NO_MATCHING_RECIPIENT if no label and oldKey matches no entry.
   */
  async rotateKey({ manifest, oldKey, newKey, label }) {
    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      throw new CasError(
        'Key rotation requires envelope encryption (recipients)',
        'ROTATION_NOT_SUPPORTED',
      );
    }

    this.crypto._validateKey(oldKey);
    this.crypto._validateKey(newKey);

    const { matchIndex, dek } = label
      ? await this.#findRecipientByLabel(recipients, label, oldKey)
      : await this.#findRecipientByKey(recipients, oldKey);

    return this.#buildRotatedManifest({ manifest, recipients, matchIndex, dek, newKey });
  }

  /**
   * Finds a recipient by label and unwraps the DEK.
   */
  async #findRecipientByLabel(recipients, label, oldKey) {
    const matchIndex = recipients.findIndex((r) => r.label === label);
    if (matchIndex === -1) {
      throw new CasError(`Recipient "${label}" not found`, 'RECIPIENT_NOT_FOUND', { label });
    }
    const dek = await this.#keyResolver.unwrapDek(recipients[matchIndex], oldKey);
    return { matchIndex, dek };
  }

  /**
   * Finds the first recipient whose DEK can be unwrapped with the given key.
   */
  async #findRecipientByKey(recipients, oldKey) {
    for (let i = 0; i < recipients.length; i++) {
      try {
        const dek = await this.#keyResolver.unwrapDek(recipients[i], oldKey);
        return { matchIndex: i, dek };
      } catch (err) {
        if (!(err instanceof CasError && err.code === 'DEK_UNWRAP_FAILED')) { throw err; }
      }
    }
    throw new CasError(
      'No recipient entry could be unwrapped with the provided key',
      'NO_MATCHING_RECIPIENT',
    );
  }

  /**
   * Builds a new Manifest with the rotated recipient entry and updated keyVersions.
   */
  async #buildRotatedManifest({ manifest, recipients, matchIndex, dek, newKey }) {
    const newWrapped = await this.#keyResolver.wrapDek(dek, newKey);
    const manifestKeyVersion = (manifest.encryption.keyVersion || 0) + 1;
    const recipientKeyVersion = (recipients[matchIndex].keyVersion || 0) + 1;

    const json = manifest.toJSON();
    const updatedRecipients = recipients.map((r, i) => {
      if (i === matchIndex) {
        return { ...r, ...newWrapped, keyVersion: recipientKeyVersion };
      }
      return { ...r };
    });

    return new Manifest({
      ...json,
      encryption: { ...json.encryption, recipients: updatedRecipients, keyVersion: manifestKeyVersion },
    });
  }

  /**
   * Verifies the integrity of a stored file by re-hashing its chunks.
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {{ encryptionKey?: Buffer, passphrase?: string }} [options]
   * @returns {Promise<boolean>}
   */
  async verifyIntegrity(manifest, options = {}) {
    const encryptionMeta = this._getVerifyEncryptionMeta(manifest);
    if (encryptionMeta === false) {
      return false;
    }

    const buffers = await this._verifyChunkDigests(manifest);
    if (buffers === false) {
      return false;
    }

    if (encryptionMeta) {
      const key = await this._resolveVerifyKey(manifest, options);
      if (key === false) {
        return false;
      }
      const authOk = await this._verifyEncryptedAuth({ manifest, encryptionMeta, key, buffers });
      if (!authOk) {
        return false;
      }
    }

    this.observability.metric('integrity', { action: 'pass', slug: manifest.slug });
    return true;
  }
}
