import { Policy } from '@git-stunts/alfred';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import GitPersistencePort from '../../ports/GitPersistencePort.js';
import { CasError, createCasError, ErrorCodes } from '../../domain/errors/index.js';
import { errorDetailsText } from '../../domain/helpers/gitRefErrors.js';

/**
 * Default resilience policy: 30 s timeout (no retry).
 *
 * Plumbing already retries lock-contention errors internally via
 * {@link ExecutionOrchestrator}, so an additional alfred retry layer is
 * unnecessary and causes premature process exit: alfred's retry sleep uses
 * an unref'd timer that allows Node to exit before the next attempt starts.
 */
const DEFAULT_POLICY = Policy.timeout(30_000);
export const DEFAULT_MAX_BLOB_SIZE = 10 * 1024 * 1024;
const MIN_READ_BLOB_LIMIT = 1;
const MIN_MAX_BLOB_SIZE = 1024;
const MAX_BLOB_SIZE_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * {@link GitPersistencePort} implementation backed by `@git-stunts/plumbing`.
 *
 * All Git I/O is wrapped with a configurable resilience {@link Policy}
 * (30 s timeout by default).
 */
export default class GitPersistenceAdapter extends GitPersistencePort {
  #maxBlobSize = DEFAULT_MAX_BLOB_SIZE;
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
   * @param {number} [maxBytes=10485760] - Safety limit (default 10MB).
   * @returns {Promise<Buffer>} The blob content.
   */
  async readBlob(oid, maxBytes) {
    const limit = maxBytes === undefined
      ? this.#maxBlobSize
      : GitPersistenceAdapter.#validatedReadBlobLimit(maxBytes);
    const chunks = [];
    let bytesRead = 0;
    for await (const chunk of await this.readBlobStream(oid)) {
      bytesRead += chunk.length;
      if (bytesRead > limit) {
        throw new CasError(
          `Blob ${oid} exceeds safety limit of ${limit} bytes`,
          ErrorCodes.RESTORE_TOO_LARGE,
          { oid, maxBytes: limit },
        );
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Sets the adapter-level safety limit used by `readBlob()` when callers do
   * not provide a per-call limit.
   *
   * @param {number} maxBlobSize - Metadata blob safety limit in bytes.
   * @returns {void}
   */
  setMaxBlobSize(maxBlobSize) {
    GitPersistenceAdapter.#assertMaxBlobSize(maxBlobSize);
    this.#maxBlobSize = maxBlobSize;
  }

  /**
   * @override
   * @param {string} oid - Git object ID.
   * @returns {Promise<AsyncIterable<Buffer>>} The blob content stream.
   */
  async readBlobStream(oid) {
    const stream = await this.policy.execute(async () => (
      await this.plumbing.executeStream({
        args: ['cat-file', 'blob', oid],
      })
    ));

    return this.#bufferStream(stream);
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

      return GitPersistenceAdapter.#parseTreeOutput(output);
    });
  }

  /**
   * @override
   * @param {string} treeOid - Git tree OID.
   * @param {string} treePath - Tree entry path/name to resolve.
   * @returns {Promise<{ mode: string, type: string, oid: string, name: string }|null>}
   */
  async readTreeEntry(treeOid, treePath) {
    return this.policy.execute(async () => {
      const output = await this.plumbing.execute({
        args: ['ls-tree', '-z', treeOid, '--', treePath],
      });
      return GitPersistenceAdapter.#parseTreeOutput(output)[0] || null;
    });
  }

  /**
   * @override
   * @param {string} treeOid - Git tree OID.
   * @returns {AsyncIterable<{ mode: string, type: string, oid: string, name: string }>}
   */
  async *iterateTree(treeOid) {
    const stream = await this.policy.execute(async () => (
      await this.plumbing.executeStream({
        args: ['ls-tree', '-z', treeOid],
      })
    ));
    let pending = '';
    for await (const chunk of stream) {
      pending += GitPersistenceAdapter.#toBuffer(chunk).toString();
      let nulIndex = pending.indexOf('\0');
      while (nulIndex !== -1) {
        const rawEntry = pending.slice(0, nulIndex);
        pending = pending.slice(nulIndex + 1);
        if (rawEntry) {
          yield GitPersistenceAdapter.#parseTreeEntry(rawEntry);
        }
        nulIndex = pending.indexOf('\0');
      }
    }
    if (pending) {
      yield GitPersistenceAdapter.#parseTreeEntry(pending);
    }
  }

  /**
   * @override
   * @param {string} oid - Git object ID.
   * @returns {Promise<string>} Git object type.
   */
  async readObjectType(oid) {
    try {
      return await this.policy.execute(() =>
        this.plumbing.execute({ args: ['cat-file', '-t', oid] }),
      );
    } catch (err) {
      if (isMissingGitObjectError(err)) {
        throw new CasError(`Git object not found: ${oid}`, ErrorCodes.GIT_OBJECT_NOT_FOUND, {
          oid,
          originalError: err,
        });
      }
      throw err;
    }
  }

  /**
   * @override
   * @param {string} oid - Git object ID.
   * @returns {Promise<number>} Git object size in bytes.
   */
  async readObjectSize(oid) {
    let output;
    try {
      output = await this.policy.execute(() =>
        this.plumbing.execute({ args: ['cat-file', '-s', oid] }),
      );
    } catch (err) {
      if (isMissingGitObjectError(err)) {
        throw new CasError(`Git object not found: ${oid}`, ErrorCodes.GIT_OBJECT_NOT_FOUND, {
          oid,
          originalError: err,
        });
      }
      throw err;
    }
    const size = Number(output);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new CasError(`Git object has an invalid size: ${oid}`, ErrorCodes.GIT_ERROR, {
        oid,
        output,
      });
    }
    return size;
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

  /**
   * Normalizes a plumbing stdout stream into Buffer chunks.
   *
   * @param {AsyncIterable<Buffer|Uint8Array|string>} stream
   * @returns {AsyncIterable<Buffer>}
   */
  async *#bufferStream(stream) {
    for await (const chunk of stream) {
      yield GitPersistenceAdapter.#toBuffer(chunk);
    }
  }

