import CasError from '../errors/CasError.js';
import Semaphore from './Semaphore.js';

/**
 * Coordinates chunk iteration, bounded write concurrency, write backpressure,
 * and store-phase error metadata.
 */
export default class StorePipeline {
  #chunker;
  #concurrency;
  #observability;
  #storeChunk;

  /**
   * @param {Object} options
   * @param {import('../../ports/ChunkingPort.js').default} options.chunker
   * @param {number} options.concurrency
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   * @param {(chunk: Uint8Array, index: number, convergentKey?: Uint8Array) => Promise<{ index: number, size: number, digest: string, blob: string }>} options.storeChunk
   */
  constructor({ chunker, concurrency, observability, storeChunk }) {
    this.#chunker = chunker;
    this.#concurrency = concurrency;
    this.#observability = observability;
    this.#storeChunk = storeChunk;
  }

  /**
   * @param {AsyncIterable<Uint8Array>} source
   * @param {{ chunks: Array<{ index: number, size: number, digest: string, blob: string }>, size: number }} manifestData
   * @param {{ convergentKey?: Uint8Array }} [options]
   */
  async chunkAndStore(source, manifestData, { convergentKey } = {}) {
    const sem = new Semaphore(this.#concurrency);
    const iterator = this.#chunker.chunk(source)[Symbol.asyncIterator]();
    const results = [];
    const inFlight = new Set();
    const orphanedBlobs = [];
    const state = { nextIndex: 0, writeError: null, failedIndex: null };

    while (true) {
      // Acquire capacity before pulling the next chunk so slow writes apply
      // backpressure all the way to the upstream source iterator.
      await sem.acquire();

      if (state.writeError) {
        sem.release();
        await this.#closeAsyncIterator(iterator);
        break;
      }

      const step = await this.#readNextStoreChunk({
        iterator,
        sem,
        inFlight,
        orphanedBlobs,
        nextIndex: state.nextIndex,
      });

      if (step.done) {
        sem.release();
        break;
      }

      this.#launchChunkWrite({
        buf: step.value,
        idx: state.nextIndex++,
        sem,
        results,
        orphanedBlobs,
        inFlight,
        state,
        convergentKey,
      });
    }

    await this.#awaitChunkWrites({ inFlight, state, orphanedBlobs });
    this.#appendChunkEntries(manifestData, results);
  }

  #launchChunkWrite({ buf, idx, sem, results, orphanedBlobs, inFlight, state, convergentKey }) {
    const task = (async () => {
      try {
        const entry = await this.#storeChunk(buf, idx, convergentKey);
        results[idx] = entry;
        orphanedBlobs.push(entry.blob);
      } finally {
        sem.release();
      }
    })().catch((err) => {
      state.writeError ??= err;
      state.failedIndex ??= idx;
      throw err;
    });

    inFlight.add(task);
    task.then(
      () => inFlight.delete(task),
      () => inFlight.delete(task),
    );
  }

  async #readNextStoreChunk({ iterator, sem, inFlight, orphanedBlobs, nextIndex }) {
    try {
      return await iterator.next();
    } catch (err) {
      sem.release();
      await Promise.allSettled(inFlight);
      await this.#closeAsyncIterator(iterator);
      throw this.#buildStoreStreamError(err, nextIndex, orphanedBlobs);
    }
  }

  async #awaitChunkWrites({ inFlight, state, orphanedBlobs }) {
    const settled = await Promise.allSettled(inFlight);
    if (state.writeError) {
      throw this.#buildStoreWriteError({
        err: state.writeError,
        nextIndex: state.nextIndex,
        orphanedBlobs,
        failedIndex: state.failedIndex,
      });
    }
    for (const result of settled) {
      if (result.status !== 'fulfilled') {
        throw this.#buildStoreWriteError({
          err: result.reason,
          nextIndex: state.nextIndex,
          orphanedBlobs,
          failedIndex: state.failedIndex,
        });
      }
    }
  }

  #appendChunkEntries(manifestData, results) {
    for (const entry of results) {
      manifestData.chunks.push(entry);
      manifestData.size += entry.size;
    }
  }

  async #closeAsyncIterator(iterator) {
    if (typeof iterator.return !== 'function') {
      return;
    }
    try {
      await iterator.return();
    } catch {
      // Prefer surfacing the original store failure.
    }
  }

  #buildStoreStreamError(err, nextIndex, orphanedBlobs) {
    if (err instanceof CasError) {
      err.meta = { ...err.meta, orphanedBlobs };
      return err;
    }

    const message = err instanceof Error ? err.message : String(err);
    const casErr = new CasError(
      `Stream error during store: ${message}`,
      'STREAM_ERROR',
      { chunksDispatched: nextIndex, orphanedBlobs, originalError: err },
    );
    this.#observability.metric('error', {
      code: casErr.code,
      message: casErr.message,
      orphanedBlobs: orphanedBlobs.length,
    });
    return casErr;
  }

  #buildStoreWriteError({ err, nextIndex, orphanedBlobs, failedIndex }) {
    const writeMeta = {
      chunksDispatched: nextIndex,
      orphanedBlobs,
      ...(failedIndex === null ? {} : { failedIndex }),
    };

    if (err instanceof CasError) {
      err.meta = { ...err.meta, ...writeMeta };
      return err;
    }

    const message = err instanceof Error ? err.message : String(err);
    const casErr = new CasError(
      `Store write failed: ${message}`,
      'STORE_ERROR',
      { ...writeMeta, originalError: err },
    );
    this.#observability.metric('error', {
      code: casErr.code,
      message: casErr.message,
      orphanedBlobs: orphanedBlobs.length,
      ...(failedIndex === null ? {} : { failedIndex }),
    });
    return casErr;
  }
}
