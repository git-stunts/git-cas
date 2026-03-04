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
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
    }
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
    const cs = this.#chunkSize;
    const buf = Buffer.allocUnsafe(cs);
    let offset = 0;

    for await (const data of source) {
      let srcPos = 0;
      while (srcPos < data.length) {
        const n = Math.min(cs - offset, data.length - srcPos);
        data.copy(buf, offset, srcPos, srcPos + n);
        offset += n;
        srcPos += n;
        if (offset === cs) {
          yield Buffer.from(buf);
          offset = 0;
        }
      }
    }

    if (offset > 0) {
      yield Buffer.from(buf.subarray(0, offset));
    }
  }
}
