import { Policy } from '@git-stunts/alfred';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import GitPersistencePort from '../../ports/GitPersistencePort.js';
import CasError from '../../domain/errors/CasError.js';

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
 * {@link GitPersistencePort} implementation backed by `@git-stunts/plumbing`.
 *
 * All Git I/O is wrapped with a configurable resilience {@link Policy}
 * (30 s timeout by default).
 */
export default class GitPersistenceAdapter extends GitPersistencePort {
  /**
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy (defaults to 30 s timeout, no retry).
   */
  constructor({ plumbing, policy }) {
    super();
    this.plumbing = plumbing;
    this.policy = policy ?? DEFAULT_POLICY;
  }

  /**
   * @override
   * @param {Buffer|string} content - Data to store.
   * @returns {Promise<string>} The Git OID of the stored blob.
   */
  async writeBlob(content) {
    return this.policy.execute(() => (
      typeof globalThis.Bun !== 'undefined'
        ? this.#writeBlobFromTempFile(content)
        : this.plumbing.execute({
          args: ['hash-object', '-w', '--stdin'],
          input: content,
        })
    ));
  }

  /**
   * @override
   * @param {string[]} entries - Lines in `git mktree` format.
   * @returns {Promise<string>} The Git OID of the created tree.
   */
  async writeTree(entries) {
    return this.policy.execute(() =>
      this.plumbing.execute({
        args: ['mktree'],
        input: `${entries.join('\n')}\n`,
      }),
    );
  }

  /**
   * @override
   * @param {string} oid - Git object ID.
   * @returns {Promise<Buffer>} The blob content.
   */
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

  /**
   * @override
   * @param {string} treeOid - Git tree OID.
   * @returns {Promise<Array<{ mode: string, type: string, oid: string, name: string }>>}
   */
  async readTree(treeOid) {
    return this.policy.execute(async () => {
      const output = await this.plumbing.execute({
        args: ['ls-tree', '-z', treeOid],
      });

      if (!output || output.length === 0) {
        return [];
      }

      return output.split('\0').filter(Boolean).map((/** @type {string} */ entry) => {
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

  /**
   * Bun can surface unhandled EPIPE writes when large buffers are fed through
   * `git hash-object --stdin`. Write the blob to a temp file and hash the file
   * directly instead. `--no-filters` preserves raw bytes.
   *
   * @param {Buffer|string} content
   * @returns {Promise<string>}
   */
  async #writeBlobFromTempFile(content) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'git-cas-blob-'));
    const tempPath = path.join(tempDir, 'blob.bin');

    try {
      await writeFile(tempPath, content);
      return await this.plumbing.execute({
        args: ['hash-object', '-w', '--no-filters', tempPath],
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
