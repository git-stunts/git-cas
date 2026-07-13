import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import assertCanonicalTimestamp from '../helpers/assertCanonicalTimestamp.js';
import parseApplicationHandle from './ApplicationHandle.js';
import CacheKey from './CacheKey.js';
import Oid from './Oid.js';
import RetentionWitness from './RetentionWitness.js';

const RETENTION = Object.freeze(['pinned', 'evictable']);

/** Immutable result for one live cache entry. */
export default class CacheHit {
  constructor(value) {
    CacheHit.#assertValue(value);
    const key = CacheKey.from(value.key).toString();
    const handle = parseApplicationHandle(value.handle);
    const evidence = value.evidence instanceof RetentionWitness
      ? value.evidence
      : new RetentionWitness(value.evidence);
    const generation = Oid.from(value.generation).toString();
    CacheHit.#assertEvidence({ value, handle, evidence, generation });
    this.key = key;
    this.handle = handle;
    this.policy = value.policy;
    this.expiresAt = value.expiresAt;
    this.logicalBytes = value.logicalBytes;
    this.createdAt = value.createdAt;
    this.accessedAt = value.accessedAt;
    this.generation = generation;
    this.evidence = evidence;
    Object.freeze(this);
  }

  toJSON() {
    return {
      key: this.key,
      handle: this.handle.toString(),
      policy: this.policy,
      expiresAt: this.expiresAt,
      logicalBytes: this.logicalBytes,
      createdAt: this.createdAt,
      accessedAt: this.accessedAt,
      generation: this.generation,
      evidence: this.evidence.toJSON(),
    };
  }

  static #assertValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw CacheHit.#invalid('Cache hit must be an object', { value });
    }
    if (typeof value.key !== 'string' || value.key.length === 0) {
      throw CacheHit.#invalid('Cache hit key must be a non-empty string', { key: value.key });
    }
    if (!RETENTION.includes(value.policy)) {
      throw CacheHit.#invalid('Cache hit policy must be pinned or evictable', { policy: value.policy });
    }
    if (!Number.isSafeInteger(value.logicalBytes) || value.logicalBytes < 0) {
      throw CacheHit.#invalid('Cache hit logicalBytes must be a non-negative safe integer', {
        logicalBytes: value.logicalBytes,
      });
    }
    CacheHit.#assertTimestamp(value.expiresAt, true);
    CacheHit.#assertTimestamp(value.createdAt, false);
    CacheHit.#assertTimestamp(value.accessedAt, false);
  }

  static #assertTimestamp(value, nullable) {
    if (nullable && value === null) {
      return;
    }
    assertCanonicalTimestamp(value, {
      invalid: CacheHit.#invalid,
      message: 'Cache hit timestamps must be canonical UTC timestamps',
    });
  }

  static #assertEvidence({ value, handle, evidence, generation }) {
    if (evidence.policy !== value.policy ||
        evidence.root.generation !== generation ||
        evidence.handle.toString() !== handle.toString() ||
        evidence.root.kind !== 'cache-set') {
      throw CacheHit.#invalid('Cache hit evidence does not match its entry', {
        policy: value.policy,
        generation,
      });
    }
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.CACHE_ENTRY_INVALID, meta);
  }
}
