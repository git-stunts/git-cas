import { createHash } from 'node:crypto';
import GitRefPort from '../../src/ports/GitRefPort.js';
import { CasError, ErrorCodes } from '../../src/domain/errors/index.js';

function commitOid({ treeOid, parentOid, message }) {
  return createHash('sha1')
    .update('commit')
    .update('\0')
    .update(treeOid)
    .update('\0')
    .update(parentOid || '')
    .update('\0')
    .update(message)
    .digest('hex');
}

/**
 * In-memory Git ref adapter for fast vault domain tests.
 */
export default class MemoryRefAdapter extends GitRefPort {
  #commits = new Map();
  #refs = new Map();

  async resolveRef(ref) {
    const oid = this.#refs.get(ref);
    if (!oid) {
      throw new CasError(`Ref not found: ${ref}`, ErrorCodes.GIT_REF_NOT_FOUND, { ref });
    }
    return oid;
  }

  async resolveTree(commitOidToResolve) {
    const commit = this.#commits.get(commitOidToResolve);
    if (!commit) {
      throw new CasError(
        `Commit not found: ${commitOidToResolve}`,
        ErrorCodes.GIT_ERROR,
        { commitOid: commitOidToResolve },
      );
    }
    return commit.treeOid;
  }

  async resolveParents(commitOidToResolve) {
    const commit = this.#commits.get(commitOidToResolve);
    if (!commit) {
      throw new CasError(
        `Commit not found: ${commitOidToResolve}`,
        ErrorCodes.GIT_ERROR,
        { commitOid: commitOidToResolve },
      );
    }
    return commit.parentOid ? [commit.parentOid] : [];
  }

  async createCommit({ treeOid, parentOid, message }) {
    const oid = commitOid({ treeOid, parentOid, message });
    this.#commits.set(oid, { treeOid, parentOid, message });
    return oid;
  }

  async updateRef({ ref, newOid, expectedOldOid }) {
    this.#assertCommitExists(newOid);
    const current = this.#refs.get(ref) || null;
    if (expectedOldOid !== undefined && current !== expectedOldOid) {
      throw new CasError(
        `Ref update rejected for ${ref}`,
        ErrorCodes.GIT_ERROR,
        { ref, expectedOldOid, actualOldOid: current, newOid },
      );
    }
    this.#refs.set(ref, newOid);
  }

  #assertCommitExists(commitOidToCheck) {
    if (!this.#commits.has(commitOidToCheck)) {
      throw new CasError(
        `Commit not found: ${commitOidToCheck}`,
        ErrorCodes.GIT_ERROR,
        { commitOid: commitOidToCheck },
      );
    }
  }
}
