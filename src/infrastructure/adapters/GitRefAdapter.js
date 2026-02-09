import { Policy } from '@git-stunts/alfred';
import GitRefPort from '../../ports/GitRefPort.js';

/**
 * Default resilience policy: 30 s timeout (no retry).
 *
 * Plumbing already retries lock-contention errors internally via
 * {@link ExecutionOrchestrator}, so an additional alfred retry layer is
 * unnecessary and causes premature process exit: alfred's retry sleep uses
 * an unref'd timer that allows Node to exit before the next attempt starts.
 */
const DEFAULT_POLICY = Policy.timeout(30_000);

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

  /** @override */
  async resolveRef(ref) {
    return this.policy.execute(() =>
      this.plumbing.execute({ args: ['rev-parse', ref] }),
    );
  }

  /** @override */
  async resolveTree(commitOid) {
    return this.policy.execute(() =>
      this.plumbing.execute({ args: ['rev-parse', `${commitOid}^{tree}`] }),
    );
  }

  /** @override */
  async createCommit({ treeOid, parentOid, message }) {
    const args = ['commit-tree', treeOid, '-m', message];
    if (parentOid) {
      args.push('-p', parentOid);
    }
    return this.policy.execute(() =>
      this.plumbing.execute({ args }),
    );
  }

  /** @override */
  async updateRef({ ref, newOid, expectedOldOid }) {
    const args = ['update-ref', ref, newOid];
    if (expectedOldOid) {
      args.push(expectedOldOid);
    }
    return this.policy.execute(() =>
      this.plumbing.execute({ args }),
    );
  }
}
