/**
 * Base error class for CAS operations.
 *
 * Carries a machine-readable `code` and an optional `meta` bag for
 * structured error context.
 */
export default class CasError extends Error {
  /**
   * @param {string} message - Human-readable error description.
   * @param {string} code - Machine-readable error code (e.g. `'INTEGRITY_ERROR'`).
   * @param {Object} [meta={}] - Arbitrary metadata for diagnostics.
   */
  constructor(message, code, meta = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.meta = meta;
    Error.captureStackTrace(this, this.constructor);
  }
}
