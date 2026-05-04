/**
 * Abstract port for compression and decompression of buffers and streams.
 *
 * Implementations provide a specific compression algorithm (e.g. gzip)
 * and expose both buffer and streaming interfaces.
 *
 * @abstract
 */
export default class CompressionPort {
  constructor() {
    if (new.target === CompressionPort) {
      throw new Error('CompressionPort is abstract and cannot be instantiated directly');
    }
  }

  /**
   * Compresses a buffer.
   * @abstract
   * @param {Uint8Array} _buffer - Data to compress.
   * @returns {Promise<Uint8Array>} Compressed data.
   */
  async compressBuffer(_buffer) {
    throw new Error('Not implemented');
  }

  /**
   * Decompresses a buffer.
   * @abstract
   * @param {Uint8Array} _buffer - Compressed data to decompress.
   * @returns {Promise<Uint8Array>} Decompressed data.
   */
  async decompressBuffer(_buffer) {
    throw new Error('Not implemented');
  }

  /**
   * Compresses an async byte stream.
   * @abstract
   * @param {AsyncIterable<Uint8Array>} _source - The input byte stream.
   * @yields {Uint8Array} Compressed chunks.
   * @returns {AsyncGenerator<Uint8Array>}
   */
  async *compressStream(_source) { // eslint-disable-line require-yield
    throw new Error('Not implemented');
  }

  /**
   * Decompresses an async byte stream.
   * @abstract
   * @param {AsyncIterable<Uint8Array>} _source - The compressed byte stream.
   * @yields {Uint8Array} Decompressed chunks.
   * @returns {AsyncGenerator<Uint8Array>}
   */
  async *decompressStream(_source) { // eslint-disable-line require-yield
    throw new Error('Not implemented');
  }
}
