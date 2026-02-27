/**
 * Counting semaphore for limiting concurrency.
 */
export default class Semaphore {
  #max;
  #active = 0;
  #queue = [];

  /**
   * @param {number} concurrency - Maximum concurrent permits.
   */
  constructor(concurrency) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('Semaphore concurrency must be a positive integer');
    }
    this.#max = concurrency;
  }

  /**
   * Acquire a permit, waiting if necessary.
   * @returns {Promise<void>}
   */
  acquire() {
    if (this.#active < this.#max) {
      this.#active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#queue.push(resolve);
    });
  }

  /**
   * Release a permit.
   */
  release() {
    if (this.#queue.length > 0) {
      const next = this.#queue.shift();
      next();
    } else {
      this.#active--;
    }
  }
}
