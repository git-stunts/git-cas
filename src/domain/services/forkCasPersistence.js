import CasService from './CasService.js';

/** Creates an operation-local CAS facade over another persistence port. */
export default function forkCasPersistence(cas, persistence) {
  return new CasService({
    persistence,
    codec: cas.codec,
    crypto: cas.crypto,
    observability: cas.observability,
    chunkSize: cas.chunkSize,
    merkleThreshold: cas.merkleThreshold,
    concurrency: cas.concurrency,
    chunker: cas.chunker,
    maxRestoreBufferSize: cas.maxRestoreBufferSize,
    maxBlobSize: cas.maxBlobSize,
    compressionAdapter: cas.compressionAdapter,
    formatVersion: cas.formatVersion,
    legacyMode: cas.legacyMode,
  });
}
