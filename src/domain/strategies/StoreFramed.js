import { SCHEME_FRAMED } from '../encryption/schemes.js';

/**
 * Stores content as independently encrypted framed records.
 */
export default class StoreFramed {
  #chunks;
  #framed;

  /**
   * @param {Object} options
   * @param {import('../services/ChunkRepository.js').default} options.chunks
   * @param {import('./FramedRecordCodec.js').default} options.framed
   */
  constructor({ chunks, framed }) {
    this.#chunks = chunks;
    this.#framed = framed;
  }

  /**
   * @param {{ processedSource: AsyncIterable<Uint8Array>, manifestData: { slug: string, chunks: Array, size: number, encryption?: object }, keyInfo: { key: Uint8Array, encExtra: object }, encryptionConfig: { frameBytes: number } }} options
   */
  async execute({ processedSource, manifestData, keyInfo, encryptionConfig }) {
    await this.#chunks.chunkAndStore(
      this.#framed.encryptFrames(processedSource, keyInfo.key, {
        frameBytes: encryptionConfig.frameBytes,
        slug: manifestData.slug,
      }),
      manifestData,
    );
    manifestData.encryption = {
      scheme: SCHEME_FRAMED,
      algorithm: 'aes-256-gcm',
      encrypted: true,
      frameBytes: encryptionConfig.frameBytes,
      ...keyInfo.encExtra,
    };
  }
}
