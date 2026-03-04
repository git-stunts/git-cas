import ChunkingPort from '../../ports/ChunkingPort.js';

/**
 * {@link ChunkingPort} implementation that splits data into fixed-size chunks.
 *
 * Buffers incoming data and yields exactly {@link chunkSize} byte chunks.
 * The final chunk may be smaller than {@link chunkSize} if the source does
 * not divide evenly. An empty source produces no chunks.
 */
export default class FixedChunker extends ChunkingPort {
  /** @type {number} */
  #chunkSize;

  /**
   * @param {Object} [options]
   * @param {number} [options.chunkSize=262144] - Chunk size in bytes (default 256 KiB).
   */
  constructor({ chunkSize = 262144 } = {}) {
    super();
    if (chunkSize > 100 * 1024 * 1024) {
      throw new RangeError(
        `Chunk size must not exceed 104857600 bytes (100 MiB), got ${chunkSize}`,
      );
    }
    this.#chunkSize = chunkSize;
  }

  /** @override */
  get strategy() {
    return 'fixed';
  }

  /** @override */
  get params() {
    return { chunkSize: this.#chunkSize };
  }

  /**
   * @override
   * @param {AsyncIterable<Buffer>} source - The input byte stream.
   * @yields {Buffer}
   */
  async *chunk(source) {
    let buffer = Buffer.alloc(0);

    for await (const data of source) {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= this.#chunkSize) {
        yield buffer.slice(0, this.#chunkSize);
        buffer = buffer.slice(this.#chunkSize);
      }
    }

    if (buffer.length > 0) {
      yield buffer;
    }
  }
}
