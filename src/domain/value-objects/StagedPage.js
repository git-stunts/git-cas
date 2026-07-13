import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import assertCanonicalTimestamp from '../helpers/assertCanonicalTimestamp.js';
import PageHandle from './PageHandle.js';

/**
 * Immutable result for a page blob written without a reachability root.
 */
export default class StagedPage {
  /** @param {{ handle: PageHandle|string|object, size: number, observedAt: string }} value */
  constructor({ handle, size, observedAt }) {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw StagedPage.#invalid('Staged page size must be a non-negative safe integer', { size });
    }
    assertCanonicalTimestamp(observedAt, {
      invalid: StagedPage.#invalid,
      message: 'Staged page observation time must be a canonical UTC timestamp',
    });
    this.version = 1;
    this.state = 'staged';
    this.handle = PageHandle.from(handle);
    this.page = Object.freeze({ size });
    this.retention = Object.freeze({
      policy: null,
      reachability: 'unanchored',
      protection: 'not-established',
    });
    this.observedAt = observedAt;
    Object.freeze(this);
  }

  /** @returns {object} */
  toJSON() {
    return {
      version: this.version,
      state: this.state,
      handle: this.handle.toString(),
      page: { ...this.page },
      retention: { ...this.retention },
      observedAt: this.observedAt,
    };
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.HANDLE_INVALID, meta);
  }
}
