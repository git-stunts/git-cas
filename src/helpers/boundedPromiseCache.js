/**
 * Fixed-residency LRU for in-flight and completed immutable reads.
 * Rejected promises remove themselves so transient failures remain retryable.
 */
export default class BoundedPromiseCache {
  /** @type {Map<string, { promise: Promise<unknown>, weight: number }>} */
  #completed = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  #inFlight = new Map();
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
   * @returns {Promise<T>|undefined}
   */
  get(key) {
    const cached = this.#completed.get(key);
    if (cached !== undefined) {
      this.#completed.delete(key);
      this.#completed.set(key, cached);
      return cached.promise;
    }
    return this.#inFlight.get(key);
  }

  /**
   * @template T
   * @param {string} key
   * @param {() => Promise<T>|T} factory
   * @returns {Promise<T>}
   */
  getOrCreate(key, factory) {
    const present = this.get(key);
    if (present !== undefined) {
      return present;
    }

    const source = Promise.resolve().then(factory);
    const tracked = source.then(
      (value) => {
        this.#removeInFlight(key, tracked);
        const weight = this.#resolvedWeight(value);
        if (weight <= this.#maxWeight) {
          const entry = { promise: Promise.resolve(value), weight };
          this.#completed.set(key, entry);
          this.#totalWeight += weight;
          this.#evictCompleted();
        }
        return value;
      },
      (error) => {
        this.#removeInFlight(key, tracked);
        throw error;
      },
    );
    this.#inFlight.set(key, tracked);
    return tracked;
  }

  #resolvedWeight(value) {
    const weight = this.#weightOf(value);
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new TypeError('weightOf must return a non-negative safe integer');
    }
    return weight;
  }

  #evictCompleted() {
    while (this.#completed.size > this.#maxEntries || this.#totalWeight > this.#maxWeight) {
      const oldestKey = this.#completed.keys().next().value;
      const oldest = this.#completed.get(oldestKey);
      this.#removeCompleted(oldestKey, oldest);
    }
  }

  #removeCompleted(key, entry) {
    if (entry === undefined || !this.#completed.delete(key)) {
      return;
    }
    this.#totalWeight -= entry.weight;
  }

  #removeInFlight(key, promise) {
    if (this.#inFlight.get(key) === promise) {
      this.#inFlight.delete(key);
    }
  }
}
