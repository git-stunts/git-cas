import CasError from '../errors/CasError.js';
import { ErrorCodes } from '../errors/index.js';
import { errorDetailsText, isGitMissingRefError } from '../helpers/gitRefErrors.js';
import Oid from '../value-objects/Oid.js';
import RootSetRef from '../value-objects/RootSetRef.js';
import RootSetMetadataCodec, { ROOT_SET_METADATA_ENTRY } from './RootSetMetadataCodec.js';
import RootSetTreeCodec from './RootSetTreeCodec.js';

const UPDATE_REF_CONFLICT_MARKERS = Object.freeze({
  butExpected: 'but expected',
  cannotLockRef: 'cannot lock ref',
  referenceAlreadyExists: 'reference already exists',
});
const GIT_REPOSITORY_LOCKED = 'GIT_REPOSITORY_LOCKED';
const GIT_FATAL_EXIT_CODE = 128;

function hasExactUpdateRefArgs(err, {
  rootSetRef,
  newCommit,
  expectedHeadOid,
}) {
  const details = err?.details && typeof err.details === 'object' ? err.details : {};
  if (!Array.isArray(details.args)) {
    return false;
  }
  const expectedArgs = [
    'update-ref',
    '--no-deref',
    rootSetRef,
    newCommit,
    expectedHeadOid ?? '0'.repeat(newCommit.length),
  ];
  return details.args.length === expectedArgs.length &&
    expectedArgs.every((arg, index) => details.args[index] === arg);
}

function classifyStructuredUpdateRefConflict(err, {
  rootSetRef,
  newCommit,
  expectedHeadOid,
}) {
  const details = err?.details && typeof err.details === 'object' ? err.details : {};
  if (details.code !== GIT_REPOSITORY_LOCKED) {
    return null;
  }
  return hasExactUpdateRefArgs(err, { rootSetRef, newCommit, expectedHeadOid });
}

function isObservedUpdateRefConflict(err, {
  rootSetRef,
  newCommit,
  expectedHeadOid,
  actualHeadOid,
}) {
  const details = err?.details && typeof err.details === 'object' ? err.details : {};
  if (!Oid.isValid(actualHeadOid)) {
    return false;
  }
  const canonicalActualHeadOid = Oid.from(actualHeadOid).toString();
  const canonicalExpectedHeadOid = Oid.isValid(expectedHeadOid)
    ? Oid.from(expectedHeadOid).toString()
    : expectedHeadOid;
  return details.code === GIT_FATAL_EXIT_CODE &&
    canonicalActualHeadOid !== canonicalExpectedHeadOid &&
    hasExactUpdateRefArgs(err, { rootSetRef, newCommit, expectedHeadOid });
}

function hasTextualUpdateRefConflict(err, rootSetRef) {
  const normalized = errorDetailsText(err).toLowerCase();
  if (!normalized.includes(rootSetRef.toLowerCase())) {
    return false;
  }
  return normalized.includes(UPDATE_REF_CONFLICT_MARKERS.cannotLockRef) && (
    normalized.includes(UPDATE_REF_CONFLICT_MARKERS.butExpected) ||
    normalized.includes(UPDATE_REF_CONFLICT_MARKERS.referenceAlreadyExists)
  );
}

/**
 * Stateless persistence boundary for one root-set ref and snapshot format.
 */
export default class RootSetPersistence {
  /**
   * @param {object} options
   * @param {string} options.rootSetRef
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/GitRefPort.js').default} options.ref
   * @param {RootSetMetadataCodec} [options.metadataCodec]
   * @param {RootSetTreeCodec} [options.treeCodec]
   */
  constructor({
    rootSetRef,
    persistence,
    ref,
    refType = RootSetRef,
    metadataCodec = new RootSetMetadataCodec({ refType }),
    treeCodec = new RootSetTreeCodec(),
  }) {
    this.rootSetRef = refType.from(rootSetRef).toString();
    RootSetPersistence.#validateDependencies(persistence, ref);
    this.persistence = persistence;
    this.ref = ref;
    this.metadataCodec = metadataCodec;
    this.treeCodec = treeCodec;
    Object.freeze(this);
  }

