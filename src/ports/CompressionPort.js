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
   * @param {Buffer} _buffer - Data to compress.
   * @returns {Promise<Buffer>} Compressed data.
   */
  async compressBuffer(_buffer) {
    throw new Error('Not implemented');
  }

  /**
   * Decompresses a buffer.
   * @abstract
   * @param {Buffer} _buffer - Compressed data to decompress.
   * @returns {Promise<Buffer>} Decompressed data.
   */
  async decompressBuffer(_buffer) {
    throw new Error('Not implemented');
  }

  /**
   * Compresses an async byte stream.
   * @abstract
   * @param {AsyncIterable<Buffer>} _source - The input byte stream.
   * @yields {Buffer} Compressed chunks.
   * @returns {AsyncGenerator<Buffer>}
   */
  async *compressStream(_source) { // eslint-disable-line require-yield
    throw new Error('Not implemented');
  }

  /**
   * Decompresses an async byte stream.
   * @abstract
   * @param {AsyncIterable<Buffer>} _source - The compressed byte stream.
   * @yields {Buffer} Decompressed chunks.
   * @returns {AsyncGenerator<Buffer>}
   */
  async *decompressStream(_source) { // eslint-disable-line require-yield
    throw new Error('Not implemented');
  }
}
