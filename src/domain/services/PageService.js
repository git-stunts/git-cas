import { concatBytes, isBytes, normalizeByteChunk } from '../bytes/ByteLayout.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { assertHandleObjectType, mapHandleTargetError } from '../helpers/handleTarget.js';
import PageHandle from '../value-objects/PageHandle.js';
import StagedPage from '../value-objects/StagedPage.js';
import BoundedPromiseCache from '../../helpers/boundedPromiseCache.js';

export const DEFAULT_MAX_PAGE_SIZE = 16 * 1024 * 1024;
const DEFAULT_PAGE_CACHE_ENTRIES = 128;
const DEFAULT_PAGE_CACHE_BYTES = 8 * 1024 * 1024;
const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });

/**
 * Stores and streams immutable, bounded page blobs.
 */
export default class PageService {
  #clock;
  #maxPageSize;
  #payloads;
  #persistence;

  /**
   * @param {object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {number} [options.maxPageSize]
   * @param {number} [options.pageCacheEntries]
   * @param {number} [options.pageCacheBytes]
   * @param {{ now(): Date }} [options.clock]
   */
  constructor({
    persistence,
    maxPageSize = DEFAULT_MAX_PAGE_SIZE,
    pageCacheEntries = DEFAULT_PAGE_CACHE_ENTRIES,
    pageCacheBytes = DEFAULT_PAGE_CACHE_BYTES,
    clock = DEFAULT_CLOCK,
  }) {
    PageService.#assertDependencies(persistence, clock);
    PageService.#assertLimit(maxPageSize, 'Configured max page size');
    PageService.#assertPositiveLimit(pageCacheEntries, 'Page cache entries');
    PageService.#assertLimit(pageCacheBytes, 'Page cache bytes');
    this.#persistence = persistence;
    this.#maxPageSize = maxPageSize;
    this.#payloads = new BoundedPromiseCache(pageCacheEntries, {
      maxWeight: pageCacheBytes,
      weightOf: (value) => value.byteLength,
    });
    this.#clock = clock;
  }

  /**
   * @param {{ source: Uint8Array|Iterable<Uint8Array>|AsyncIterable<Uint8Array>, maxBytes?: number }} options
   * @returns {Promise<StagedPage>}
   */
  async put({ source, maxBytes }) {
    const limit = this.#effectiveLimit(maxBytes);
    const observedAt = this.#observedAt();
    const bytes = await PageService.#collect(source, limit);
    const oid = await this.#persistence.writeBlob(bytes);
    return new StagedPage({
      handle: new PageHandle({ oid }),
      size: bytes.length,
      observedAt,
    });
  }

  /**
   * @param {{ handle: PageHandle|string|object }} options
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *open({ handle: value }) {
    const root = await this.resolveRoot(value);
    try {
      yield* await this.#persistence.readBlobStream(root.oid);
    } catch (error) {
      throw mapHandleTargetError(error, root.handle);
    }
  }

  /**
   * @param {{ handle: PageHandle|string|object, maxBytes?: number }} options
   * @returns {Promise<Uint8Array>}
   */
  async get({ handle, maxBytes }) {
    const limit = this.#effectiveLimit(maxBytes);
    const pageHandle = PageHandle.from(handle);
    let payload = this.#payloads.get(pageHandle.oid);
    if (payload === undefined) {
      const root = await this.resolveRoot(pageHandle);
      if (root.size > limit) {
        throw PageService.#tooLarge(root.size, limit);
      }
      payload = this.#payloads.getOrCreate(
        root.oid,
        async () => await this.#readRoot(root),
      );
    }
    const bytes = await payload;
    if (bytes.byteLength > limit) {
      throw PageService.#tooLarge(bytes.byteLength, limit);
    }
    return new Uint8Array(bytes);
  }

  /**
   * @param {PageHandle|string|object} value
   * @returns {Promise<object>}
   */
  async resolveRoot(value) {
    const handle = PageHandle.from(value);
    await assertHandleObjectType({
      persistence: this.#persistence,
      handle,
      oid: handle.oid,
      expectedType: 'blob',
    });
    let size;
    try {
      size = await this.#persistence.readObjectSize(handle.oid);
    } catch (error) {
      throw mapHandleTargetError(error, handle);
    }
    if (size > this.#maxPageSize) {
      throw PageService.#tooLarge(size, this.#maxPageSize);
    }
    return Object.freeze({ handle, oid: handle.oid, type: 'blob', size });
  }

  #effectiveLimit(value) {
    if (value === undefined) {
      return this.#maxPageSize;
    }
    PageService.#assertLimit(value, 'Page maxBytes');
    if (value > this.#maxPageSize) {
      throw createCasError(
        'Page maxBytes cannot exceed the configured maximum',
        ErrorCodes.INVALID_OPTIONS,
        { maxBytes: value, configuredMaxPageSize: this.#maxPageSize }
      );
    }
    return value;
  }

  async #readRoot(root) {
    try {
      return await PageService.#collect(
        await this.#persistence.readBlobStream(root.oid),
        this.#maxPageSize,
      );
    } catch (error) {
      throw mapHandleTargetError(error, root.handle);
    }
  }

  #observedAt() {
    const now = this.#clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw createCasError('PageService clock returned an invalid Date', ErrorCodes.INVALID_OPTIONS);
    }
    return now.toISOString();
  }

  static async #collect(source, maxBytes) {
    if (isBytes(source)) {
      if (source.length > maxBytes) {
        throw PageService.#tooLarge(source.length, maxBytes);
      }
      return new Uint8Array(source);
    }
    const iterator = source?.[Symbol.asyncIterator] ?? source?.[Symbol.iterator];
    if (typeof iterator !== 'function') {
      throw createCasError(
        'Page source must be bytes or an iterable of byte chunks',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of source) {
      let bytes;
      try {
        bytes = normalizeByteChunk(chunk);
      } catch (error) {
        throw createCasError('Page source yielded a non-byte chunk', ErrorCodes.INVALID_OPTIONS, {
          originalError: error,
        });
      }
      total += bytes.length;
      if (total > maxBytes) {
        throw PageService.#tooLarge(total, maxBytes);
      }
      chunks.push(bytes);
    }
    return concatBytes(chunks, total);
  }

  static #tooLarge(observedBytes, maxBytes) {
    return createCasError('Page exceeds its configured byte limit', ErrorCodes.PAGE_TOO_LARGE, {
      observedBytes,
      maxBytes,
    });
  }

  static #assertLimit(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw createCasError(`${label} must be a non-negative safe integer`, ErrorCodes.INVALID_OPTIONS, {
        value,
      });
    }
  }

  static #assertPositiveLimit(value, label) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw createCasError(`${label} must be a positive safe integer`, ErrorCodes.INVALID_OPTIONS, {
        value,
      });
    }
  }

  static #assertDependencies(persistence, clock) {
    const methods = ['writeBlob', 'readBlobStream', 'readObjectType', 'readObjectSize'];
    if (!persistence || methods.some((method) => typeof persistence[method] !== 'function')) {
      throw createCasError('PageService requires a complete persistence port', ErrorCodes.INVALID_OPTIONS);
    }
    if (!clock || typeof clock.now !== 'function') {
      throw createCasError('PageService clock must provide now()', ErrorCodes.INVALID_OPTIONS);
    }
  }
}
