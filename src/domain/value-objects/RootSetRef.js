import CasError from '../errors/CasError.js';
import { ErrorCodes } from '../errors/index.js';

export const ROOT_SET_REF_PREFIX = 'refs/cas/rootsets/';
const FORBIDDEN_REF_CHARS = '~^:?*[\\';

/**
 * Immutable, validated ref in the git-cas root-set namespace.
 */
export default class RootSetRef {
  #value;

  /**
   * @param {string} value
   */
  constructor(value) {
    if (!RootSetRef.isValid(value)) {
      throw new CasError(
        `Root-set ref must be a valid ref below ${ROOT_SET_REF_PREFIX}`,
        ErrorCodes.ROOT_SET_REF_INVALID,
        { ref: value, prefix: ROOT_SET_REF_PREFIX },
      );
    }
    this.#value = value;
    Object.freeze(this);
  }

  /**
   * @param {string|RootSetRef} value
   * @returns {RootSetRef}
   */
  static from(value) {
    return value instanceof RootSetRef ? value : new RootSetRef(value);
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  static isValid(value) {
    if (typeof value !== 'string' || !value.startsWith(ROOT_SET_REF_PREFIX)) {
      return false;
    }
    const suffix = value.slice(ROOT_SET_REF_PREFIX.length);
    if (RootSetRef.#hasInvalidSuffixShape(suffix) || RootSetRef.#hasForbiddenChar(suffix)) {
      return false;
    }
    return suffix.split('/').every(RootSetRef.#isValidComponent);
  }

  static #hasInvalidSuffixShape(suffix) {
    return [
      suffix.length === 0,
      suffix.startsWith('/'),
      suffix.endsWith('/'),
      suffix.endsWith('.'),
      suffix.includes('//'),
      suffix.includes('..'),
      suffix.includes('@{'),
    ].some(Boolean);
  }

  static #hasForbiddenChar(value) {
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint <= 0x20 || codePoint === 0x7f || FORBIDDEN_REF_CHARS.includes(character)) {
        return true;
      }
    }
    return false;
  }

  static #isValidComponent(component) {
    return [
      component.length > 0,
      component !== '.',
      component !== '..',
      !component.endsWith('.lock'),
    ].every(Boolean);
  }

  /**
   * @returns {string}
   */
  toString() {
    return this.#value;
  }
}
