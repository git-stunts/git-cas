import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import AssetHandle from '../value-objects/AssetHandle.js';
import StagedAsset from '../value-objects/StagedAsset.js';

const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });

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
    const filename = options?.filename ?? options?.slug;
    const manifest = await this.#cas.store({ ...options, filename });
    const oid = await this.#cas.createTree({
      manifest,
      merkleThreshold: options?.merkleThreshold,
    });
    return this.#staged({ manifest, oid });
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
    const seen = new Set();
    for (const chunk of manifest.chunks) {
      if (!seen.has(chunk.blob)) {
        seen.add(chunk.blob);
        await this.#assertObjectType(handle, chunk.blob, 'blob');
      }
    }
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
}
