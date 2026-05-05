import { SCHEME_WHOLE } from '../encryption/schemes.js';
import { buildWholeAad } from './Aad.js';

/**
 * Stores whole-object encrypted content through the CryptoPort stream API.
 */
export default class StoreWhole {
  #chunks;
  #crypto;

  /**
   * @param {Object} options
   * @param {import('../services/ChunkRepository.js').default} options.chunks
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   */
  constructor({ chunks, crypto }) {
    this.#chunks = chunks;
    this.#crypto = crypto;
  }

  /**
   * @param {{ processedSource: AsyncIterable<Uint8Array>, manifestData: { slug: string, chunks: Array, size: number, encryption?: object }, keyInfo: { key: Uint8Array, encExtra: object } }} options
   */
  async execute({ processedSource, manifestData, keyInfo }) {
    const aad = buildWholeAad(manifestData.slug);
    const { encrypt, finalize } = this.#crypto.createEncryptionStream(keyInfo.key, aad);
    await this.#chunks.chunkAndStore(encrypt(processedSource), manifestData);
    manifestData.encryption = {
      ...finalize(),
      scheme: SCHEME_WHOLE,
      ...keyInfo.encExtra,
    };
  }
}