  /**
   * @returns {Promise<{ commitOid: string, treeOid: string }|null>}
   */
  async resolveHead() {
    const commitOid = await this.resolveRefOnly();
    if (commitOid === null) {
      return null;
    }
    try {
      const parentOids = await this.ref.resolveParents(commitOid);
      if (parentOids.length !== 0) {
        throw new CasError(
          'Root-set head must be a parentless current-generation commit',
          ErrorCodes.ROOT_SET_HEAD_INVALID,
          { ref: this.rootSetRef, commitOid, parentOids },
        );
      }
      return { commitOid, treeOid: await this.ref.resolveTree(commitOid) };
    } catch (err) {
      if (err?.code === ErrorCodes.ROOT_SET_HEAD_INVALID) {
        throw err;
      }
      throw this.#headError('Root-set head commit does not resolve to a tree', err, { commitOid });
    }
  }

  /**
   * Resolves the ref without requiring its commit or tree to be healthy.
   * Used by authoritative repair.
   *
   * @returns {Promise<string|null>}
   */
  async resolveRefOnly() {
    try {
      return await this.ref.resolveRef(this.rootSetRef);
    } catch (err) {
      if (this.#isMissingRefError(err)) {
        return null;
      }
      throw this.#headError('Root-set ref could not be resolved', err);
    }
  }

