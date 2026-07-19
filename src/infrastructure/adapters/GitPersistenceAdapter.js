import { Policy } from '@git-stunts/alfred';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitObjectMissingError } from '@git-stunts/plumbing';
import GitPersistencePort from '../../ports/GitPersistencePort.js';
import { CasError, createCasError, ErrorCodes } from '../../domain/errors/index.js';
import BoundedPromiseCache from '../../helpers/boundedPromiseCache.js';
import GitTreeObjectCodec from '../codecs/GitTreeObjectCodec.js';
import GitObjectSessionPool from './GitObjectSessionPool.js';

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
const DEFAULT_METADATA_CACHE_ENTRIES = 2_048;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 1_000;
const DEFAULT_TREE_CACHE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TREE_CACHE_ENTRIES = 256;
const MIN_READ_BLOB_LIMIT = 1;
const MIN_MAX_BLOB_SIZE = 1024;
const MIN_METADATA_CACHE_ENTRIES = 1;
const MAX_BLOB_SIZE_LIMIT = Number.MAX_SAFE_INTEGER;
const OBJECT_INFO_ARGUMENT = '--batch-check=%(objectname) %(objecttype) %(objectsize)';
const GIT_OBJECT_TYPES = new Set(['blob', 'tree', 'commit', 'tag']);

/**
 * {@link GitPersistencePort} implementation backed by `@git-stunts/plumbing`.
 *
 * All Git I/O is wrapped with a configurable resilience {@link Policy}
 * (30 s timeout by default). Successful metadata reads assume referenced roots
 * remain retained while this adapter is in use; destructive external pruning
 * must not race active operations.
 */
