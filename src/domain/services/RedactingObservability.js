const REDACTED = '[REDACTED]';
const SENSITIVE_FIELD_NAMES = new Set([
  'ciphertext',
  'dek',
  'encryptionkey',
  'key',
  'kek',
  'newpassphrase',
  'nonce',
  'oldpassphrase',
  'passphrase',
  'password',
  'privatekey',
  'salt',
  'secret',
  'tag',
  'token',
  'vaultencryptionkey',
  'wrappeddek',
]);

/**
 * Observability decorator that strips sensitive metadata before it leaves the
 * domain service boundary.
 */
export default class RedactingObservability {
  #inner;

  /**
   * @param {import('../../ports/ObservabilityPort.js').default} inner
   */
  constructor(inner) {
    this.#inner = inner;
    Object.freeze(this);
  }

  /**
   * @param {import('../../ports/ObservabilityPort.js').default} inner
   * @returns {RedactingObservability}
   */
  static wrap(inner) {
    return inner instanceof RedactingObservability ? inner : new RedactingObservability(inner);
  }

  /**
   * @param {string} channel
   * @param {Record<string, unknown>} data
   */
  metric(channel, data) {
    this.#inner.metric(channel, RedactingObservability.redact(data));
  }

  /**
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} msg
   * @param {Record<string, unknown>} [meta]
   */
  log(level, msg, meta) {
    if (meta === undefined) {
      this.#inner.log(level, msg);
      return;
    }
    this.#inner.log(level, msg, RedactingObservability.redact(meta));
  }

  /**
   * @param {string} name
   * @returns {{ end(meta?: Record<string, unknown>): void }}
   */
  span(name) {
    const span = this.#inner.span(name);
    return {
      end(meta) {
        span.end(RedactingObservability.redact(meta));
      },
    };
  }

  /**
   * @template T
   * @param {T} value
   * @returns {T}
   */
  static redact(value) {
    return /** @type {T} */ (RedactingObservability.#redactValue(value, new WeakSet()));
  }

  /**
   * @param {unknown} value
   * @param {WeakSet<object>} seen
   * @returns {unknown}
   */
  static #redactValue(value, seen) {
    if (value instanceof Uint8Array) {
      return REDACTED;
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (value instanceof Error) {
      return RedactingObservability.#redactError(value, seen);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => RedactingObservability.#redactValue(entry, seen));
    }
    return RedactingObservability.#redactObject(value, seen);
  }

  /**
   * @param {Error & Record<string, unknown>} error
   * @param {WeakSet<object>} seen
   * @returns {Record<string, unknown>}
   */
  static #redactError(error, seen) {
    const sanitized = {
      name: error.name,
      message: error.message,
    };
    if ('code' in error) {
      sanitized.code = error.code;
    }
    for (const key of Object.keys(error)) {
      if (key === 'name' || key === 'message' || key === 'code') {
        continue;
      }
      sanitized[key] = RedactingObservability.#redactField(key, error[key], seen);
    }
    return sanitized;
  }

  /**
   * @param {object} object
   * @param {WeakSet<object>} seen
   * @returns {Record<string, unknown>}
   */
  static #redactObject(object, seen) {
    const sanitized = {};
    for (const [key, fieldValue] of Object.entries(object)) {
      sanitized[key] = RedactingObservability.#redactField(key, fieldValue, seen);
    }
    return sanitized;
  }

  /**
   * @param {string} key
   * @param {unknown} value
   * @param {WeakSet<object>} seen
   * @returns {unknown}
   */
  static #redactField(key, value, seen) {
    if (RedactingObservability.#isSensitiveField(key)) {
      return REDACTED;
    }
    return RedactingObservability.#redactValue(value, seen);
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  static #isSensitiveField(key) {
    return SENSITIVE_FIELD_NAMES.has(key.toLowerCase().replaceAll(/[-_]/g, ''));
  }
}
