import createCasError from '../errors/createCasError.js';

const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * Immutable Git object identifier value object.
 */
export default class Oid {
  #value;

  /**
   * @param {string} value
   */
  constructor(value) {
    if (typeof value !== 'string' || !OID_PATTERN.test(value)) {
      throw createCasError('Git OID must be a 40- or 64-character hexadecimal string', 'INVALID_OID', { oid: value });
    }
    this.#value = value.toLowerCase();
    Object.freeze(this);
  }

  /**
   * @param {string|Oid} value
   * @returns {Oid}
   */
  static from(value) {
    return value instanceof Oid ? value : new Oid(value);
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  static isValid(value) {
    return typeof value === 'string' && OID_PATTERN.test(value);
  }

  /**
   * @returns {string}
   */
  toString() {
    return this.#value;
  }
}
