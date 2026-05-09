/**
 * Restores unencrypted, uncompressed chunks with read-ahead.
 *
 * @typedef {import('../value-objects/Manifest.js').default} Manifest
 */
export default class RestorePlain {
  #chunks;
  #observability;

  /**
   * @param {Object} options
   * @param {import('../services/ChunkRepository.js').default} options.chunks
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   */
  constructor({ chunks, observability }) {
    this.#chunks = chunks;
    this.#observability = observability;
  }

  /**
   * @param {{ manifest: Manifest }} options
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *execute({ manifest }) {
    let totalSize = 0;
    for await (const blob of this.#chunks.iterVerifiedChunkBlobs(manifest)) {
      totalSize += blob.length;
      yield blob;
    }
    this.#observability.metric('file', {
      action: 'restored',
      slug: manifest.slug,
      size: totalSize,
      chunkCount: manifest.chunks.length,
    });
  }
}
