/**
 * @fileoverview Chunker factory — resolves a ChunkingPort from facade config.
 */
import FixedChunker from './FixedChunker.js';
import CdcChunker from './CdcChunker.js';

/**
 * Resolves a {@link import('../../ports/ChunkingPort.js').default ChunkingPort}
 * instance from facade configuration options.
 *
 * Resolution order:
 * 1. A pre-built `chunker` instance takes precedence.
 * 2. A declarative `chunking` config is used to construct the appropriate chunker.
 * 3. `undefined` — CasService will fall back to its built-in FixedChunker default.
 *
 * @param {Object} options
 * @param {import('../../ports/ChunkingPort.js').default} [options.chunker] - Pre-built ChunkingPort instance (advanced).
 * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number }} [options.chunking] - Declarative chunking strategy config.
 * @returns {import('../../ports/ChunkingPort.js').default|undefined}
 */
export default function resolveChunker({ chunker, chunking } = {}) {
  // Direct ChunkingPort instance takes precedence
  if (chunker) {
    return chunker;
  }
  // Build from declarative chunking config
  if (chunking) {
    if (chunking.strategy === 'cdc') {
      return new CdcChunker({
        targetChunkSize: chunking.targetChunkSize,
        minChunkSize: chunking.minChunkSize,
        maxChunkSize: chunking.maxChunkSize,
        normalized: chunking.normalized,
      });
    }
    // 'fixed' with valid chunkSize → FixedChunker; otherwise fall through
    // to CasService's built-in FixedChunker default.
    if (chunking.strategy === 'fixed'
      && typeof chunking.chunkSize === 'number'
      && Number.isFinite(chunking.chunkSize)
      && chunking.chunkSize > 0) {
      return new FixedChunker({ chunkSize: chunking.chunkSize });
    }
  }
  // undefined → CasService will default to FixedChunker
  return undefined;
}
