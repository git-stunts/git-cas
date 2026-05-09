import createCasError from '../errors/createCasError.js';
import GitPersistencePort from '../../ports/GitPersistencePort.js';
import StorePipeline from './StorePipeline.js';
import prefetchChunks from './PrefetchWindow.js';
import { concatBytes, normalizeByteChunk } from '../bytes/ByteLayout.js';
import Oid from '../value-objects/Oid.js';
import { ErrorCodes } from '../errors/index.js';

/** @typedef {import('../value-objects/Manifest.js').default} Manifest */

/**
 * Domain chunk I/O and digest verification boundary.
 */
export default class ChunkRepository {
  #chunker;
  #concurrency;
  #convergent;
  #hashBytes;
  #observability;
  #persistence;

  /**
   * @param {Object} options
   * @param {import('../../ports/ChunkingPort.js').default} options.chunker
   * @param {number} options.concurrency
   * @param {import('./ConvergentEncryption.js').default} options.convergent
   * @param {(buf: Uint8Array) => Promise<string>} options.hashBytes
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   */
  constructor({ chunker, concurrency, convergent, hashBytes, observability, persistence }) {
    this.#chunker = chunker;
    this.#concurrency = concurrency;
    this.#convergent = convergent;
    this.#hashBytes = hashBytes;
    this.#observability = observability;
    this.#persistence = persistence;
  }

  /**
   * @param {AsyncIterable<Uint8Array>} source
   * @param {{ chunks: Array, size: number }} manifestData
   * @param {{ convergentKey?: Uint8Array }} [options]
   */
  async chunkAndStore(source, manifestData, { convergentKey } = {}) {
    const pipeline = new StorePipeline({
      chunker: this.#chunker,
      concurrency: this.#concurrency,
      observability: this.#observability,
      storeChunk: (buf, index, key) => this.storeChunk(buf, index, key),
    });
    await pipeline.chunkAndStore(source, manifestData, { convergentKey });
  }

  /**
   * @param {Uint8Array} buf
   * @param {number} index
   * @param {Uint8Array} [convergentKey]
   * @returns {Promise<{ index: number, size: number, digest: string, blob: string }>}
   */
  async storeChunk(buf, index, convergentKey) {
    const digest = await this.#hashBytes(buf);
    const blobData = convergentKey
      ? await this.#convergent.encryptChunk(buf, convergentKey, digest)
      : buf;
    const blob = await this.#persistence.writeBlob(blobData);
    this.#observability.metric('chunk', { action: 'stored', index, size: buf.length, digest, blob });
    return { index, size: buf.length, digest, blob };
  }

