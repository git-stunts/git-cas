import { utf8ByteLength } from '../encoding/utf8.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';

const MAX_CACHE_KEY_BYTES = 1024;

/** Immutable canonical cache key. */
export default class CacheKey {
  #value;

  constructor(value) {
    if (!CacheKey.isValid(value)) {
      throw createCasError(
        'Cache key must be canonical Unicode without control characters',
        ErrorCodes.CACHE_KEY_INVALID,
        { key: value },
      );
    }
    this.#value = value;
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof CacheKey ? value : new CacheKey(value);
  }

  static isValid(value) {
    return typeof value === 'string' &&
      value.length > 0 &&
      CacheKey.#isWellFormed(value) &&
      value.normalize('NFC') === value &&
      utf8ByteLength(value) <= MAX_CACHE_KEY_BYTES &&
      !CacheKey.#hasControl(value);
  }

  static #hasControl(value) {
    return [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    });
  }

  static #isWellFormed(value) {
    for (let index = 0; index < value.length; index++) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
          return false;
        }
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        return false;
      }
    }
    return true;
  }

  toString() {
    return this.#value;
  }
}
