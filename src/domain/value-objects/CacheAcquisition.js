import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import assertCanonicalTimestamp from '../helpers/assertCanonicalTimestamp.js';
import CacheHit from './CacheHit.js';
import RetentionWitness from './RetentionWitness.js';

/** One active, explicitly releasable cache-generation retention scope. */
export default class CacheAcquisition {
  #release;
  #releasePromise = null;
  #releaseResult = null;

  constructor({ id, hit, evidence, acquiredAt, release }) {
    if (typeof id !== 'string' || id.length === 0) {
      throw invalid('Cache acquisition ID is required', { id });
    }
    if (!(hit instanceof CacheHit)) {
      throw invalid('Cache acquisition requires a CacheHit', { hit });
    }
    if (!(evidence instanceof RetentionWitness)) {
      throw invalid('Cache acquisition requires retention evidence', { evidence });
    }
    assertCanonicalTimestamp(acquiredAt, {
      invalid,
      message: 'Cache acquisition time must be a canonical UTC timestamp',
    });
    if (typeof release !== 'function') {
      throw invalid('Cache acquisition requires a release function', { release });
    }
    this.id = id;
    this.hit = hit;
    this.evidence = evidence;
    this.acquiredAt = acquiredAt;
    this.#release = release;
    Object.freeze(this);
  }

  async release() {
    if (this.#releaseResult !== null) {
      return Object.freeze({
        ...this.#releaseResult,
        changed: false,
      });
    }
    if (this.#releasePromise !== null) {
      return await this.#releasePromise;
    }
    this.#releasePromise = Promise.resolve(this.#release())
      .then((result) => {
        this.#releaseResult = result;
        return result;
      })
      .finally(() => {
        this.#releasePromise = null;
      });
    return await this.#releasePromise;
  }
}

function invalid(message, meta) {
  return createCasError(message, ErrorCodes.CACHE_ACQUISITION_INVALID, meta);
}
