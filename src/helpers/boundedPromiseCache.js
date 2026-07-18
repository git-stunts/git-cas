/**
 * Fixed-residency LRU for in-flight and completed immutable reads.
 * Rejected promises remove themselves so transient failures remain retryable.
 */
export default class BoundedPromiseCache {
  /** @type {Map<string, { promise: Promise<unknown>, weight: number }>} */
  #entries = new Map();
  #maxEntries;
  #maxWeight;
  #totalWeight = 0;
  #weightOf;

  /**
   * @param {number} maxEntries
   * @param {object} [options]
   * @param {number} [options.maxWeight=Infinity]
   * @param {(value: unknown) => number} [options.weightOf]
   */
  constructor(maxEntries, { maxWeight = Number.POSITIVE_INFINITY, weightOf = () => 0 } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError('maxEntries must be a positive safe integer');
    }
    if (
      maxWeight !== Number.POSITIVE_INFINITY &&
      (!Number.isSafeInteger(maxWeight) || maxWeight < 0)
    ) {
      throw new TypeError('maxWeight must be a non-negative safe integer or Infinity');
    }
    if (typeof weightOf !== 'function') {
      throw new TypeError('weightOf must be a function');
    }
    this.#maxEntries = maxEntries;
    this.#maxWeight = maxWeight;
    this.#weightOf = weightOf;
  }

  /**
   * @template T
   * @param {string} key
   * @param {() => Promise<T>|T} factory
   * @returns {Promise<T>}
   */
  getOrCreate(key, factory) {
    const cached = this.#entries.get(key);
    if (cached !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached.promise;
    }

    const pending = Promise.resolve().then(factory);
    const entry = { promise: pending, weight: 0 };
    this.#entries.set(key, entry);
    this.#evict();
    void pending
      .then((value) => {
        if (this.#entries.get(key) !== entry) {
          return;
        }
        entry.weight = this.#weightOf(value);
        this.#totalWeight += entry.weight;
        this.#evict();
      })
      .catch(() => {
        if (this.#entries.get(key) === entry) {
          this.#remove(key, entry);
        }
      });
    return pending;
  }

  #evict() {
    while (this.#entries.size > this.#maxEntries || this.#totalWeight > this.#maxWeight) {
      const oldestKey = this.#entries.keys().next().value;
      const oldest = this.#entries.get(oldestKey);
      this.#remove(oldestKey, oldest);
    }
  }

  #remove(key, entry) {
    if (entry === undefined || !this.#entries.delete(key)) {
      return;
    }
    this.#totalWeight -= entry.weight;
  }
}
