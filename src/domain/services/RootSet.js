import CasError from '../errors/CasError.js';
import { ErrorCodes } from '../errors/index.js';
import Oid from '../value-objects/Oid.js';
import RootSetRef from '../value-objects/RootSetRef.js';
import RootSetMetadataCodec from './RootSetMetadataCodec.js';
import RootSetRetryPolicy from './RootSetRetryPolicy.js';

const EXPECTED_HEAD_UNSET = Symbol('expected-head-unset');

/**
 * Mutable, current-generation set of Git reachability roots.
 */
export default class RootSet {
  #metadataCodec;
  #retry;

  /**
   * @param {object} options
   * @param {string} options.ref
   * @param {object} options.persistence
   * @param {RootSetRetryPolicy|object} [options.retry]
   * @param {RootSetMetadataCodec} [options.metadataCodec]
   */
  constructor({
    ref,
    persistence,
    retry,
    metadataCodec = new RootSetMetadataCodec(),
  }) {
    this.ref = RootSetRef.from(ref).toString();
    RootSet.#validatePersistence(persistence);
    this.persistence = persistence;
    this.#metadataCodec = metadataCodec;
    this.#retry = retry instanceof RootSetRetryPolicy ? retry : new RootSetRetryPolicy(retry);
    Object.freeze(this);
  }

  /**
   * @returns {Promise<{ ref: string, headOid: string|null, treeOid: string|null, entries: Array<object> }>}
   */
  async read() {
    const state = await this.persistence.read();
    return { ...state, entries: state.entries.map((entry) => ({ ...entry })) };
  }

  /**
   * @returns {Promise<Array<object>>}
   */
  async list() {
    return (await this.read()).entries;
  }

  /**
   * @param {string} name
   * @returns {Promise<boolean>}
   */
  async contains(name) {
    return (await this.list()).some((entry) => entry.name === name);
  }