  /**
   * @returns {Promise<{ ref: string, headOid: string|null, treeOid: string|null, entries: Array<object> }>}
   */
  async read() {
    const head = await this.resolveHead();
    if (!head) {
      return { ref: this.rootSetRef, headOid: null, treeOid: null, entries: [] };
    }

    let rawEntries;
    try {
      rawEntries = await this.persistence.readTree(head.treeOid);
    } catch (err) {
      throw new CasError(
        'Root-set tree could not be read',
        ErrorCodes.ROOT_SET_TREE_INVALID,
        { ref: this.rootSetRef, ...head, originalError: err },
      );
    }
    const metadataEntry = rawEntries.find((entry) => entry.name === ROOT_SET_METADATA_ENTRY);
    if (!metadataEntry) {
      throw new CasError(
        'Root-set tree is missing .rootset.json',
        ErrorCodes.ROOT_SET_TREE_INVALID,
        { ref: this.rootSetRef, ...head },
      );
    }

    const metadata = this.metadataCodec.decode(
      await this.persistence.readBlob(metadataEntry.oid),
      { expectedRef: this.rootSetRef },
    );
    this.treeCodec.validate(rawEntries, metadata);
    return {
      ref: this.rootSetRef,
      headOid: head.commitOid,
      treeOid: head.treeOid,
      entries: metadata.entries.map(RootSetPersistence.#publicEntry),
    };
  }

  /**
   * @param {object} options
   * @param {Iterable<object>} options.entries
   * @param {string|null} options.expectedHeadOid
   * @param {string} [options.message]
   * @returns {Promise<{ commitOid: string, treeOid: string, entries: Array<object> }>}
   */
  async write({ entries, expectedHeadOid, message = 'root-set: replace current roots' }) {
    const metadata = this.metadataCodec.create({ ref: this.rootSetRef, entries });
    await this.#assertTargets(metadata.entries.map(RootSetPersistence.#publicEntry));
    const metadataBlobOid = await this.persistence.writeBlob(
      this.metadataCodec.encode({ ref: this.rootSetRef, entries }),
    );
    const treeOid = await this.persistence.writeTree(
      this.treeCodec.toTreeLines(metadata, metadataBlobOid),
    );
    const commitOid = await this.ref.createCommit({
      treeOid,
      parentOid: null,
      message,
    });
    await this.#updateRef({ commitOid, expectedHeadOid });
    return {
      commitOid,
      treeOid,
      entries: metadata.entries.map(RootSetPersistence.#publicEntry),
    };
  }

  /**
   * @param {Iterable<object>} entries
   * @returns {Promise<{ healthy: boolean, targets: Array<object>, issues: Array<object> }>}
   */
  async inspectTargets(entries) {
    const targets = [];
    const issues = [];
    for (const entry of entries) {
      try {
        const actualType = await this.persistence.readObjectType(entry.oid);
        const target = {
          ...entry,
          exists: true,
          actualType,
          reachability: 'anchored',
        };
        targets.push(target);
        if (actualType !== entry.type) {
          issues.push({
            code: ErrorCodes.ROOT_SET_TARGET_TYPE_MISMATCH,
            name: entry.name,
            oid: entry.oid,
            expectedType: entry.type,
            actualType,
          });
        }
      } catch (err) {
        const missing = err?.code === ErrorCodes.GIT_OBJECT_NOT_FOUND;
        const issueCode = missing
          ? ErrorCodes.ROOT_SET_TARGET_MISSING
          : ErrorCodes.ROOT_SET_TARGET_UNREADABLE;
        targets.push({
          ...entry,
          exists: missing ? false : null,
          actualType: null,
          reachability: missing ? 'missing' : 'unknown',
        });
        issues.push({
          code: issueCode,
          name: entry.name,
          oid: entry.oid,
          expectedType: entry.type,
          originalError: err,
        });
      }
    }
    return { healthy: issues.length === 0, targets, issues };
  }

  /**
   * @param {{ commitOid: string, expectedHeadOid: string|null }} options
   */
  async #updateRef({ commitOid, expectedHeadOid }) {
    try {
      await this.ref.updateRef({
        ref: this.rootSetRef,
        newOid: commitOid,
        expectedOldOid: expectedHeadOid,
      });
    } catch (err) {
      const meta = await this.#updateFailureMeta(err, commitOid, expectedHeadOid);
      if (this.#isConflict(err, {
        newCommit: commitOid,
        expectedHeadOid,
        actualHeadOid: meta.actualHeadOid,
      })) {
        throw new CasError(
          'Concurrent root-set update detected',
          ErrorCodes.ROOT_SET_CONFLICT,
          meta,
        );
      }
      throw new CasError('Root-set ref update failed', ErrorCodes.ROOT_SET_REF_UPDATE_FAILED, meta);
    }
  }

  async #updateFailureMeta(originalError, newCommit, expectedHeadOid) {
    const errorMeta = originalError?.meta && typeof originalError.meta === 'object'
      ? originalError.meta
      : {};
    let actualHeadOid = Object.hasOwn(errorMeta, 'actualOldOid')
      ? errorMeta.actualOldOid
      : undefined;
    if (actualHeadOid === undefined) {
      try {
        actualHeadOid = await this.ref.resolveRef(this.rootSetRef);
      } catch {
        actualHeadOid = null;
      }
    }
    return {
      ref: this.rootSetRef,
      expectedHeadOid,
      actualHeadOid,
      newCommit,
      originalError,
    };
  }

  #isConflict(err, { newCommit, expectedHeadOid, actualHeadOid }) {
    const meta = err?.meta && typeof err.meta === 'object' ? err.meta : {};
    if (Object.hasOwn(meta, 'expectedOldOid') && Object.hasOwn(meta, 'actualOldOid')) {
      return true;
    }
    const structuredConflict = classifyStructuredUpdateRefConflict(err, {
      rootSetRef: this.rootSetRef,
      newCommit,
      expectedHeadOid,
    });
    if (structuredConflict !== null) {
      return structuredConflict;
    }
    // A failed exact CAS command plus an independently observed head advance
    // remains sufficient conflict evidence when Git emits no diagnostic text.
    if (isObservedUpdateRefConflict(err, {
      rootSetRef: this.rootSetRef,
      newCommit,
      expectedHeadOid,
      actualHeadOid,
    })) {
      return true;
    }
    return hasTextualUpdateRefConflict(err, this.rootSetRef);
  }

  #isMissingRefError(err) {
    if (err?.code === ErrorCodes.GIT_REF_NOT_FOUND) {
      return true;
    }
    return isGitMissingRefError(err, this.rootSetRef);
  }

  #headError(message, originalError, meta = {}) {
    return new CasError(message, ErrorCodes.ROOT_SET_HEAD_INVALID, {
      ref: this.rootSetRef,
      ...meta,
      originalError,
    });
  }

  static #publicEntry(entry) {
    return {
      name: entry.name,
      oid: entry.oid,
      type: entry.type,
      retention: entry.retention,
    };
  }

  static #validateDependencies(persistence, ref) {
    const persistenceMethods = [
      'writeBlob',
      'writeTree',
      'readBlob',
      'readTree',
      'readObjectType',
    ];
    const refMethods = [
      'resolveRef',
      'resolveTree',
      'resolveParents',
      'createCommit',
      'updateRef',
    ];
    const missing = [
      ...persistenceMethods.filter((method) => typeof persistence?.[method] !== 'function'),
      ...refMethods.filter((method) => typeof ref?.[method] !== 'function'),
    ];
    if (missing.length > 0) {
      throw new CasError(
        'RootSetPersistence requires complete Git persistence and ref ports',
        ErrorCodes.ROOT_SET_DEPENDENCY_INVALID,
        { missing },
      );
    }
  }

  async #assertTargets(entries) {
    if (typeof this.persistence.readObjectInfos === 'function') {
      try {
        const infos = await this.persistence.readObjectInfos(entries.map((entry) => entry.oid));
        this.#assertBatchTargetInfos(entries, infos);
        return;
      } catch (err) {
        if (err?.code === ErrorCodes.ROOT_SET_TARGET_TYPE_MISMATCH) {
          throw err;
        }
        if (err?.code !== ErrorCodes.GIT_OBJECT_NOT_FOUND) {
          throw this.#targetUnreadable(entries[0], err);
        }
      }
    }
    this.#assertTargetReport(await this.inspectTargets(entries));
  }

  #assertBatchTargetInfos(entries, infos) {
    if (infos.length !== entries.length) {
      throw new CasError(
        'Root-set target metadata count does not match the entry count',
        ErrorCodes.GIT_ERROR,
        { expectedCount: entries.length, actualCount: infos.length },
      );
    }
    const mismatchIndex = infos.findIndex((info, index) => info.type !== entries[index].type);
    if (mismatchIndex === -1) {
      return;
    }
    const entry = entries[mismatchIndex];
    throw new CasError(
      `Root-set target type mismatch for ${entry.oid}`,
      ErrorCodes.ROOT_SET_TARGET_TYPE_MISMATCH,
      {
        ref: this.rootSetRef,
        name: entry.name,
        oid: entry.oid,
        expectedType: entry.type,
        actualType: infos[mismatchIndex].type,
      },
    );
  }

  #assertTargetReport(report) {
    const issue = report.issues[0];
    if (!issue) {
      return;
    }
    const messages = {
      [ErrorCodes.ROOT_SET_TARGET_MISSING]: `Root-set target does not exist: ${issue.oid}`,
      [ErrorCodes.ROOT_SET_TARGET_UNREADABLE]: `Root-set target could not be inspected: ${issue.oid}`,
      [ErrorCodes.ROOT_SET_TARGET_TYPE_MISMATCH]: `Root-set target type mismatch for ${issue.oid}`,
    };
    const message = messages[issue.code];
    throw new CasError(message, issue.code, {
      ref: this.rootSetRef,
      ...issue,
    });
  }

  #targetUnreadable(entry, originalError) {
    return new CasError(
      `Root-set target could not be inspected: ${entry?.oid ?? 'unknown'}`,
      ErrorCodes.ROOT_SET_TARGET_UNREADABLE,
      {
        ref: this.rootSetRef,
        name: entry?.name,
        oid: entry?.oid,
        expectedType: entry?.type,
        originalError,
      },
    );
  }
}
