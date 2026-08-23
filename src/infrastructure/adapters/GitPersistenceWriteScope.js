import GitPersistencePort from '../../ports/GitPersistencePort.js';
import GitObjectSessionPool from './GitObjectSessionPool.js';

const EXECUTE_DIRECTLY = (operation) => operation();
const MAX_FAST_IMPORT_BLOB_BYTES = 64 * 1024 * 1024;
const UTF8_ENCODER = new globalThis.TextEncoder();

/** Operation-owned persistence view with one scoped fast-import process. */
export default class GitPersistenceWriteScope extends GitPersistencePort {
  #adapter;
  #execute;
  #retireMktree;
  #sessions;

  constructor({ adapter, plumbing, execute = EXECUTE_DIRECTLY, retireMktree }) {
    super();
    this.#adapter = adapter;
    this.#execute = execute;
    this.#retireMktree = retireMktree;
    this.#sessions = new GitObjectSessionPool({ plumbing, idleTimeoutMs: null });
  }

  async run(operation) {
    let result;
    let operationError;
    let operationFailed = false;
    try {
      result = await operation(this);
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }
    let closeError;
    let closeFailed = false;
    try {
      await this.#sessions.close();
    } catch (error) {
      closeFailed = true;
      closeError = error;
    }
    if (operationFailed && closeFailed) {
      throw new AggregateError(
        [operationError, closeError],
        'Scoped Git write and session close both failed',
      );
    }
    if (operationFailed) {
      throw operationError;
    }
    if (closeFailed) {
      throw closeError;
    }
    return result;
  }

  async writeBlob(content) {
    if (
      !this.#sessions.supports('fastImport') ||
      contentBytes(content) > MAX_FAST_IMPORT_BLOB_BYTES
    ) {
      return await this.#adapter.writeBlob(content);
    }
    return (await this.writeBlobs([content]))[0];
  }

  async writeBlobs(contents) {
    const replayable = [...contents];
    if (replayable.length === 0) {
      return [];
    }
    if (!this.#sessions.supports('fastImport')) {
      return await this.#adapter.writeBlobs(replayable);
    }
    const oids = await this.#sessions.writeBlobs(replayable, this.#execute);
    await this.#retireMktree();
    return [...oids];
  }

  async writeTree(entries) {
    return await this.#adapter.writeTree(entries);
  }

  async writeTrees(trees) {
    return await this.#adapter.writeTrees(trees);
  }

  async readBlob(oid, maxBytes) {
    return await this.#adapter.readBlob(oid, maxBytes);
  }

  async readBlobStream(oid) {
    return await this.#adapter.readBlobStream(oid);
  }

  async readTree(oid) {
    return await this.#adapter.readTree(oid);
  }

  async readTreeEntry(oid, treePath) {
    return await this.#adapter.readTreeEntry(oid, treePath);
  }

  async *iterateTree(oid) {
    yield* this.#adapter.iterateTree(oid);
  }

  async readObjectType(oid) {
    return await this.#adapter.readObjectType(oid);
  }

  async readObjectSize(oid) {
    return await this.#adapter.readObjectSize(oid);
  }

  async readObjectInfos(oids) {
    return await this.#adapter.readObjectInfos(oids);
  }

  setMaxBlobSize(maxBlobSize) {
    this.#adapter.setMaxBlobSize(maxBlobSize);
  }
}

function contentBytes(content) {
  if (content instanceof Uint8Array) {
    return content.byteLength;
  }
  return typeof content === 'string'
    ? UTF8_ENCODER.encode(content).byteLength
    : Number.MAX_SAFE_INTEGER;
}