  /**
   * @param {Buffer|Uint8Array|string} chunk
   * @returns {Buffer}
   */
  static #toBuffer(chunk) {
    if (Buffer.isBuffer(chunk)) {
      return chunk;
    }
    if (chunk instanceof Uint8Array) {
      return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    return Buffer.from(String(chunk));
  }

  /**
   * @param {unknown} maxBytes
   * @returns {number}
   */
  static #validatedReadBlobLimit(maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < MIN_READ_BLOB_LIMIT || maxBytes > MAX_BLOB_SIZE_LIMIT) {
      throw createCasError(
        `maxBytes must be an integer in [${MIN_READ_BLOB_LIMIT}, ${MAX_BLOB_SIZE_LIMIT}]`,
        ErrorCodes.INVALID_OPTIONS,
        {
          label: 'maxBytes',
          value: maxBytes,
          min: MIN_READ_BLOB_LIMIT,
          max: MAX_BLOB_SIZE_LIMIT,
        },
      );
    }
    return maxBytes;
  }

  /**
   * @param {number} maxBlobSize
   * @returns {void}
   */
  static #assertMaxBlobSize(maxBlobSize) {
    if (!Number.isInteger(maxBlobSize) || maxBlobSize < MIN_MAX_BLOB_SIZE || maxBlobSize > MAX_BLOB_SIZE_LIMIT) {
      throw createCasError(
        `maxBlobSize must be an integer in [${MIN_MAX_BLOB_SIZE}, ${MAX_BLOB_SIZE_LIMIT}]`,
        ErrorCodes.INVALID_OPTIONS,
        {
          label: 'maxBlobSize',
          value: maxBlobSize,
          min: MIN_MAX_BLOB_SIZE,
          max: MAX_BLOB_SIZE_LIMIT,
        },
      );
    }
  }

  /**
   * @param {string} output
   * @returns {Array<{ mode: string, type: string, oid: string, name: string }>}
   */
  static #parseTreeOutput(output) {
    if (!output || output.length === 0) {
      return [];
    }
    return output
      .split('\0')
      .filter(Boolean)
      .map((entry) => GitPersistenceAdapter.#parseTreeEntry(entry));
  }

  /**
   * @param {string} entry
   * @returns {{ mode: string, type: string, oid: string, name: string }}
   */
  static #parseTreeEntry(entry) {
    const tabIndex = entry.indexOf('\t');
    if (tabIndex === -1) {
      throw new CasError(
        `Malformed ls-tree entry: ${entry}`,
        ErrorCodes.TREE_PARSE_ERROR,
        { rawEntry: entry },
      );
    }
    const meta = entry.slice(0, tabIndex).split(' ');
    if (meta.length !== 3) {
      throw new CasError(
        `Malformed ls-tree entry: ${entry}`,
        ErrorCodes.TREE_PARSE_ERROR,
        { rawEntry: entry },
      );
    }
    return {
      mode: meta[0],
      type: meta[1],
      oid: meta[2],
      name: entry.slice(tabIndex + 1),
    };
  }
}

function isMissingGitObjectError(err) {
  const message = errorDetailsText(err).toLowerCase();
  return message.includes('could not get object info') ||
    message.includes('not a valid object name') ||
    message.includes('bad object');
}
