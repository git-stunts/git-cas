/**
 * No-op observability adapter. All methods are empty.
 * Used as the default when no observability is configured.
 */
export default class SilentObserver {
  /**
   * @param {string} _channel - Metric channel.
   * @param {Record<string, unknown>} _data - Metric payload.
   */
  metric(_channel, _data) {}

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
}