  /**
   * @param {{ index: number, size: number, digest: string, blob: string }} chunk
   * @param {{ maxBytes?: number, convergentKey?: Uint8Array }} [options]
   * @returns {Promise<Uint8Array>}
   */
  async readAndVerifyChunk(chunk, { maxBytes, convergentKey } = {}) {
    const rawBlob = await this.readChunkBlob(chunk.blob, { maxBytes });

    if (convergentKey) {
      return this.#convergent.decryptAndVerifyChunk({
        blob: rawBlob,
        masterKey: convergentKey,
        expectedDigest: chunk.digest,
        chunkIndex: chunk.index,
      });
    }

    const digest = await this.#hashBytes(rawBlob);
    if (digest !== chunk.digest) {
      const err = createCasError(
        `Chunk ${chunk.index} integrity check failed`,
        ErrorCodes.INTEGRITY_ERROR,
        { chunkIndex: chunk.index, expected: chunk.digest, actual: digest },
      );
      this.#observability.metric('error', { code: err.code, message: err.message });
      throw err;
    }
    return rawBlob;
  }

  /**
   * @param {string} oid
   * @param {{ maxBytes?: number }} [options]
   * @returns {Promise<Uint8Array>}
   */
  async readChunkBlob(oid, { maxBytes } = {}) {
    const blobOid = Oid.from(oid).toString();
    if (!this.supportsReadBlobStream()) {
      if (maxBytes !== undefined) {
        throw createCasError(
          'Buffered restore safety requires persistence.readBlobStream() so ' +
          'encrypted/compressed restore can enforce maxRestoreBufferSize with ' +
          'memory-safe chunk reads. Implement readBlobStream() on the adapter ' +
          'or use a GitPersistenceAdapter-backed facade. See docs/EXTENDING.md#persistence-adapter-requirements.',
          ErrorCodes.PERSISTENCE_CAPABILITY_REQUIRED,
          {
            capability: 'readBlobStream',
            mode: 'buffered-restore',
            oid: blobOid,
            docs: 'docs/EXTENDING.md#persistence-adapter-requirements',
          },
        );
      }
      return normalizeByteChunk(await this.#persistence.readBlob(blobOid));
    }

    let total = 0;
    const chunks = [];
    for await (const chunk of await this.#persistence.readBlobStream(blobOid)) {
      const buf = normalizeByteChunk(chunk);
      total += buf.length;
      this.assertBufferedReadLimit({ size: total, limit: maxBytes, oid: blobOid });
      chunks.push(buf);
    }
    return concatBytes(chunks);
  }

  /**
   * @returns {boolean}
   */
  supportsReadBlobStream() {
    return typeof this.#persistence.readBlobStream === 'function'
      && this.#persistence.readBlobStream !== GitPersistencePort.prototype.readBlobStream;
  }

  /**
   * @param {Array<{ index: number, size: number, digest: string, blob: string }>} chunks
   * @param {{ totalLimit?: number }} [options]
   * @returns {Promise<Uint8Array[]>}
   */
  async readAndVerifyChunks(chunks, { totalLimit } = {}) {
    const buffers = [];
    let totalRead = 0;
    for (const chunk of chunks) {
      const blob = await this.readAndVerifyChunk(chunk, {
        maxBytes: this.bufferedChunkReadLimit({ totalLimit, totalRead, chunkSize: chunk.size }),
      });
      totalRead += blob.length;
      buffers.push(blob);
      this.#observability.metric('chunk', { action: 'restored', index: chunk.index, size: blob.length, digest: chunk.digest });
    }
    return buffers;
  }

  /**
   * @param {{ size: number, limit?: number, oid: string }} options
   */
  assertBufferedReadLimit({ size, limit, oid }) {
    if (limit === undefined || size <= limit) {
      return;
    }
    throw createCasError(
      `Buffered restore read ${size} bytes from blob ${oid} (limit: ${limit})`,
      ErrorCodes.RESTORE_TOO_LARGE,
      { size, limit, oid, reason: 'chunk-blob-size' },
    );
  }

  /**
   * @param {{ totalLimit?: number, totalRead: number, chunkSize: number }} options
   * @returns {number|undefined}
   */
  bufferedChunkReadLimit({ totalLimit, totalRead, chunkSize }) {
    if (totalLimit === undefined) {
      return chunkSize;
    }
    return Math.min(chunkSize, totalLimit - totalRead);
  }

  /**
   * @param {Manifest} manifest
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *iterVerifiedChunkBlobs(manifest) {
    const fetchFn = async (chunk) => {
      const blob = await this.readAndVerifyChunk(chunk);
      this.#observability.metric('chunk', { action: 'restored', index: chunk.index, size: blob.length, digest: chunk.digest });
      return blob;
    };

    if (this.#concurrency > 1) {
      yield* prefetchChunks(manifest.chunks, fetchFn, this.#concurrency);
      return;
    }
    for (const chunk of manifest.chunks) {
      yield await fetchFn(chunk);
    }
  }

  /**
   * @param {Manifest} manifest
   * @param {Uint8Array} key
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *iterConvergentChunks(manifest, key) {
    const fetchFn = async (chunk) => {
      const plaintext = await this.readAndVerifyChunk(chunk, { convergentKey: key });
      this.#observability.metric('chunk', { action: 'restored', index: chunk.index, size: plaintext.length, digest: chunk.digest });
      return plaintext;
    };

    if (this.#concurrency > 1) {
      yield* prefetchChunks(manifest.chunks, fetchFn, this.#concurrency);
      return;
    }
    for (const chunk of manifest.chunks) {
      yield await fetchFn(chunk);
    }
  }
}
