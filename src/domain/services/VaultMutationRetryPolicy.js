import { CasError, ErrorCodes } from '../errors/index.js';

export const DEFAULT_VAULT_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_VAULT_RETRY_BASE_DELAY_MS = 50;

/**
 * Retry policy for optimistic vault mutation conflicts.
 */
export default class VaultMutationRetryPolicy {
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
    maxAttempts = DEFAULT_VAULT_RETRY_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_VAULT_RETRY_BASE_DELAY_MS,
    random = Math.random,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = {}) {
    VaultMutationRetryPolicy.#assertPositiveInteger('maxAttempts', maxAttempts);
    VaultMutationRetryPolicy.#assertNonNegativeNumber('baseDelayMs', baseDelayMs);
    VaultMutationRetryPolicy.#assertFunction('random', random);
    VaultMutationRetryPolicy.#assertFunction('sleep', sleep);
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
    return err instanceof CasError && err.code === ErrorCodes.VAULT_CONFLICT;
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

  /**
   * @param {string} label
   * @param {unknown} value
   * @returns {void}
   */
  static #assertPositiveInteger(label, value) {
    if (!Number.isInteger(value) || value < 1) {
      throw new CasError(
        `Vault retry ${label} must be a positive integer`,
        ErrorCodes.VAULT_RETRY_POLICY_INVALID,
        { [label]: value },
      );
    }
  }

  /**
   * @param {string} label
   * @param {unknown} value
   * @returns {void}
   */
  static #assertNonNegativeNumber(label, value) {
    if (!Number.isFinite(value) || value < 0) {
      throw new CasError(
        `Vault retry ${label} must be a non-negative number`,
        ErrorCodes.VAULT_RETRY_POLICY_INVALID,
        { [label]: value },
      );
    }
  }

  /**
   * @param {string} label
   * @param {unknown} value
   * @returns {void}
   */
  static #assertFunction(label, value) {
    if (typeof value !== 'function') {
      throw new CasError(
        `Vault retry ${label} must be a function`,
        ErrorCodes.VAULT_RETRY_POLICY_INVALID,
        { [`${label}Type`]: typeof value },
      );
    }
  }
}
