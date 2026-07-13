import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import CollectionNamespace from './CollectionNamespace.js';

export const EXPIRING_SET_REF_PREFIX = 'refs/cas/expiring/';

/** Immutable ref in the managed expiring-set namespace. */
export default class ExpiringSetRef {
  #namespace;
  #value;

  constructor(value) {
    if (typeof value !== 'string' || !value.startsWith(EXPIRING_SET_REF_PREFIX)) {
      throw createCasError(
        `Expiring-set ref must be below ${EXPIRING_SET_REF_PREFIX}`,
        ErrorCodes.COLLECTION_NAMESPACE_INVALID,
        { ref: value },
      );
    }
    this.#namespace = CollectionNamespace.from(value.slice(EXPIRING_SET_REF_PREFIX.length));
    this.#value = `${EXPIRING_SET_REF_PREFIX}${this.#namespace}`;
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof ExpiringSetRef ? value : new ExpiringSetRef(value);
  }

  static forNamespace(namespace) {
    return new ExpiringSetRef(
      `${EXPIRING_SET_REF_PREFIX}${CollectionNamespace.from(namespace)}`,
    );
  }

  get namespace() {
    return this.#namespace.toString();
  }

  toString() {
    return this.#value;
  }
}
