import { Policy } from '@git-stunts/alfred';
import GitPersistencePort from '../../ports/GitPersistencePort.js';

const DEFAULT_POLICY = Policy.timeout(30_000).wrap(
  Policy.retry({
    retries: 2,
    backoff: 'exponential',
    delay: 100,
    maxDelay: 2_000,
  }),
);

/**
 * Implementation of GitPersistencePort using GitPlumbing.
 */
export default class GitPersistenceAdapter extends GitPersistencePort {
  /**
   * @param {Object} options
   * @param {import('../../../plumbing/index.js').default} options.plumbing
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy for Git I/O
   */
  constructor({ plumbing, policy }) {
    super();
    this.plumbing = plumbing;
    this.policy = policy ?? DEFAULT_POLICY;
  }

  async writeBlob(content) {
    return this.policy.execute(() =>
      this.plumbing.execute({
        args: ['hash-object', '-w', '--stdin'],
        input: content,
      }),
    );
  }

  async writeTree(entries) {
    return this.policy.execute(() =>
      this.plumbing.execute({
        args: ['mktree'],
        input: `${entries.join('\n')}\n`,
      }),
    );
  }

  async readBlob(oid) {
    return this.policy.execute(async () => {
      const stream = await this.plumbing.executeStream({
        args: ['cat-file', 'blob', oid],
      });
      return stream.collect({ asString: false });
    });
  }
}
