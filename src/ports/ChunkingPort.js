/**
 * Abstract port for splitting a byte stream into chunks.
 *
 * Implementations define a chunking strategy (e.g. fixed-size, content-defined)
 * and expose the configuration parameters that govern it.
 *
 * @abstract
 */
export default class ChunkingPort {
  constructor() {
    if (new.target === ChunkingPort) {
      throw new Error('ChunkingPort is abstract and cannot be instantiated directly');
    }
  }

  /**
   * Returns the strategy identifier for this chunker (e.g. `'fixed'`, `'cdc'`).
   * @abstract
   * @returns {string}
   */
  get strategy() {
    throw new Error('Not implemented');
  }

  /**
   * Returns the configuration parameters for this chunker.
   * @abstract
   * @returns {Object}
   */
  get params() {
    throw new Error('Not implemented');
  }

  /**
   * Splits an async byte stream into chunks.
   *
   * @abstract
   * @param {AsyncIterable<Buffer>} _source - The input byte stream.
   * @yields {Buffer} Chunks of data whose size depends on the strategy.
   * @returns {AsyncGenerator<Buffer>}
   */
  async *chunk(_source) { // eslint-disable-line require-yield
    throw new Error('Not implemented');
  }
}
