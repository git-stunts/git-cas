import { SCHEME_CONVERGENT } from '../encryption/schemes.js';

/**
 * Stores content using convergent per-chunk encryption.
 */
export default class StoreConvergent {
  #chunks;

  /**
   * @param {import('../services/ChunkRepository.js').default} chunks
   */
  constructor(chunks) {
    this.#chunks = chunks;
  }

  /**
   * @param {{ processedSource: AsyncIterable<Uint8Array>, manifestData: { chunks: Array, size: number, encryption?: object }, keyInfo: { key: Uint8Array, encExtra: object } }} options
   */
  async execute({ processedSource, manifestData, keyInfo }) {
    await this.#chunks.chunkAndStore(processedSource, manifestData, { convergentKey: keyInfo.key });
    manifestData.encryption = {
      scheme: SCHEME_CONVERGENT,
      algorithm: 'aes-256-gcm',
      encrypted: true,
      ...keyInfo.encExtra,
    };
  }
}
