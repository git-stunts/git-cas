/**
 * Restores plaintext gzip-compressed content as a stream.
 */
export default class RestoreCompressed {
  #chunks;
  #compression;
  #observability;

  /**
   * @param {Object} options
   * @param {import('../services/ChunkRepository.js').default} options.chunks
   * @param {import('../services/CompressionStreams.js').default} options.compression
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   */
  constructor({ chunks, compression, observability }) {
    this.#chunks = chunks;
    this.#compression = compression;
    this.#observability = observability;
  }

  /**
   * @param {{ manifest: import('../value-objects/Manifest.js').default }} options
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *execute({ manifest }) {
    let totalSize = 0;
    for await (const chunk of this.#compression.decompress(this.#chunks.iterVerifiedChunkBlobs(manifest))) {
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
