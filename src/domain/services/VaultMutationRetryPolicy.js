import CasError from '../errors/CasError.js';

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
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new CasError(
        'Vault retry maxAttempts must be a positive integer',
        'VAULT_RETRY_POLICY_INVALID',
        { maxAttempts },
      );
    }
    if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
      throw new CasError(
        'Vault retry baseDelayMs must be a non-negative number',
        'VAULT_RETRY_POLICY_INVALID',
        { baseDelayMs },
      );
    }
    this.#maxAttempts = maxAttempts;
    this.#baseDelayMs = baseDelayMs;
    this.#random = random;
    this.#sleep = sleep;
  }

  get maxAttempts() {
    return this.#maxAttempts;
  }

  /**
   * @param {unknown} err
   * @returns {boolean}
   */
  isRetryable(err) {
    return err instanceof CasError && err.code === 'VAULT_CONFLICT';
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
}
