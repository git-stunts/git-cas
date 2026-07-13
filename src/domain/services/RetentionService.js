import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import RootSetMetadataCodec from './RootSetMetadataCodec.js';
import RootSetRef, { ROOT_SET_REF_PREFIX } from '../value-objects/RootSetRef.js';
import RetentionWitness from '../value-objects/RetentionWitness.js';

const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });

/**
 * Converts a validated content handle into a RootSet reachability edge.
 */
export default class RetentionService {
  #clock;
  #resolveRoot;
  #rootSets;

  /**
   * @param {object} options
   * @param {{ open(options: object): import('./RootSet.js').default }} options.rootSets
   * @param {(handle: unknown) => Promise<object>} options.resolveRoot
   * @param {{ now(): Date }} [options.clock]
   */
  constructor({ rootSets, resolveRoot, clock = DEFAULT_CLOCK }) {
    RetentionService.#assertDependencies(rootSets, resolveRoot, clock);
    this.#rootSets = rootSets;
    this.#resolveRoot = resolveRoot;
    this.#clock = clock;
  }

  /**
   * @param {object} options
   * @param {unknown} options.handle
   * @param {{ ref: string, name: string }} options.root
   * @param {'pinned'|'evictable'} [options.policy]
   * @returns {Promise<{ changed: boolean, witness: RetentionWitness }>}
   */
  async retain({ handle, root, policy = 'pinned' }) {
    RetentionService.#assertRoot(root);
    const target = await this.#resolveRoot(handle);
    const rootSet = this.#rootSets.open({ ref: root.ref });
    const result = await rootSet.put({
      name: root.name,
      oid: target.oid,
      type: target.type,
      retention: policy,
    });
    const path = RetentionService.#evidencePath(result.entries, root.name);
    const witness = new RetentionWitness({
      handle: target.handle,
      policy,
      reachability: 'anchored',
      root: {
        kind: 'root-set',
        namespace: root.ref.slice(ROOT_SET_REF_PREFIX.length),
        ref: root.ref,
        generation: result.commitOid,
        path,
      },
      observedAt: this.#observedAt(),
    });
    return Object.freeze({ changed: result.changed, witness });
  }

  #observedAt() {
    const now = this.#clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw createCasError(
        'RetentionService clock returned an invalid Date',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    return now.toISOString();
  }

  static #evidencePath(entries, name) {
    const index = entries.findIndex((entry) => entry.name === name);
    if (index === -1) {
      throw createCasError(
        'Retained entry is absent from the committed root generation',
        ErrorCodes.ROOT_SET_TREE_INVALID,
        { name }
      );
    }
    return RootSetMetadataCodec.slotFor(index);
  }

  static #assertRoot(root) {
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      throw createCasError('Retention root must be an object', ErrorCodes.INVALID_OPTIONS, {
        root,
      });
    }
    if (typeof root.ref !== 'string' || typeof root.name !== 'string' || root.name.length === 0) {
      throw createCasError(
        'Retention root requires ref and name strings',
        ErrorCodes.INVALID_OPTIONS,
        { root }
      );
    }
    RootSetRef.from(root.ref);
  }

  static #assertDependencies(rootSets, resolveRoot, clock) {
    if (!rootSets || typeof rootSets.open !== 'function') {
      throw createCasError(
        'RetentionService requires a RootSet registry',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    if (typeof resolveRoot !== 'function') {
      throw createCasError(
        'RetentionService requires a handle resolver',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    if (!clock || typeof clock.now !== 'function') {
      throw createCasError('RetentionService clock must provide now()', ErrorCodes.INVALID_OPTIONS);
    }
  }
}
