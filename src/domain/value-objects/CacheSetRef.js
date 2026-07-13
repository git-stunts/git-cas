import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import CollectionNamespace from './CollectionNamespace.js';

export const CACHE_SET_REF_PREFIX = 'refs/cas/caches/';

/** Immutable ref in the managed cache-set namespace. */
export default class CacheSetRef {
  #namespace;
  #value;

  constructor(value) {
    if (typeof value !== 'string' || !value.startsWith(CACHE_SET_REF_PREFIX)) {
      throw createCasError(
        `Cache-set ref must be below ${CACHE_SET_REF_PREFIX}`,
        ErrorCodes.COLLECTION_NAMESPACE_INVALID,
        { ref: value },
      );
    }
    this.#namespace = CollectionNamespace.from(value.slice(CACHE_SET_REF_PREFIX.length));
    this.#value = `${CACHE_SET_REF_PREFIX}${this.#namespace}`;
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof CacheSetRef ? value : new CacheSetRef(value);
  }

  static forNamespace(namespace) {
    return new CacheSetRef(`${CACHE_SET_REF_PREFIX}${CollectionNamespace.from(namespace)}`);
  }

  get namespace() {
    return this.#namespace.toString();
  }

  toString() {
    return this.#value;
  }
}
