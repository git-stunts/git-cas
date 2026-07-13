const SAMPLE_LIMIT = 32;

/**
 * Bounded evidence about objects written before a durable root exists.
 */
export default class StagingEvidence {
  #handles = [];
  #handleCount = 0;
  #objectCount = 0;
  #objects = [];

  /** @param {string} oid @param {string} type */
  record(oid, type) {
    this.#objectCount += 1;
    if (this.#objects.length < SAMPLE_LIMIT) {
      this.#objects.push(Object.freeze({ oid, type }));
    }
  }

  /** @param {{ toString(): string }} handle */
  recordHandle(handle) {
    this.#handleCount += 1;
    if (this.#handles.length < SAMPLE_LIMIT) {
      this.#handles.push(handle.toString());
    }
  }

  /** @returns {object} */
  snapshot() {
    return Object.freeze({
      objectCount: this.#objectCount,
      stagedHandleCount: this.#handleCount,
      objectSample: Object.freeze([...this.#objects]),
      stagedHandleSample: Object.freeze([...this.#handles]),
      sampleTruncated:
        this.#objectCount > this.#objects.length || this.#handleCount > this.#handles.length,
    });
  }
}
