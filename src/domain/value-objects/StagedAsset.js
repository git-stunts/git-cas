import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import isCanonicalUtcTimestamp from '../helpers/isCanonicalUtcTimestamp.js';
import AssetHandle from './AssetHandle.js';

/**
 * Immutable result for an asset graph written without a reachability root.
 */
export default class StagedAsset {
  /**
   * @param {object} value
   * @param {AssetHandle|string|object} value.handle
   * @param {string} value.slug
   * @param {string} value.filename
   * @param {number} value.size
   * @param {string} value.observedAt
   */
  constructor({ handle, slug, filename, size, observedAt }) {
    if (typeof slug !== 'string' || slug.length === 0) {
      throw StagedAsset.#invalid('Staged asset slug must be a non-empty string', { slug });
    }
    if (typeof filename !== 'string' || filename.length === 0) {
      throw StagedAsset.#invalid('Staged asset filename must be a non-empty string', { filename });
    }
    if (!Number.isSafeInteger(size) || size < 0) {
      throw StagedAsset.#invalid('Staged asset size must be a non-negative safe integer', { size });
    }
    StagedAsset.#assertTimestamp(observedAt);

    this.version = 1;
    this.state = 'staged';
    this.handle = AssetHandle.from(handle);
    this.asset = Object.freeze({ slug, filename, size });
    this.retention = Object.freeze({
      policy: null,
      reachability: 'unanchored',
      protection: 'not-established',
    });
    this.observedAt = observedAt;
    Object.freeze(this);
  }

  /**
   * @returns {object}
   */
  toJSON() {
    return {
      version: this.version,
      state: this.state,
      handle: this.handle.toString(),
      asset: { ...this.asset },
      retention: { ...this.retention },
      observedAt: this.observedAt,
    };
  }

  static #assertTimestamp(value) {
    if (!isCanonicalUtcTimestamp(value)) {
      throw StagedAsset.#invalid(
        'Staged asset observation time must be a canonical UTC timestamp',
        {
          observedAt: value,
        }
      );
    }
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.HANDLE_INVALID, meta);
  }
}
