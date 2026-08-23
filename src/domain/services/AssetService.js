import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import AssetHandle from '../value-objects/AssetHandle.js';
import StagedAsset from '../value-objects/StagedAsset.js';
import BoundedWriteWavePersistence from './BoundedWriteWavePersistence.js';
import forkCasPersistence from './forkCasPersistence.js';

const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });
export const DEFAULT_ASSET_WRITE_BATCH_ASSETS = 4;
export const DEFAULT_ASSET_WRITE_BATCH_OBJECTS = 4_096;
export const DEFAULT_ASSET_WRITE_BATCH_BYTES = 256 * 1024 * 1024;

/**
 * High-level asset handle boundary over the existing streaming CAS pipeline.
 */
export default class AssetService {
  #cas;
  #clock;

  /**
   * @param {object} options
   * @param {import('./CasService.js').default} options.cas
   * @param {{ now(): Date }} [options.clock]
   */
  constructor({ cas, clock = DEFAULT_CLOCK }) {
    AssetService.#assertDependencies(cas, clock);
    this.#cas = cas;
    this.#clock = clock;
  }

  /**
   * Streams one asset into CAS and returns an explicitly unanchored handle.
   *
   * @param {object} options
   * @returns {Promise<StagedAsset>}
   */
  async put(options) {
    return await this.#putWith(this.#cas, options);
  }

  /** Stores an input-ordered group with bounded concurrent CAS pipelines. */
  async putBatch(options = {}) {
    const batch = AssetService.#batchOptions(options);
    const persistence = new BoundedWriteWavePersistence({
      persistence: this.#cas.persistence,
      maxBatchObjects: batch.maxBatchObjects,
      maxBatchBytes: batch.maxBatchBytes,
    });
    const cas = forkCasPersistence(this.#cas, persistence);
    const results = new Array(batch.assets.length);
    const state = { next: 0, error: null };
    const workers = Array.from(
      { length: Math.min(batch.maxBatchAssets, batch.assets.length) },
      () => this.#putBatchWorker({ batch, cas, results, state }),
    );
    await Promise.allSettled(workers);
    if (state.error !== null) {
      state.error.meta = {
        ...state.error.meta,
        staging: {
          ...persistence.snapshot(),
          stagedAssetCount: results.filter(Boolean).length,
        },
      };
      throw state.error;
    }
    return Object.freeze(results);
  }

  async #putWith(cas, options) {
    const filename = options?.filename ?? options?.slug;
    const manifest = await cas.store({ ...options, filename });
    const oid = await cas.createTree({
      manifest,
      merkleThreshold: options?.merkleThreshold,
    });
    return this.#staged({ manifest, oid });
  }

