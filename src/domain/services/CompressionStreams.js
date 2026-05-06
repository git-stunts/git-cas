import CasError from '../errors/CasError.js';
import createCasError from '../errors/createCasError.js';
import { concatBytes } from '../bytes/ByteLayout.js';

/**
 * Domain compression stream boundary.
 */
export default class CompressionStreams {
  #adapter;

  /**
   * @param {import('../../ports/CompressionPort.js').default} adapter
   */
  constructor(adapter) {
    this.#adapter = adapter;
  }

  /**
   * @param {AsyncIterable<Uint8Array>} source
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *compress(source) {
    yield* this.#adapter.compressStream(source);
  }

  /**
   * @param {AsyncIterable<Uint8Array>} source
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *decompress(source) {
    try {
      for await (const chunk of this.#adapter.decompressStream(source)) {
        yield chunk;
      }
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw createCasError(`Decompression failed: ${message}`, 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /**
   * @param {Uint8Array} buffer
   * @param {number} limit
   * @returns {Promise<Uint8Array>}
   */
  async decompressBufferedWithLimit(buffer, limit) {
    const chunks = [];
    let total = 0;

    async function* source() {
      yield buffer;
    }

    for await (const chunk of this.decompress(source())) {
      total += chunk.length;
      if (total > limit) {
        throw createCasError(
          `Decompressed restore is ${total} bytes (limit: ${limit})`,
          'RESTORE_TOO_LARGE',
          { size: total, limit },
        );
      }
      chunks.push(chunk);
    }

    return concatBytes(chunks);
  }
}
