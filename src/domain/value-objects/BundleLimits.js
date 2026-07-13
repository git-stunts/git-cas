import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';

export const DEFAULT_BUNDLE_LIMITS = Object.freeze({
  maxMembers: 100_000,
  maxMemberPathBytes: 512,
  maxDescriptorBytes: 64 * 1024 * 1024,
  maxFanoutEntries: 1024,
  maxFanoutDepth: 8,
});

const BOUNDS = Object.freeze({
  maxMembers: Object.freeze({ min: 0, max: 10_000_000 }),
  maxMemberPathBytes: Object.freeze({ min: 1, max: 64 * 1024 }),
  maxDescriptorBytes: Object.freeze({ min: 1, max: 1024 * 1024 * 1024 }),
  maxFanoutEntries: Object.freeze({ min: 3, max: 65_536 }),
  maxFanoutDepth: Object.freeze({ min: 1, max: 64 }),
});

/**
 * Validated immutable admission limits for one bundle operation.
 */
export default class BundleLimits {
  /** @param {Partial<typeof DEFAULT_BUNDLE_LIMITS>} [value] */
  constructor(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw BundleLimits.#invalid('Bundle limits must be an object', { limits: value });
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(DEFAULT_BUNDLE_LIMITS, key)) {
        throw BundleLimits.#invalid('Bundle limits contain an unknown field', { field: key });
      }
    }
    for (const [key, fallback] of Object.entries(DEFAULT_BUNDLE_LIMITS)) {
      const candidate = value[key] ?? fallback;
      BundleLimits.#assertBound(key, candidate);
      this[key] = candidate;
    }
    Object.freeze(this);
  }

  /**
   * Returns per-operation limits that cannot exceed this configured maximum.
   *
   * @param {Partial<typeof DEFAULT_BUNDLE_LIMITS>} [overrides]
   */
  lower(overrides = {}) {
    const effective = new BundleLimits({ ...this.toJSON(), ...overrides });
    for (const key of Object.keys(DEFAULT_BUNDLE_LIMITS)) {
      if (effective[key] > this[key]) {
        throw BundleLimits.#invalid('Per-operation bundle limit exceeds configured maximum', {
          field: key,
          requested: effective[key],
          configured: this[key],
        });
      }
    }
    return effective;
  }

  /** @returns {object} */
  toJSON() {
    return Object.fromEntries(Object.keys(DEFAULT_BUNDLE_LIMITS).map((key) => [key, this[key]]));
  }

  static #assertBound(key, value) {
    const bounds = BOUNDS[key];
    if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
      throw BundleLimits.#invalid('Bundle limit is outside its supported range', {
        field: key,
        value,
        ...bounds,
      });
    }
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.BUNDLE_LIMIT_INVALID, meta);
  }
}