  async #putBatchWorker({ batch, cas, results, state }) {
    while (state.error === null) {
      const index = state.next;
      if (index >= batch.assets.length) {
        return;
      }
      state.next += 1;
      try {
        results[index] = await this.#putWith(cas, batch.assets[index]);
      } catch (error) {
        state.error ??= error;
      }
    }
  }

  /**
   * Adopts a validated existing git-cas manifest tree into an asset handle.
   *
   * @param {{ treeOid: string }} options
   * @returns {Promise<StagedAsset>}
   */
  async adopt({ treeOid }) {
    const handle = new AssetHandle({ codec: this.#cas.codec.extension, oid: treeOid });
    const root = await this.resolveRoot(handle);
    return this.#staged({ manifest: root.manifest, oid: root.oid });
  }

  /**
   * Streams plaintext bytes from a validated asset handle.
   *
   * @param {object} options
   * @param {AssetHandle|string|object} options.handle
   * @param {Uint8Array} [options.encryptionKey]
   * @param {string} [options.passphrase]
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *open({ handle: value, encryptionKey, passphrase }) {
    const root = await this.resolveRoot(value);
    try {
      yield* this.#cas.restoreStream({
        manifest: root.manifest,
        encryptionKey,
        passphrase,
      });
    } catch (error) {
      throw this.#mapTargetError(error, root.handle);
    }
  }

  /**
   * Validates the handle and its complete manifest/chunk object graph.
   *
   * @param {AssetHandle|string|object} value
   * @returns {Promise<object>}
   */
  async resolveRoot(value) {
    const handle = AssetHandle.from(value);
    this.#assertCodec(handle);
    await this.#assertObjectType(handle, handle.oid, 'tree');

    let manifest;
    try {
      manifest = await this.#cas.readManifest({ treeOid: handle.oid });
    } catch (error) {
      throw this.#mapTargetError(error, handle);
    }
    await this.#assertChunkGraph(handle, manifest);
    return Object.freeze({
      handle,
      oid: handle.oid,
      type: 'tree',
      size: manifest.size,
      manifest,
    });
  }

  async #assertChunkGraph(handle, manifest) {
    const blobs = new Set();
    for (const chunk of manifest.chunks) {
      blobs.add(chunk.blob);
    }
    const iterator = blobs.values();
    const workerCount = Math.min(this.#cas.concurrency, blobs.size);

    const validateNext = async () => {
      while (true) {
        const next = iterator.next();
        if (next.done) {
          return;
        }
        await this.#assertObjectType(handle, next.value, 'blob');
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => validateNext()));
  }

  async #assertObjectType(handle, oid, expectedType) {
    let actualType;
    try {
      actualType = await this.#cas.persistence.readObjectType(oid);
    } catch (error) {
      throw this.#mapTargetError(error, handle, oid);
    }
    if (actualType !== expectedType) {
      throw createCasError(
        'Asset handle target has the wrong Git object type',
        ErrorCodes.HANDLE_TARGET_TYPE_MISMATCH,
        { handle: handle.toString(), targetOid: oid, expectedType, actualType }
      );
    }
  }

  #assertCodec(handle) {
    const expectedCodec = this.#cas.codec.extension;
    if (handle.codec !== expectedCodec) {
      throw createCasError(
        'Asset handle codec does not match this CAS instance',
        ErrorCodes.HANDLE_CODEC_MISMATCH,
        {
          handle: handle.toString(),
          expectedCodec,
          actualCodec: handle.codec,
        }
      );
    }
  }

  #mapTargetError(error, handle, targetOid = handle.oid) {
    if (error?.code === ErrorCodes.HANDLE_TARGET_MISSING) {
      return error;
    }
    const missing =
      error?.code === ErrorCodes.GIT_OBJECT_NOT_FOUND ||
      /(?:object|blob|tree) not found/iu.test(
        error instanceof Error ? error.message : String(error)
      );
    if (!missing) {
      return error;
    }
    return createCasError(
      'Asset handle target graph is missing from this repository',
      ErrorCodes.HANDLE_TARGET_MISSING,
      { handle: handle.toString(), targetOid, originalError: error }
    );
  }

  #staged({ manifest, oid }) {
    return new StagedAsset({
      handle: new AssetHandle({ codec: this.#cas.codec.extension, oid }),
      slug: manifest.slug,
      filename: manifest.filename,
      size: manifest.size,
      observedAt: this.#observedAt(),
    });
  }

  #observedAt() {
    const now = this.#clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw createCasError(
        'AssetService clock returned an invalid Date',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    return now.toISOString();
  }

  static #assertDependencies(cas, clock) {
    const methods = ['store', 'createTree', 'readManifest', 'restoreStream'];
    if (!cas || methods.some((method) => typeof cas[method] !== 'function')) {
      throw createCasError(
        'AssetService requires a complete CasService',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    if (!cas.persistence || typeof cas.persistence.readObjectType !== 'function') {
      throw createCasError(
        'AssetService requires object-type inspection',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    if (!clock || typeof clock.now !== 'function') {
      throw createCasError('AssetService clock must provide now()', ErrorCodes.INVALID_OPTIONS);
    }
  }

  static #batchOptions(options) {
    if (!options || typeof options !== 'object' || !Array.isArray(options.assets)) {
      throw createCasError('Asset batch must provide an asset array', ErrorCodes.INVALID_OPTIONS);
    }
    const batch = {
      assets: options.assets,
      maxBatchAssets: options.maxBatchAssets ?? DEFAULT_ASSET_WRITE_BATCH_ASSETS,
      maxBatchObjects: options.maxBatchObjects ?? DEFAULT_ASSET_WRITE_BATCH_OBJECTS,
      maxBatchBytes: options.maxBatchBytes ?? DEFAULT_ASSET_WRITE_BATCH_BYTES,
    };
    AssetService.#assertBatchLimit(batch.maxBatchAssets, 'assets', 64);
    AssetService.#assertBatchLimit(batch.maxBatchObjects, 'objects', 100_000);
    AssetService.#assertBatchLimit(batch.maxBatchBytes, 'bytes', 1024 * 1024 * 1024);
    return batch;
  }

  static #assertBatchLimit(value, label, maximum) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw createCasError(
        `Asset batch ${label} limit is outside its supported range`,
        ErrorCodes.INVALID_OPTIONS,
        { label, value, maximum },
      );
    }
  }
}
