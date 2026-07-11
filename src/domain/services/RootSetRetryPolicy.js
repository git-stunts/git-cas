import CasError from '../errors/CasError.js';
import { ErrorCodes } from '../errors/index.js';

export const DEFAULT_ROOT_SET_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_ROOT_SET_RETRY_BASE_DELAY_MS = 25;

/**
 * Retry policy for optimistic root-set mutations.
 */
export default class RootSetRetryPolicy {
  #maxAttempts;
  #baseDelayMs;
  #random;
  #sleep;

  /**
   * @param {object} [options]
   * @param {number} [options.maxAttempts]
   * @param {number} [options.baseDelayMs]
   * @param {() => number} [options.random]
   * @param {(delayMs: number) => Promise<void>} [options.sleep]
   */
  constructor({
    maxAttempts = DEFAULT_ROOT_SET_RETRY_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_ROOT_SET_RETRY_BASE_DELAY_MS,
    random = Math.random,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = {}) {
    RootSetRetryPolicy.#assertPositiveInteger('maxAttempts', maxAttempts);
    RootSetRetryPolicy.#assertNonNegativeNumber('baseDelayMs', baseDelayMs);
    RootSetRetryPolicy.#assertFunction('random', random);
    RootSetRetryPolicy.#assertFunction('sleep', sleep);
    this.#maxAttempts = maxAttempts;
    this.#baseDelayMs = baseDelayMs;
    this.#random = random;
    this.#sleep = sleep;
    Object.freeze(this);
  }

  get maxAttempts() {
    return this.#maxAttempts;
  }

  /**
   * @param {unknown} err
   * @returns {boolean}
   */
  isRetryable(err) {
    return err instanceof CasError && err.code === ErrorCodes.ROOT_SET_CONFLICT;
  }

  /**
   * @param {number} attempt
   * @returns {Promise<void>}
   */
  async waitBeforeRetry(attempt) {
    const exponentialDelay = this.#baseDelayMs * (2 ** attempt);
    const jitter = Math.floor(this.#random() * (exponentialDelay / 2));
    await this.#sleep(exponentialDelay + jitter);
  }

  static #assertPositiveInteger(label, value) {
    if (!Number.isInteger(value) || value < 1) {
      throw RootSetRetryPolicy.#invalid(label, value, 'a positive integer');
    }
  }

  static #assertNonNegativeNumber(label, value) {
    if (!Number.isFinite(value) || value < 0) {
      throw RootSetRetryPolicy.#invalid(label, value, 'a non-negative number');
    }
  }

  static #assertFunction(label, value) {
    if (typeof value !== 'function') {
      throw RootSetRetryPolicy.#invalid(label, value, 'a function');
    }
  }

  static #invalid(label, value, expectation) {
    return new CasError(
      `Root-set retry ${label} must be ${expectation}`,
      ErrorCodes.ROOT_SET_RETRY_POLICY_INVALID,
      { [label]: value },
    );
  }
}
