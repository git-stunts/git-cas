/**
 * Observability adapter that accumulates metrics for later retrieval.
 */
export default class StatsCollector {
  #chunksProcessed = 0;
  #bytesTotal = 0;
  #errors = 0;
  /** @type {number|null} */
  #startTime = null;

  /**
   * @param {string} channel - Metric channel.
   * @param {Record<string, unknown>} data - Metric payload.
   */
  metric(channel, data) {
    if (!this.#startTime) {
      this.#startTime = Date.now();
    }
    if (channel === 'chunk') {
      this.#chunksProcessed++;
      const size = Number.isFinite(data?.size) ? /** @type {number} */ (data.size) : 0;
      this.#bytesTotal += size;
    }
    if (channel === 'error') {
      this.#errors++;
    }
  }

  /**
   * @param {'debug'|'info'|'warn'|'error'} _level - Log level.
   * @param {string} _msg - Log message.
   * @param {Record<string, unknown>} [_meta] - Optional metadata.
   */
  log(_level, _msg, _meta) {}

  /**
   * @param {string} _name - Span name.
   * @returns {{ end(meta?: Record<string, unknown>): void }}
   */
  span(_name) {
    return { end() {} };
  }

  /**
   * Returns accumulated statistics.
   * @returns {{ chunksProcessed: number, bytesTotal: number, elapsed: number, throughput: number, errors: number }}
   */
  summary() {
    const elapsed = this.#startTime ? (Date.now() - this.#startTime) / 1000 : 0;
    const throughput = elapsed > 0 ? this.#bytesTotal / elapsed : 0;
    return {
      chunksProcessed: this.#chunksProcessed,
      bytesTotal: this.#bytesTotal,
      elapsed,
      throughput,
      errors: this.#errors,
    };
  }
}
