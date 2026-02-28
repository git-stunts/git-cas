/**
 * Observability adapter that bridges metrics to an EventEmitter.
 *
 * Maps `metric('chunk', { action: 'stored', ... })` → `emit('chunk:stored', ...)`.
 * Exposes `.on()`, `.removeListener()`, `.listenerCount()` for backward compatibility
 * with code that previously subscribed directly to CasService events.
 */
import { EventEmitter } from 'node:events';

export default class EventEmitterObserver {
  #emitter = new EventEmitter();

  /**
   * Route a metric to the underlying EventEmitter.
   *
   * Error metrics are only emitted when listeners are attached (matching
   * the previous CasService behavior that guarded `this.emit('error', ...)`).
   *
   * @param {string} channel - Metric channel.
   * @param {Record<string, unknown> & { action: string }} data - Must include `action` to form the event name.
   */
  metric(channel, data) {
    if (channel === 'error') {
      if (this.#emitter.listenerCount('error') > 0) {
        this.#emitter.emit('error', data);
      }
      return;
    }
    if (typeof data.action !== 'string') {
      return;
    }
    const eventName = `${channel}:${data.action}`;
    const payload = Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'action'));
    this.#emitter.emit(eventName, payload);
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
   * Subscribe to an event.
   * @param {string} event - Event name.
   * @param {(...args: unknown[]) => void} listener - Event listener.
   * @returns {this}
   */
  on(event, listener) {
    this.#emitter.on(event, listener);
    return this;
  }

  /**
   * Remove a listener.
   * @param {string} event - Event name.
   * @param {(...args: unknown[]) => void} listener - Event listener.
   * @returns {this}
   */
  removeListener(event, listener) {
    this.#emitter.removeListener(event, listener);
    return this;
  }

  /**
   * Return the number of listeners for an event.
   * @param {string} event - Event name.
   * @returns {number}
   */
  listenerCount(event) {
    return this.#emitter.listenerCount(event);
  }
}
