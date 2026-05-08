/**
 * Restores framed encrypted records, optionally decompressing after decryption.
 *
 * @typedef {import('../value-objects/Manifest.js').default} Manifest
 */
export default class RestoreFramed {
  #chunks;
  #compression;
  #framed;
  #isLegacyNoAad;
  #observability;

  /**
   * @param {Object} options
   * @param {import('../services/ChunkRepository.js').default} options.chunks
   * @param {import('../services/CompressionStreams.js').default} options.compression
   * @param {import('./FramedRecordCodec.js').default} options.framed
   * @param {(manifest: Manifest) => boolean} options.isLegacyNoAad
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   */
  constructor({ chunks, compression, framed, isLegacyNoAad, observability }) {
    this.#chunks = chunks;
    this.#compression = compression;
    this.#framed = framed;
    this.#isLegacyNoAad = isLegacyNoAad;
    this.#observability = observability;
  }

  /**
   * @param {{ manifest: Manifest, key: Uint8Array, encryptionMeta: { frameBytes: number } }} options
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *execute({ manifest, key, encryptionMeta }) {
    const decrypted = this.#framed.decryptSource({
      manifest,
      source: this.#chunks.iterVerifiedChunkBlobs(manifest),
      key,
      encryptionMeta,
      legacyNoAad: this.#isLegacyNoAad(manifest),
    });
    const source = manifest.compression ? this.#compression.decompress(decrypted) : decrypted;

    let totalSize = 0;
    for await (const chunk of source) {
      totalSize += chunk.length;
      yield chunk;
    }
    this.#observability.metric('file', {
      action: 'restored',
      slug: manifest.slug,
      size: totalSize,
      chunkCount: manifest.chunks.length,
    });
  }
}
