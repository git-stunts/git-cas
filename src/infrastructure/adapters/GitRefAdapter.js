import { Policy } from '@git-stunts/alfred';
import GitRefPort from '../../ports/GitRefPort.js';

/** Default resilience policy: 30 s timeout wrapping 2 retries with exponential backoff. */
const DEFAULT_POLICY = Policy.timeout(30_000).wrap(
  Policy.retry({
    retries: 2,
    backoff: 'exponential',
    delay: 100,
    maxDelay: 2_000,
  }),
);

/**
 * {@link GitRefPort} implementation backed by `@git-stunts/plumbing`.
 *
 * All Git I/O is wrapped with a configurable resilience {@link Policy}
 * (timeout + retry by default).
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
