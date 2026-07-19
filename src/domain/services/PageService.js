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
const DEFAULT_PAGE_WRITE_BATCH_BYTES = 32 * 1024 * 1024;
const DEFAULT_PAGE_WRITE_BATCH_PAGES = 256;
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
   * Stores one explicitly bounded page batch. All inputs are validated and
   * collected before the persistence batch begins.
   * @param {object} options
   * @param {Array<{source: Uint8Array|Iterable<Uint8Array>|AsyncIterable<Uint8Array>, maxBytes?: number}>} options.pages
   * @param {number} [options.maxBatchBytes]
   * @param {number} [options.maxBatchPages]
   * @returns {Promise<ReadonlyArray<StagedPage>>}
   */
  async putBatch({
    pages,
    maxBatchBytes = DEFAULT_PAGE_WRITE_BATCH_BYTES,
    maxBatchPages = DEFAULT_PAGE_WRITE_BATCH_PAGES,
  }) {
    PageService.#assertBatch(pages, maxBatchBytes, maxBatchPages);
    const prepared = [];
    let totalBytes = 0;
    for (const page of pages) {
      if (page === null || typeof page !== 'object' || !Object.hasOwn(page, 'source')) {
        throw createCasError('Page batch entry must provide source', ErrorCodes.INVALID_OPTIONS);
      }
      const bytes = await PageService.#collect(page.source, this.#effectiveLimit(page.maxBytes));
      totalBytes += bytes.length;
      if (totalBytes > maxBatchBytes) {
        throw createCasError(
          'Page batch exceeds its configured byte limit',
          ErrorCodes.PAGE_BATCH_LIMIT,
          { observedBytes: totalBytes, maxBatchBytes },
        );
      }
      prepared.push({ bytes, observedAt: this.#observedAt() });
    }

    if (prepared.length === 0) {
      return Object.freeze([]);
    }
    const oids = await this.#writeBlobs(prepared.map((page) => page.bytes));
    if (oids.length !== prepared.length) {
      throw createCasError(
        'Persistence returned the wrong number of page object identifiers',
        ErrorCodes.GIT_ERROR,
        { expected: prepared.length, actual: oids.length },
      );
    }
    return Object.freeze(oids.map((oid, index) => new StagedPage({
      handle: new PageHandle({ oid }),
      size: prepared[index].bytes.length,
      observedAt: prepared[index].observedAt,
    })));
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

  async #writeBlobs(contents) {
    if (typeof this.#persistence.writeBlobs === 'function') {
      return await this.#persistence.writeBlobs(contents);
    }
    const oids = [];
    for (const content of contents) {
      oids.push(await this.#persistence.writeBlob(content));
    }
    return oids;
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

  static #assertBatch(pages, maxBatchBytes, maxBatchPages) {
    PageService.#assertPositiveLimit(maxBatchBytes, 'Page batch bytes');
    PageService.#assertPositiveLimit(maxBatchPages, 'Page batch pages');
    if (!Array.isArray(pages)) {
      throw createCasError('Page batch must be an array', ErrorCodes.INVALID_OPTIONS);
    }
    if (pages.length > maxBatchPages) {
      throw createCasError(
        'Page batch exceeds its configured page limit',
        ErrorCodes.PAGE_BATCH_LIMIT,
        { observedPages: pages.length, maxBatchPages },
      );
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
