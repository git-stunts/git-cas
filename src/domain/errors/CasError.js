/**
 * Base error class for CAS operations.
 *
 * Carries a machine-readable `code` and an optional `meta` bag for
 * structured error context.
 */
export default class CasError extends Error {
  /**
   * @param {string|{ message: string, code: string, meta?: Object, documentationUrl?: string }} messageOrOptions - Error message or structured options.
   * @param {string} [code] - Machine-readable error code (e.g. `'INTEGRITY_ERROR'`).
   * @param {Object} [meta={}] - Arbitrary metadata for diagnostics.
   */
  constructor(messageOrOptions, code, meta = {}) {
    const normalized = normalizeCasErrorArgs(messageOrOptions, code, meta);
    super(normalized.message);
    this.name = this.constructor.name;
    this.code = normalized.code;
    this.meta = normalized.meta;
    if (normalized.documentationUrl) {
      this.documentationUrl = normalized.documentationUrl;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    const serialized = {
      name: this.name,
      message: this.message,
      code: this.code,
    };
    if (this.documentationUrl) {
      serialized.documentationUrl = this.documentationUrl;
    }
    if (this.meta && typeof this.meta === 'object' && Object.keys(this.meta).length > 0) {
      serialized.meta = this.meta;
    }
    return serialized;
  }
}

/**
 * @param {string|{ message: string, code: string, meta?: Object, documentationUrl?: string }} messageOrOptions
 * @param {string|undefined} code
 * @param {Object} meta
 * @returns {{ message: string, code: string, meta: Object, documentationUrl?: string }}
 */
function normalizeCasErrorArgs(messageOrOptions, code, meta) {
  if (typeof messageOrOptions === 'object' && messageOrOptions !== null) {
    return {
      message: messageOrOptions.message,
      code: messageOrOptions.code,
      meta: messageOrOptions.meta ?? {},
      documentationUrl: messageOrOptions.documentationUrl,
    };
  }
  return { message: messageOrOptions, code, meta };
}
