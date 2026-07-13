import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';

export const MAX_CACHE_ENTRIES = 99_999;
export const DEFAULT_CACHE_POLICY = Object.freeze({
  maxEntries: 10_000,
  maxBytes: null,
  accessResolutionMs: 3_600_000,
});

/** Immutable admission and eviction policy for one CacheSet. */
export default class CachePolicy {
  constructor(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw CachePolicy.#invalid('Cache policy must be an object', { policy: value });
    }
    const policy = { ...DEFAULT_CACHE_POLICY, ...value };
    CachePolicy.#assertBound('maxEntries', policy.maxEntries, {
      minimum: 1,
      maximum: MAX_CACHE_ENTRIES,
    });
    CachePolicy.#assertNullableBound('maxBytes', policy.maxBytes);
    CachePolicy.#assertBound('accessResolutionMs', policy.accessResolutionMs, { minimum: 0 });
    this.maxEntries = policy.maxEntries;
    this.maxBytes = policy.maxBytes;
    this.accessResolutionMs = policy.accessResolutionMs;
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof CachePolicy ? value : new CachePolicy(value);
  }

  toJSON() {
    return {
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      accessResolutionMs: this.accessResolutionMs,
    };
  }

  static #assertNullableBound(name, value) {
    if (value !== null) {
      CachePolicy.#assertBound(name, value, { minimum: 0 });
    }
  }

  static #assertBound(name, value, { minimum, maximum = Number.MAX_SAFE_INTEGER }) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw CachePolicy.#invalid(`Cache policy ${name} is outside its supported range`, {
        name, value, minimum, maximum,
      });
    }
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.CACHE_POLICY_INVALID, meta);
  }
}
