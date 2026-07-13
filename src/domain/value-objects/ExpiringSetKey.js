import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import isCanonicalCollectionKey from '../helpers/isCanonicalCollectionKey.js';

/** Immutable canonical input key for a replay-safe ExpiringSet. */
export default class ExpiringSetKey {
  #value;

  constructor(value) {
    if (!isCanonicalCollectionKey(value)) {
      throw createCasError(
        'ExpiringSet key must be canonical Unicode without control characters',
        ErrorCodes.EXPIRING_SET_KEY_INVALID,
        { key: value },
      );
    }
    this.#value = value;
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof ExpiringSetKey ? value : new ExpiringSetKey(value);
  }

  toString() {
    return this.#value;
  }
}
