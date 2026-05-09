import { Policy } from '@git-stunts/alfred';
import GitRefPort from '../../ports/GitRefPort.js';
import { CasError, ErrorCodes } from '../../domain/errors/index.js';
import { isGitMissingRefError } from '../../domain/helpers/gitRefErrors.js';

/**
 * Default resilience policy: 30 s timeout (no retry).
 *
 * Plumbing already retries lock-contention errors internally via
 * {@link ExecutionOrchestrator}, so an additional alfred retry layer is
 * unnecessary and causes premature process exit: alfred's retry sleep uses
 * an unref'd timer that allows Node to exit before the next attempt starts.
 */
const DEFAULT_POLICY = Policy.timeout(30_000);
const GIT_NULL_OID = '0'.repeat(40);

/**
 * {@link GitRefPort} implementation backed by `@git-stunts/plumbing`.
 *
 * All Git I/O is wrapped with a configurable resilience {@link Policy}
 * (30 s timeout by default).
 */
export default class GitRefAdapter extends GitRefPort {
  /**
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   */
  constructor({ plumbing, policy }) {
    super();
    this.plumbing = plumbing;
    this.policy = policy ?? DEFAULT_POLICY;
  }

  /**
   * @override
   * @param {string} ref - Git ref to resolve.
   * @returns {Promise<string>} The commit OID.
   */
  async resolveRef(ref) {
    try {
      return await this.policy.execute(() =>
        this.plumbing.execute({ args: ['rev-parse', ref] }),
      );
    } catch (err) {
      if (isGitMissingRefError(err, ref)) {
        throw new CasError(`Git ref not found: ${ref}`, ErrorCodes.GIT_REF_NOT_FOUND, {
          ref,
          originalError: err,
        });
      }
      throw err;
    }
  }

  /**
   * @override
   * @param {string} commitOid - Git commit OID.
   * @returns {Promise<string>} The tree OID.
   */
  async resolveTree(commitOid) {
    return this.policy.execute(() =>
      this.plumbing.execute({ args: ['rev-parse', `${commitOid}^{tree}`] }),
    );
  }

  /**
   * @override
   * @param {Object} options
   * @param {string} options.treeOid - Tree OID for the commit.
   * @param {string|null} [options.parentOid] - Parent commit OID.
   * @param {string} options.message - Commit message.
   * @returns {Promise<string>} The new commit OID.
   */
  async createCommit({ treeOid, parentOid, message }) {
    const args = ['commit-tree', treeOid, '-m', message];
    if (parentOid) {
      args.push('-p', parentOid);
    }
    return this.policy.execute(() =>
      this.plumbing.execute({ args }),
    );
  }

  /**
   * @override
   * @param {Object} options
   * @param {string} options.ref - Git ref to update.
   * @param {string} options.newOid - New OID to set.
   * @param {string|null} [options.expectedOldOid] - Expected current OID for CAS; `null` means the ref must not exist.
   * @returns {Promise<void>}
   */
  async updateRef({ ref, newOid, expectedOldOid }) {
    const args = ['update-ref', ref, newOid];
    if (expectedOldOid !== undefined) {
      args.push(expectedOldOid ?? GIT_NULL_OID);
    }
    await this.policy.execute(() =>
      this.plumbing.execute({ args }),
    );
  }
}
