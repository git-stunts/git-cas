import CasError from '../errors/CasError.js';
import createCasError from '../errors/createCasError.js';
import { concatBytes } from '../bytes/ByteLayout.js';
import { buildWholeAad } from './Aad.js';
import { ErrorCodes } from '../errors/index.js';

/**
 * Restores whole-object encrypted content while preserving the auth boundary.
 *
 * @typedef {import('../value-objects/Manifest.js').default} Manifest
 */
export default class RestoreWhole {
  #chunkSize;
  #chunks;
  #compression;
  #crypto;
  #isLegacyNoAad;
  #maxRestoreBufferSize;
  #observability;

  /**
   * @param {Object} options
   * @param {number} options.chunkSize
   * @param {import('../services/ChunkRepository.js').default} options.chunks
   * @param {import('../services/CompressionStreams.js').default} options.compression
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {(manifest: Manifest) => boolean} options.isLegacyNoAad
   * @param {number} options.maxRestoreBufferSize
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   */
  constructor({ chunkSize, chunks, compression, crypto, isLegacyNoAad, maxRestoreBufferSize, observability }) {
    this.#chunkSize = chunkSize;
    this.#chunks = chunks;
    this.#compression = compression;
    this.#crypto = crypto;
    this.#isLegacyNoAad = isLegacyNoAad;
    this.#maxRestoreBufferSize = maxRestoreBufferSize;
    this.#observability = observability;
  }

  /**
   * @param {{ manifest: Manifest, key?: Uint8Array, encryptionMeta?: object }} options
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *execute({ manifest, key, encryptionMeta }) {
    const buffer = await this.#bufferRestore({ manifest, key, encryptionMeta });
    this.#observability.metric('file', {
      action: 'restored',
      slug: manifest.slug,
      size: buffer.length,
      chunkCount: manifest.chunks.length,
    });
    for (let offset = 0; offset < buffer.length; offset += this.#chunkSize) {
      yield buffer.subarray(offset, offset + this.#chunkSize);
    }
  }

  /**
   * @param {{ manifest: Manifest, key?: Uint8Array, encryptionMeta?: object }} options
   * @returns {Promise<AsyncIterable<Uint8Array>>}
   */
  async createBoundedSource({ manifest, key, encryptionMeta }) {
    let source = this.#chunks.iterVerifiedChunkBlobs(manifest);
    if (encryptionMeta) {
      if (manifest.compression) {
        const plaintext = await this.#decryptWhole({
          manifest,
          ciphertext: concatBytes(await this.#collect(source)),
          key,
          encryptionMeta,
        });
        source = (async function* plaintextSource() { yield plaintext; })();
      } else {
        source = this.#decryptWholeStream({ manifest, source, key, encryptionMeta });
      }
    }
    if (manifest.compression) {
      source = this.#compression.decompress(source);
    }
    return source;
  }

  async #bufferRestore({ manifest, key, encryptionMeta }) {
    const totalSize = manifest.chunks.reduce((acc, c) => acc + c.size, 0);
    if (totalSize > this.#maxRestoreBufferSize) {
      throw createCasError(
        `Encrypted/compressed restore would buffer ${totalSize} bytes ` +
        `(limit: ${this.#maxRestoreBufferSize}). Increase maxRestoreBufferSize ` +
        'or store without encryption.',
        ErrorCodes.RESTORE_TOO_LARGE,
        { size: totalSize, limit: this.#maxRestoreBufferSize },
      );
    }

    let buffer = concatBytes(await this.#chunks.readAndVerifyChunks(manifest.chunks, {
      totalLimit: this.#maxRestoreBufferSize,
    }));

    if (encryptionMeta) {
      buffer = await this.#decryptWhole({ manifest, ciphertext: buffer, key, encryptionMeta });
    }
    if (manifest.compression) {
      buffer = await this.#compression.decompressBufferedWithLimit(buffer, this.#maxRestoreBufferSize);
    }
    return buffer;
  }

  async #decryptWhole({ manifest, ciphertext, key, encryptionMeta }) {
    try {
      const aad = this.#isLegacyNoAad(manifest) ? undefined : buildWholeAad(manifest.slug);
      return await this.#crypto.decryptBuffer(ciphertext, key, encryptionMeta, aad);
    } catch (err) {
      if (err instanceof CasError && err.code === ErrorCodes.INTEGRITY_ERROR) {
        this.#observability.metric('error', { action: 'decryption_failed', slug: manifest.slug });
      }
      if (err instanceof CasError) {
        throw err;
      }
      throw createCasError('Decryption failed: Integrity check error', ErrorCodes.INTEGRITY_ERROR, { originalError: err });
    }
  }

  #decryptWholeStream({ manifest, source, key, encryptionMeta }) {
    const aad = this.#isLegacyNoAad(manifest) ? undefined : buildWholeAad(manifest.slug);
    return this.#crypto.createDecryptionStream(key, encryptionMeta, aad).decrypt(source);
  }

  async #collect(source) {
    const chunks = [];
    for await (const chunk of source) {
      chunks.push(chunk);
    }
    return chunks;
  }
}
