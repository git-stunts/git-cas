import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import assertCanonicalTimestamp from '../helpers/assertCanonicalTimestamp.js';
import BundleHandle from './BundleHandle.js';
import BundleLimits from './BundleLimits.js';

/**
 * Immutable result for a bundle graph written without a reachability root.
 */
export default class StagedBundle {
  /**
   * @param {object} value
   * @param {BundleHandle|string|object} value.handle
   * @param {number} value.memberCount
   * @param {number} value.indexDepth
   * @param {number} value.descriptorBytes
   * @param {BundleLimits|object} value.limits
   * @param {string} value.observedAt
   */
  constructor({ handle, memberCount, indexDepth, descriptorBytes, limits, observedAt }) {
    for (const [field, number] of Object.entries({ memberCount, descriptorBytes })) {
      if (!Number.isSafeInteger(number) || number < 0) {
        throw StagedBundle.#invalid('Staged bundle metric is invalid', { field, value: number });
      }
    }
    if (!Number.isSafeInteger(indexDepth) || indexDepth < 1) {
      throw StagedBundle.#invalid('Staged bundle index depth is invalid', {
        field: 'indexDepth',
        value: indexDepth,
      });
    }
    assertCanonicalTimestamp(observedAt, {
      invalid: StagedBundle.#invalid,
      message: 'Staged bundle observation time must be a canonical UTC timestamp',
    });
    this.version = 1;
    this.state = 'staged';
    this.handle = BundleHandle.from(handle);
    this.bundle = Object.freeze({ memberCount, indexDepth, descriptorBytes });
    this.limits = Object.freeze(new BundleLimits(limits).toJSON());
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
      bundle: { ...this.bundle },
      limits: { ...this.limits },
      retention: { ...this.retention },
      observedAt: this.observedAt,
    };
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.HANDLE_INVALID, meta);
  }
}
