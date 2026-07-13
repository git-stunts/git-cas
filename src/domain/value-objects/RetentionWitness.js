import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import isCanonicalUtcTimestamp from '../helpers/isCanonicalUtcTimestamp.js';
import AssetHandle from './AssetHandle.js';
import Oid from './Oid.js';

const POLICIES = Object.freeze(['pinned', 'evictable']);
const REACHABILITY = Object.freeze(['anchored', 'orphaned', 'volatile']);
const ROOT_KINDS = Object.freeze(['root-set', 'publication', 'cache-set', 'expiring-set']);

/**
 * Immutable evidence that one observed Git generation retained a handle.
 */
export default class RetentionWitness {
  /**
   * @param {object} value
   * @param {AssetHandle|string|object} value.handle
   * @param {'pinned'|'evictable'} value.policy
   * @param {'anchored'|'orphaned'|'volatile'} value.reachability
   * @param {object} value.root
   * @param {string} value.observedAt
   */
  constructor({ handle, policy, reachability, root, observedAt }) {
    if (!POLICIES.includes(policy)) {
      throw RetentionWitness.#invalid('Retention witness policy must be pinned or evictable', {
        policy,
      });
    }
    if (!REACHABILITY.includes(reachability)) {
      throw RetentionWitness.#invalid('Retention witness has an invalid reachability state', {
        reachability,
      });
    }
    const normalizedRoot = RetentionWitness.#normalizeRoot(root);
    RetentionWitness.#assertTimestamp(observedAt);

    this.version = 1;
    this.handle = AssetHandle.from(handle);
    this.policy = policy;
    this.reachability = reachability;
    this.root = Object.freeze(normalizedRoot);
    this.observedAt = observedAt;
    Object.freeze(this);
  }

  /**
   * @returns {object}
   */
  toJSON() {
    return {
      version: this.version,
      handle: this.handle.toString(),
      policy: this.policy,
      reachability: this.reachability,
      root: { ...this.root },
      observedAt: this.observedAt,
    };
  }

  static #normalizeRoot(root) {
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      throw RetentionWitness.#invalid('Retention witness root must be an object', { root });
    }
    if (!ROOT_KINDS.includes(root.kind)) {
      throw RetentionWitness.#invalid('Retention witness root kind is invalid', { root });
    }
    for (const field of ['namespace', 'ref', 'path']) {
      if (typeof root[field] !== 'string' || root[field].length === 0) {
        throw RetentionWitness.#invalid(`Retention witness root ${field} is required`, { root });
      }
    }
    if (!root.ref.startsWith('refs/')) {
      throw RetentionWitness.#invalid('Retention witness root ref must be fully qualified', {
        root,
      });
    }
    let generation;
    try {
      generation = Oid.from(root.generation).toString();
    } catch (error) {
      throw RetentionWitness.#invalid('Retention witness root generation is invalid', {
        root,
        originalError: error,
      });
    }
    return {
      kind: root.kind,
      namespace: root.namespace,
      ref: root.ref,
      generation,
      path: root.path,
    };
  }

  static #assertTimestamp(value) {
    if (!isCanonicalUtcTimestamp(value)) {
      throw RetentionWitness.#invalid(
        'Retention witness observation time must be a canonical UTC timestamp',
        {
          observedAt: value,
        }
      );
    }
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.RETENTION_WITNESS_INVALID, meta);
  }
}
