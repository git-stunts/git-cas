import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import assertCanonicalTimestamp from '../helpers/assertCanonicalTimestamp.js';
import CollectionNamespace from './CollectionNamespace.js';

export const CACHE_ACQUISITION_REF_PREFIX = 'refs/cas/cache-acquisitions/';

const ID_PATTERN = /^v1-(\d{13})-([0-9a-f]{64})-([0-9a-f]{32})$/u;

/** Immutable identity for one scoped cache-generation anchor. */
export default class CacheAcquisitionRef {
  #acquiredAt;
  #id;
  #keyDigest;
  #namespace;
  #value;

  constructor(value) {
    if (typeof value !== 'string' || !value.startsWith(CACHE_ACQUISITION_REF_PREFIX)) {
      throw invalid('Cache acquisition ref is outside its managed namespace', { ref: value });
    }
    const parts = value.slice(CACHE_ACQUISITION_REF_PREFIX.length).split('/');
    const id = parts.pop();
    if (!id || parts.length === 0) {
      throw invalid('Cache acquisition ref must include a cache namespace and ID', { ref: value });
    }
    const match = ID_PATTERN.exec(id);
    if (!match) {
      throw invalid('Cache acquisition ID is invalid', { ref: value, id });
    }
    const acquiredAt = new Date(Number(match[1])).toISOString();
    this.#namespace = acquisitionNamespace(parts.join('/'), { ref: value, id });
    this.#id = id;
    this.#acquiredAt = acquiredAt;
    this.#keyDigest = match[2];
    this.#value = `${CACHE_ACQUISITION_REF_PREFIX}${this.#namespace}/${id}`;
    Object.freeze(this);
  }

  static create({ namespace, keyDigest, acquiredAt, nonce }) {
    assertCanonicalTimestamp(acquiredAt, {
      invalid,
      message: 'Cache acquisition time must be a canonical UTC timestamp',
    });
    if (typeof keyDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(keyDigest)) {
      throw invalid('Cache acquisition key digest is invalid', { keyDigest });
    }
    if (typeof nonce !== 'string' || !/^[0-9a-f]{32}$/u.test(nonce)) {
      throw invalid('Cache acquisition nonce is invalid', { nonce });
    }
    const epoch = String(Date.parse(acquiredAt)).padStart(13, '0');
    return new CacheAcquisitionRef(
      `${CACHE_ACQUISITION_REF_PREFIX}${acquisitionNamespace(namespace, { namespace })}`
      + `/v1-${epoch}-${keyDigest}-${nonce}`,
    );
  }

  static from(value) {
    return value instanceof CacheAcquisitionRef ? value : new CacheAcquisitionRef(value);
  }

  static forId({ namespace, id }) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw invalid('Cache acquisition ID is invalid', { namespace, id });
    }
    return new CacheAcquisitionRef(
      `${CACHE_ACQUISITION_REF_PREFIX}${acquisitionNamespace(namespace, { namespace, id })}/${id}`,
    );
  }

  get acquiredAt() {
    return this.#acquiredAt;
  }

  get id() {
    return this.#id;
  }

  get keyDigest() {
    return this.#keyDigest;
  }

  get namespace() {
    return this.#namespace.toString();
  }

  toString() {
    return this.#value;
  }
}

function invalid(message, meta) {
  return createCasError(message, ErrorCodes.CACHE_ACQUISITION_INVALID, meta);
}

function acquisitionNamespace(value, meta) {
  try {
    return CollectionNamespace.from(value);
  } catch (error) {
    throw invalid('Cache acquisition namespace is invalid', {
      ...meta,
      namespace: value,
      originalError: error,
    });
  }
}
