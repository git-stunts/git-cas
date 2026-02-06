import { Policy } from '@git-stunts/alfred';
import GitPersistencePort from '../../ports/GitPersistencePort.js';
import CasError from '../../domain/errors/CasError.js';

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
 * {@link GitPersistencePort} implementation backed by `@git-stunts/plumbing`.
 *
 * All Git I/O is wrapped with a configurable resilience {@link Policy}
 * (timeout + retry by default).
 */
export default class GitPersistenceAdapter extends GitPersistencePort {
  /**
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy (defaults to 30 s timeout + 2 retries).
   */
  constructor({ plumbing, policy }) {
    super();
    this.plumbing = plumbing;
    this.policy = policy ?? DEFAULT_POLICY;
  }

  /** @override */
  async writeBlob(content) {
    return this.policy.execute(() =>
      this.plumbing.execute({
        args: ['hash-object', '-w', '--stdin'],
        input: content,
      }),
    );
  }

  /** @override */
  async writeTree(entries) {
    return this.policy.execute(() =>
      this.plumbing.execute({
        args: ['mktree'],
        input: `${entries.join('\n')}\n`,
      }),
    );
  }

  /** @override */
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

  /** @override */
  async readTree(treeOid) {
    return this.policy.execute(async () => {
      const output = await this.plumbing.execute({
        args: ['ls-tree', '-z', treeOid],
      });

      if (!output || output.length === 0) {
        return [];
      }

      return output.split('\0').filter(Boolean).map((entry) => {
        // Format: <mode> <type> <oid>\t<name>
        const tabIndex = entry.indexOf('\t');
        if (tabIndex === -1) {
          throw new CasError(
            `Malformed ls-tree entry: ${entry}`,
            'TREE_PARSE_ERROR',
            { rawEntry: entry },
          );
        }
        const meta = entry.slice(0, tabIndex).split(' ');
        if (meta.length !== 3) {
          throw new CasError(
            `Malformed ls-tree entry: ${entry}`,
            'TREE_PARSE_ERROR',
            { rawEntry: entry },
          );
        }
        return {
          mode: meta[0],
          type: meta[1],
          oid: meta[2],
          name: entry.slice(tabIndex + 1),
        };
      });
    });
  }
}
