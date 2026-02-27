/**
 * Abstract port for observability (metrics, logging, tracing).
 * @abstract
 */
export default class ObservabilityPort {
  /**
   * Emit a metric on the given channel.
   * @param {string} _channel - Metric channel (e.g. 'chunk', 'file', 'integrity', 'error').
   * @param {Object} _data - Metric payload.
   */
  metric(_channel, _data) {
    throw new Error('Not implemented');
  }

  /**
   * Log a message at the given level.
   * @param {'debug'|'info'|'warn'|'error'} _level
   * @param {string} _msg
   * @param {Object} [_meta]
   */
  log(_level, _msg, _meta) {
    throw new Error('Not implemented');
  }

  /**
   * Start a named span for tracing.
   * @param {string} _name
   * @returns {{ end(meta?: Object): void }}
   */
  span(_name) {
    throw new Error('Not implemented');
  }
}