export default class GitPersistenceAdapter extends GitPersistencePort {
  #activeOperations = new Set();
  #activeStreams = new Set();
  #closePromise = null;
  #closed = false;
  #maxBlobSize = DEFAULT_MAX_BLOB_SIZE;
  #metadataCache;
  #sessions;
  #treeCache;
  #treeReadMaxBytes;
  /**
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy (defaults to 30 s timeout, no retry).
   * @param {number} [options.metadataCacheEntries=2048] - Maximum immutable metadata entries retained by this adapter.
   * @param {number} [options.sessionIdleTimeoutMs=1000] - Idle delay before a reusable Git process closes automatically.
   * @param {number} [options.treeCacheEntries=256] - Maximum immutable parsed tree objects retained by this adapter.
   * @param {number} [options.treeCacheBytes=8388608] - Maximum estimated parsed tree bytes retained by this adapter.
   */
  constructor({
    plumbing,
    policy,
    metadataCacheEntries = DEFAULT_METADATA_CACHE_ENTRIES,
    sessionIdleTimeoutMs = DEFAULT_SESSION_IDLE_TIMEOUT_MS,
    treeCacheEntries = DEFAULT_TREE_CACHE_ENTRIES,
    treeCacheBytes = DEFAULT_TREE_CACHE_BYTES,
  }) {
    super();
    GitPersistenceAdapter.#assertMetadataCacheEntries(metadataCacheEntries);
    GitPersistenceAdapter.#assertSessionIdleTimeout(sessionIdleTimeoutMs);
    GitPersistenceAdapter.#assertTreeCacheEntries(treeCacheEntries);
    GitPersistenceAdapter.#assertTreeCacheBytes(treeCacheBytes);
    this.plumbing = plumbing;
    this.policy = policy ?? DEFAULT_POLICY;
    this.#metadataCache = new BoundedPromiseCache(metadataCacheEntries);
    this.#sessions = new GitObjectSessionPool({ plumbing, idleTimeoutMs: sessionIdleTimeoutMs });
    this.#treeCache = new BoundedPromiseCache(treeCacheEntries, {
      maxWeight: treeCacheBytes,
      weightOf: (tree) => tree.weight,
    });
    this.#treeReadMaxBytes = Math.max(MIN_READ_BLOB_LIMIT, treeCacheBytes);
  }

  /**
   * @override
   * @param {Buffer|string} content - Data to store.
   * @returns {Promise<string>} The Git OID of the stored blob.
   */
  async writeBlob(content) {
    return await this.#runOperation(() => this.#writeBlob(content));
  }

  async #writeBlob(content) {
    const oid = await this.policy.execute(() =>
      typeof globalThis.Bun !== 'undefined'
        ? this.#writeBlobFromTempFile(content)
        : this.plumbing.execute({
            args: ['hash-object', '-w', '--stdin'],
            input: content,
          })
    );
    return oid;
  }

  /**
   * Writes a bounded group through one scoped fast-import session when the
   * injected plumbing supports it. The session closes before OIDs are exposed,
   * so later pruning cannot poison duplicate writes in a reused process.
   * @override
   * @param {Iterable<Uint8Array|string>} contents
   * @returns {Promise<string[]>}
   */
  async writeBlobs(contents) {
    return await this.#runOperation(async () => {
      const replayableContents = [...contents];
      if (!this.#sessions.supports('fastImport')) {
        const oids = [];
        for (const content of replayableContents) {
          oids.push(await this.#writeBlob(content));
        }
        return oids;
      }
      let result;
      let operationFailed = false;
      let operationError;
      try {
        const oids = await this.#sessions.writeBlobs(replayableContents, (operation) =>
          this.policy.execute(operation)
        );
        // mktree's quick lookup cannot discover packs created after its ODB snapshot.
        await this.#sessions.retire('mktree');
        result = [...oids];
      } catch (error) {
        operationFailed = true;
        operationError = error;
      }
      try {
        await this.#sessions.retire('fastImport');
      } catch (retirementError) {
        if (operationFailed) {
          throw new AggregateError(
            [operationError, retirementError],
            'Bulk Git object write and session retirement both failed'
          );
        }
        throw retirementError;
      }
      if (operationFailed) {
        throw operationError;
      }
      return result;
    });
  }

  /**
   * @override
   * @param {string[]} entries - Lines in `git mktree` format.
   * @returns {Promise<string>} The Git OID of the created tree.
   */
  async writeTree(entries) {
    return await this.#runOperation(async () => {
      if (this.#sessions.supports('mktree')) {
        const structured = GitTreeObjectCodec.parseMktreeLines(entries);
        const oid = await this.#sessions.writeTree(structured, (operation) =>
          this.policy.execute(operation)
        );
        return oid;
      }
      const oid = await this.policy.execute(() =>
        this.plumbing.execute({
          args: ['mktree'],
          input: `${entries.join('\n')}\n`,
        })
      );
      return oid;
    });
  }

  /**
   * @override
   * @param {string} oid - Git object ID.
   * @param {number} [maxBytes=10485760] - Safety limit (default 10MB).
   * @returns {Promise<Buffer>} The blob content.
   */
  async readBlob(oid, maxBytes) {
    return await this.#runOperation(async () => {
      const limit =
        maxBytes === undefined
          ? this.#maxBlobSize
          : GitPersistenceAdapter.#validatedReadBlobLimit(maxBytes);
      if (this.#sessions.supports('catFile')) {
        let object;
        try {
          object = await this.#sessions.read(oid, { maxBytes: limit }, (operation) =>
            this.policy.execute(operation)
          );
        } catch (error) {
          throw this.#normalizeObjectReadError(error, oid, limit);
        }
        if (object.type !== 'blob') {
          throw createCasError(`Git object is not a blob: ${oid}`, ErrorCodes.GIT_ERROR, {
            oid,
            actualType: object.type,
          });
        }
        return GitPersistenceAdapter.#toBuffer(object.content);
      }
      const chunks = [];
      let bytesRead = 0;
      for await (const chunk of await this.#openBufferStream(['cat-file', 'blob', oid])) {
        bytesRead += chunk.length;
        if (bytesRead > limit) {
          throw new CasError(
            `Blob ${oid} exceeds safety limit of ${limit} bytes`,
            ErrorCodes.RESTORE_TOO_LARGE,
            { oid, maxBytes: limit }
          );
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    });
  }

  /**
   * Sets the adapter-level safety limit used by `readBlob()` when callers do
   * not provide a per-call limit.
   *
   * @param {number} maxBlobSize - Metadata blob safety limit in bytes.
   * @returns {void}
   */
  setMaxBlobSize(maxBlobSize) {
    this.#assertOpen();
    GitPersistenceAdapter.#assertMaxBlobSize(maxBlobSize);
    this.#maxBlobSize = maxBlobSize;
  }

  /**
   * @override
   * @param {string} oid - Git object ID.
   * @returns {Promise<AsyncIterable<Buffer>>} The blob content stream.
   */
  async readBlobStream(oid) {
    return await this.#runOperation(() => this.#openBufferStream(['cat-file', 'blob', oid]));
  }

  /**
   * @override
   * @param {string} treeOid - Git tree OID.
   * @returns {Promise<Array<{ mode: string, type: string, oid: string, name: string }>>}
   */
  async readTree(treeOid) {
    return await this.#runOperation(async () => {
      if (this.#sessions.supports('catFile')) {
        try {
          const tree = await this.#readTreeObject(treeOid);
          return tree.entries.map((entry) => ({ ...entry }));
        } catch (error) {
          if (!GitPersistenceAdapter.#isObjectBufferLimit(error)) {
            throw this.#normalizeTreeReadError(error, treeOid);
          }
        }
      }
      return await this.#readTreeWithCommand(treeOid);
    });
  }

  async #readTreeWithCommand(treeOid) {
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
    return await this.#runOperation(async () => {
      const key = `tree\0${treeOid}\0${treePath}`;
      const entry = await this.#metadataCache.getOrCreate(key, async () => {
        let found;
        if (this.#sessions.supports('catFile')) {
          try {
            found = await this.#readExactTreePath(treeOid, treePath);
          } catch (error) {
            if (!GitPersistenceAdapter.#isObjectBufferLimit(error)) {
              throw this.#normalizeTreeReadError(error, treeOid);
            }
            found = await this.#readTreeEntryWithCommand(treeOid, treePath);
          }
        } else {
          found = await this.#readTreeEntryWithCommand(treeOid, treePath);
        }
        return found === null ? null : Object.freeze(found);
      });
      return entry === null ? null : { ...entry };
    });
  }

  async #readTreeEntryWithCommand(treeOid, treePath) {
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
    const stream = await this.#runOperation(() =>
      this.#openBufferStream(['ls-tree', '-z', treeOid])
    );
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
    return await this.#runOperation(async () => (await this.#readObjectInfo(oid)).type);
  }

  /**
   * @override
   * @param {string} oid - Git object ID.
   * @returns {Promise<number>} Git object size in bytes.
   */
  async readObjectSize(oid) {
    return await this.#runOperation(async () => (await this.#readObjectInfo(oid)).size);
  }

  /**
   * Reads object metadata through Git's structured batch protocol. Missing
   * objects are reported on stdout with exit zero, avoiding runtime-specific
   * stderr capture while preserving genuine command failures.
   *
   * @param {string} oid - Git object ID.
   * @returns {Promise<{ oid: string, type: string, size: number }>} Object metadata.
   */
  async #readObjectInfo(oid) {
    return this.#metadataCache.getOrCreate(`object\0${oid}`, async () => {
      if (this.#sessions.supports('catFile')) {
        try {
          const info = await this.#sessions.info(oid, (operation) =>
            this.policy.execute(operation)
          );
          return Object.freeze({ oid: info.oid, type: info.type, size: info.size });
        } catch (error) {
          throw this.#normalizeObjectReadError(error, oid, this.#maxBlobSize);
        }
      }
      const rawOutput = await this.policy.execute(() =>
        this.plumbing.execute({
          args: ['cat-file', OBJECT_INFO_ARGUMENT],
          input: `${oid}\n`,
        })
      );
      const output = typeof rawOutput === 'string' ? rawOutput.trim() : '';
      if (output === `${oid} missing`) {
        throw new CasError(`Git object not found: ${oid}`, ErrorCodes.GIT_OBJECT_NOT_FOUND, {
          oid,
        });
      }

      const fields = output.split(' ');
      const size = Number(fields[2]);
      if (
        fields.length !== 3 ||
        fields[0] !== oid ||
        !GIT_OBJECT_TYPES.has(fields[1]) ||
        !Number.isSafeInteger(size) ||
        size < 0
      ) {
        throw new CasError(`Git object has invalid metadata: ${oid}`, ErrorCodes.GIT_ERROR, {
          oid,
          output: rawOutput,
        });
      }
      return Object.freeze({ oid: fields[0], type: fields[1], size });
    });
  }

  async #readTreeObject(treeOid) {
    return this.#treeCache.getOrCreate(treeOid, async () => {
      const object = await this.#sessions.read(
        treeOid,
        { maxBytes: this.#treeReadMaxBytes },
        (operation) => this.policy.execute(operation)
      );
      if (object.type !== 'tree') {
        throw createCasError(`Git object is not a tree: ${treeOid}`, ErrorCodes.TREE_PARSE_ERROR, {
          treeOid,
          actualType: object.type,
        });
      }
      try {
        return GitTreeObjectCodec.decode(object.content, treeOid);
      } catch (error) {
        throw createCasError(
          `Git tree object is malformed: ${treeOid}`,
          ErrorCodes.TREE_PARSE_ERROR,
          { treeOid, originalError: error }
        );
      }
    });
  }

  async #readExactTreePath(treeOid, treePath) {
    if (typeof treePath !== 'string' || treePath.length === 0) {
      throw createCasError('Git tree path must be a non-empty string', ErrorCodes.INVALID_OPTIONS, {
        treeOid,
        treePath,
      });
    }
    const components = treePath.split('/');
    if (components.some((component) => component.length === 0)) {
      throw createCasError(
        'Git tree path contains an empty component',
        ErrorCodes.INVALID_OPTIONS,
        {
          treeOid,
          treePath,
        }
      );
    }

    let currentOid = treeOid;
    for (let index = 0; index < components.length; index += 1) {
      const tree = await this.#readTreeObject(currentOid);
      const entry = tree.entries.find((candidate) => candidate.name === components[index]) ?? null;
      if (entry === null) {
        return null;
      }
      if (index === components.length - 1) {
        return { ...entry, name: treePath };
      }
      if (entry.type !== 'tree') {
        return null;
      }
      currentOid = entry.oid;
    }
    return null;
  }

  #normalizeObjectReadError(error, oid, maxBytes) {
    if (error instanceof GitObjectMissingError) {
      return new CasError(`Git object not found: ${oid}`, ErrorCodes.GIT_OBJECT_NOT_FOUND, { oid });
    }
    if (GitPersistenceAdapter.#isObjectBufferLimit(error)) {
      return new CasError(
        `Blob ${oid} exceeds safety limit of ${maxBytes} bytes`,
        ErrorCodes.RESTORE_TOO_LARGE,
        { oid, maxBytes }
      );
    }
    return error;
  }

  #normalizeTreeReadError(error, treeOid) {
    if (error instanceof GitObjectMissingError) {
      return new CasError(`Git object not found: ${treeOid}`, ErrorCodes.GIT_OBJECT_NOT_FOUND, {
        oid: treeOid,
      });
    }
    return error;
  }

  async close() {
    if (this.#closePromise !== null) {
      return await this.#closePromise;
    }
    this.#closed = true;
    this.#closePromise = (async () => {
      const failures = [];
      const active = [...this.#activeOperations];
      await Promise.allSettled(active);

      const streams = [...this.#activeStreams];
      const streamResults = await Promise.allSettled(
        streams.map((stream) => GitPersistenceAdapter.#closeStream(stream))
      );
      this.#activeStreams.clear();
      failures.push(
        ...streamResults
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason)
      );

      try {
        await this.#sessions.close();
      } catch (error) {
        failures.push(error);
      } finally {
        this.#metadataCache = null;
        this.#treeCache = null;
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Git persistence adapter failed to close cleanly');
      }
    })();
    return await this.#closePromise;
  }

  async [Symbol.asyncDispose]() {
    await this.close();
  }

  #assertOpen() {
    if (this.#closed) {
      throw createCasError('Git persistence adapter is closed', ErrorCodes.RESOURCE_CLOSED);
    }
  }

  #runOperation(operation) {
    this.#assertOpen();
    const promise = Promise.resolve().then(operation);
    this.#activeOperations.add(promise);
    void promise.then(
      () => this.#activeOperations.delete(promise),
      () => this.#activeOperations.delete(promise)
    );
    return promise;
  }

  static #isObjectBufferLimit(error) {
    return error?.details?.code === 'OBJECT_BUFFER_LIMIT_EXCEEDED';
  }

  /**
   * @param {number} metadataCacheEntries
   */
  static #assertMetadataCacheEntries(metadataCacheEntries) {
    if (
      Number.isSafeInteger(metadataCacheEntries) &&
      metadataCacheEntries >= MIN_METADATA_CACHE_ENTRIES
    ) {
      return;
    }
    throw createCasError(
      'Git metadata cache entries must be a positive safe integer',
      ErrorCodes.INVALID_OPTIONS,
      { option: 'metadataCacheEntries', metadataCacheEntries }
    );
  }

  static #assertTreeCacheEntries(treeCacheEntries) {
    if (Number.isSafeInteger(treeCacheEntries) && treeCacheEntries >= 1) {
      return;
    }
    throw createCasError(
      'Git tree cache entries must be a positive safe integer',
      ErrorCodes.INVALID_OPTIONS,
      { option: 'treeCacheEntries', treeCacheEntries }
    );
  }

  static #assertSessionIdleTimeout(sessionIdleTimeoutMs) {
    if (Number.isSafeInteger(sessionIdleTimeoutMs) && sessionIdleTimeoutMs >= 1) {
      return;
    }
    throw createCasError(
      'Git session idle timeout must be a positive safe integer',
      ErrorCodes.INVALID_OPTIONS,
      { option: 'sessionIdleTimeoutMs', sessionIdleTimeoutMs }
    );
  }

  static #assertTreeCacheBytes(treeCacheBytes) {
    if (Number.isSafeInteger(treeCacheBytes) && treeCacheBytes >= 0) {
      return;
    }
    throw createCasError(
      'Git tree cache bytes must be a non-negative safe integer',
      ErrorCodes.INVALID_OPTIONS,
      { option: 'treeCacheBytes', treeCacheBytes }
    );
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
    try {
      for await (const chunk of stream) {
        yield GitPersistenceAdapter.#toBuffer(chunk);
      }
    } finally {
      try {
        await GitPersistenceAdapter.#closeStream(stream);
      } finally {
        this.#activeStreams.delete(stream);
      }
    }
  }

  async #openBufferStream(args) {
    const stream = await this.policy.execute(
      async () => await this.plumbing.executeStream({ args })
    );
    this.#activeStreams.add(stream);
    return this.#bufferStream(stream);
  }

  static async #closeStream(stream) {
    const operations = [];
    if (typeof stream.destroy === 'function') {
      operations.push(Promise.resolve().then(() => stream.destroy()));
    }
    if (stream.finished !== undefined) {
      operations.push(Promise.resolve(stream.finished));
    }
    const results = await Promise.allSettled(operations);
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Git output stream failed to terminate cleanly');
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
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < MIN_READ_BLOB_LIMIT ||
      maxBytes > MAX_BLOB_SIZE_LIMIT
    ) {
      throw createCasError(
        `maxBytes must be an integer in [${MIN_READ_BLOB_LIMIT}, ${MAX_BLOB_SIZE_LIMIT}]`,
        ErrorCodes.INVALID_OPTIONS,
        {
          label: 'maxBytes',
          value: maxBytes,
          min: MIN_READ_BLOB_LIMIT,
          max: MAX_BLOB_SIZE_LIMIT,
        }
      );
    }
    return maxBytes;
  }

  /**
   * @param {number} maxBlobSize
   * @returns {void}
   */
  static #assertMaxBlobSize(maxBlobSize) {
    if (
      !Number.isInteger(maxBlobSize) ||
      maxBlobSize < MIN_MAX_BLOB_SIZE ||
      maxBlobSize > MAX_BLOB_SIZE_LIMIT
    ) {
      throw createCasError(
        `maxBlobSize must be an integer in [${MIN_MAX_BLOB_SIZE}, ${MAX_BLOB_SIZE_LIMIT}]`,
        ErrorCodes.INVALID_OPTIONS,
        {
          label: 'maxBlobSize',
          value: maxBlobSize,
          min: MIN_MAX_BLOB_SIZE,
          max: MAX_BLOB_SIZE_LIMIT,
        }
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
      throw new CasError(`Malformed ls-tree entry: ${entry}`, ErrorCodes.TREE_PARSE_ERROR, {
        rawEntry: entry,
      });
    }
    const meta = entry.slice(0, tabIndex).split(' ');
    if (meta.length !== 3) {
      throw new CasError(`Malformed ls-tree entry: ${entry}`, ErrorCodes.TREE_PARSE_ERROR, {
        rawEntry: entry,
      });
    }
    return {
      mode: meta[0],
      type: meta[1],
      oid: meta[2],
      name: entry.slice(tabIndex + 1),
    };
  }
}
