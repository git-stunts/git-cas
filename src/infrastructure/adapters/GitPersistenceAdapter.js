import { Policy } from '@git-stunts/alfred';
import GitPersistencePort from '../../ports/GitPersistencePort.js';
import CasError from '../../domain/errors/CasError.js';

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
      const data = await stream.collect({ asString: false });
      // Plumbing returns Uint8Array; ensure we return a Buffer for codec/crypto compat
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    });
  }

  async readTree(treeOid) {
    return this.policy.execute(async () => {
      const output = await this.plumbing.execute({
        args: ['ls-tree', treeOid],
      });

      if (!output || output.trim() === '') {
        return [];
      }

      return output.trim().split('\n').map((line) => {
        // Format: <mode> <type> <oid>\t<name>
        const tabIndex = line.indexOf('\t');
        if (tabIndex === -1) {
          throw new CasError(
            `Malformed ls-tree line: ${line}`,
            'TREE_PARSE_ERROR',
            { line },
          );
        }
        const meta = line.slice(0, tabIndex).split(' ');
        if (meta.length !== 3) {
          throw new CasError(
            `Malformed ls-tree line: ${line}`,
            'TREE_PARSE_ERROR',
            { line },
          );
        }
        return {
          mode: meta[0],
          type: meta[1],
          oid: meta[2],
          name: line.slice(tabIndex + 1),
        };
      });
    });
  }
}
