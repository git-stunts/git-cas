/**
 * Stores plaintext chunks without encryption.
 */
export default class StorePlain {
  #chunks;

  /**
   * @param {import('../services/ChunkRepository.js').default} chunks
   */
  constructor(chunks) {
    this.#chunks = chunks;
  }

  /**
   * @param {{ processedSource: AsyncIterable<Uint8Array>, manifestData: { chunks: Array, size: number } }} options
   */
  async execute({ processedSource, manifestData }) {
    await this.#chunks.chunkAndStore(processedSource, manifestData);
  }
}