  /**
   * @param {object} entry
   * @returns {Promise<object>}
   */
  async put(entry) {
    const normalizedEntry = this.#metadataCodec.normalizeEntries([entry])[0];
    let previous = null;
    const result = await this.#mutateEntries((entries) => {
      const byName = new Map(entries.map((current) => [current.name, current]));
      previous = byName.get(normalizedEntry.name) ?? null;
      byName.set(normalizedEntry.name, normalizedEntry);
      return byName.values();
    }, `root-set: put ${normalizedEntry.name}`);
    return { ...result, entry: normalizedEntry, previous };
  }

  /**
   * @param {{ name: string }} options
   * @returns {Promise<object>}
   */
  async remove({ name }) {
    let removed = null;
    const result = await this.#mutateEntries((entries) => {
      const next = [];
      for (const entry of entries) {
        if (entry.name === name) {
          removed = entry;
        } else {
          next.push(entry);
        }
      }
      return next;
    }, `root-set: remove ${name}`);
    return { ...result, removed };
  }

  /**
   * @param {{ entries: Iterable<object>, expectedHeadOid?: string|null }} options
   * @returns {Promise<object>}
   */
  async replace({ entries, expectedHeadOid = EXPECTED_HEAD_UNSET }) {
    const desired = this.#metadataCodec.normalizeEntries(entries);
    return await this.#mutateEntries(
      () => desired,
      'root-set: replace current roots',
      RootSet.#normalizeExpectedHead(expectedHeadOid),
    );
  }

  /**
   * @param {(entries: ReadonlyArray<object>) => Iterable<object>|Promise<Iterable<object>>} mutator
   * @param {{ expectedHeadOid?: string|null }} [options]
   * @returns {Promise<object>}
   */
  async mutate(mutator, { expectedHeadOid = EXPECTED_HEAD_UNSET } = {}) {
    if (typeof mutator !== 'function') {
      throw new CasError(
        'Root-set mutator must be a function',
        ErrorCodes.ROOT_SET_ENTRY_INVALID,
        { mutatorType: typeof mutator },
      );
    }
    return await this.#mutateEntries(async (entries) => (
      await mutator(Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))))
    ), 'root-set: mutate current roots', RootSet.#normalizeExpectedHead(expectedHeadOid));
  }

  /**
   * Reports whether the current ref, commit, metadata, and reachability tree
   * agree. It does not mutate the repository.
   *
   * @returns {Promise<object>}
   */
  async doctor() {
    try {
      const state = await this.read();
      const targetReport = await this.persistence.inspectTargets(state.entries);
      return {
        healthy: targetReport.healthy,
        ref: this.ref,
        headOid: state.headOid,
        treeOid: state.treeOid,
        entryCount: state.entries.length,
        entries: state.entries,
        policyCounts: RootSet.#policyCounts(state.entries),
        reachabilityCounts: {
          anchored: targetReport.targets.filter((target) => target.exists === true).length,
          missing: targetReport.targets.filter((target) => target.exists === false).length,
          unknown: targetReport.targets.filter((target) => target.exists === null).length,
          orphaned: 0,
          volatile: 0,
        },
        targets: targetReport.targets,
        issues: targetReport.issues.map(RootSet.#publicIssue),
      };
    } catch (err) {
      return {
        healthy: false,
        ref: this.ref,
        error: {
          code: err?.code ?? ErrorCodes.ROOT_SET_HEAD_INVALID,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  /**
   * Replaces a missing or malformed head from an authoritative entry list.
   * This deliberately does not trust the current metadata.
   *
   * @param {{ entries: Iterable<object> }} options
   * @returns {Promise<object>}
   */
  async repair({ entries }) {
    const desired = this.#metadataCodec.normalizeEntries(entries);
    for (let attempt = 0; attempt < this.#retry.maxAttempts; attempt++) {
      const expectedHeadOid = await this.persistence.resolveRefOnly();
      try {
        const written = await this.persistence.write({
          entries: desired,
          expectedHeadOid,
          message: 'root-set: repair current roots',
        });
        return { repaired: true, ...written };
      } catch (err) {
        await this.#handleConflict(err, attempt);
      }
    }
    throw new CasError('Root-set repair attempts exhausted', ErrorCodes.ROOT_SET_CONFLICT);
  }

  async #mutateEntries(transform, message, expectedHeadOid = EXPECTED_HEAD_UNSET) {
    for (let attempt = 0; attempt < this.#retry.maxAttempts; attempt++) {
      const state = await this.read();
      this.#assertExpectedHead(state.headOid, expectedHeadOid);
      const entries = this.#metadataCodec.normalizeEntries(await transform(state.entries));
      if (RootSet.#entriesEqual(state.entries, entries)) {
        return {
          changed: false,
          commitOid: state.headOid,
          treeOid: state.treeOid,
          entries,
        };
      }
      try {
        const written = await this.persistence.write({
          entries,
          expectedHeadOid: state.headOid,
          message,
        });
        return { changed: true, ...written };
      } catch (err) {
        if (expectedHeadOid !== EXPECTED_HEAD_UNSET) {
          throw err;
        }
        await this.#handleConflict(err, attempt);
      }
    }
    throw new CasError('Root-set mutation attempts exhausted', ErrorCodes.ROOT_SET_CONFLICT);
  }

  async #handleConflict(err, attempt) {
    const finalAttempt = attempt + 1 >= this.#retry.maxAttempts;
    if (!this.#retry.isRetryable(err) || finalAttempt) {
      throw err;
    }
    await this.#retry.waitBeforeRetry(attempt);
  }

  #assertExpectedHead(actualHeadOid, expectedHeadOid) {
    if (expectedHeadOid === EXPECTED_HEAD_UNSET || actualHeadOid === expectedHeadOid) {
      return;
    }
    throw new CasError(
      'Root-set head does not match the caller expectation',
      ErrorCodes.ROOT_SET_CONFLICT,
      { ref: this.ref, expectedHeadOid, actualHeadOid },
    );
  }

  static #normalizeExpectedHead(expectedHeadOid) {
    if (expectedHeadOid === EXPECTED_HEAD_UNSET || expectedHeadOid === null) {
      return expectedHeadOid;
    }
    return Oid.from(expectedHeadOid).toString();
  }

  static #entriesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  static #policyCounts(entries) {
    return entries.reduce((counts, entry) => ({
      ...counts,
      [entry.retention]: counts[entry.retention] + 1,
    }), { pinned: 0, evictable: 0 });
  }

  static #publicIssue(issue) {
    return Object.fromEntries(
      Object.entries(issue).filter(([key]) => key !== 'originalError'),
    );
  }

  static #validatePersistence(persistence) {
    const missing = ['read', 'write', 'resolveRefOnly', 'inspectTargets']
      .filter((method) => typeof persistence?.[method] !== 'function');
    if (missing.length > 0) {
      throw new CasError(
        'RootSet requires a complete RootSetPersistence',
        ErrorCodes.ROOT_SET_DEPENDENCY_INVALID,
        { missing },
      );
    }
  }
}
