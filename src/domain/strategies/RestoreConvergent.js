/**
 * Restores convergent encrypted chunks, optionally decompressing after decryption.
 *
 * @typedef {import('../value-objects/Manifest.js').default} Manifest
 */
export default class RestoreConvergent {
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
   * @param {{ manifest: Manifest, key: Uint8Array }} options
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *execute({ manifest, key }) {
    const source = manifest.compression
      ? this.#compression.decompress(this.#chunks.iterConvergentChunks(manifest, key))
      : this.#chunks.iterConvergentChunks(manifest, key);

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
