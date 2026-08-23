import GitPersistencePort from '../../ports/GitPersistencePort.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { utf8ByteLength } from '../encoding/utf8.js';

const MAX_PROTOCOL_OBJECTS = 256;
const MAX_PROTOCOL_BYTES = 64 * 1024 * 1024;

/** Opt-in persistence decorator that coalesces concurrent immutable writes. */
export default class BoundedWriteWavePersistence extends GitPersistencePort {
  #failure = null;
  #flushing = false;
  #maxBatchBytes;
  #maxBatchObjects;
  #persistence;
  #queue = [];
  #scheduled = false;
  #writeBytes = 0;
  #writeObjects = 0;

  constructor({ persistence, maxBatchObjects, maxBatchBytes }) {
    super();
    this.#persistence = persistence;
    this.#maxBatchObjects = maxBatchObjects;
    this.#maxBatchBytes = maxBatchBytes;
  }

  async writeBlob(content) {
    return await this.#enqueue({ kind: 'blob', value: content, bytes: contentBytes(content) });
  }

  async writeBlobs(contents) {
    return await Promise.all([...contents].map((content) => this.writeBlob(content)));
  }

  async writeTree(entries) {
    return await this.#enqueue({ kind: 'tree', value: entries, bytes: treeBytes(entries) });
  }

  async writeTrees(trees) {
    return await Promise.all([...trees].map((entries) => this.writeTree(entries)));
  }

  async readBlob(oid, maxBytes) {
    return await this.#persistence.readBlob(oid, maxBytes);
  }

  async readBlobStream(oid) {
    return await this.#persistence.readBlobStream(oid);
  }

  async readTree(oid) {
    return await this.#persistence.readTree(oid);
  }

  async readTreeEntry(oid, path) {
    return await this.#persistence.readTreeEntry(oid, path);
  }

  async *iterateTree(oid) {
    yield* this.#persistence.iterateTree(oid);
  }

  async readObjectType(oid) {
    return await this.#persistence.readObjectType(oid);
  }

  async readObjectSize(oid) {
    return await this.#persistence.readObjectSize(oid);
  }

  async readObjectInfos(oids) {
    if (typeof this.#persistence.readObjectInfos === 'function') {
      return await this.#persistence.readObjectInfos(oids);
    }
    return await super.readObjectInfos(oids);
  }

  setMaxBlobSize(maxBlobSize) {
    this.#persistence.setMaxBlobSize?.(maxBlobSize);
  }

  snapshot() {
    return Object.freeze({
      writeObjects: this.#writeObjects,
      writeBytes: this.#writeBytes,
      failed: this.#failure !== null,
    });
  }

  #enqueue(request) {
    if (this.#failure !== null) {
      return Promise.reject(this.#failure);
    }
    const objects = this.#writeObjects + 1;
    const bytes = this.#writeBytes + request.bytes;
    if (objects > this.#maxBatchObjects || bytes > this.#maxBatchBytes) {
      this.#failure = batchLimit({ objects, bytes }, {
        objects: this.#maxBatchObjects,
        bytes: this.#maxBatchBytes,
      });
      return Promise.reject(this.#failure);
    }
    this.#writeObjects = objects;
    this.#writeBytes = bytes;
    const result = new Promise((resolve, reject) => {
      this.#queue.push({ ...request, resolve, reject });
    });
    this.#schedule();
    return result;
  }

  #schedule() {
    if (this.#scheduled || this.#flushing) {
      return;
    }
    this.#scheduled = true;
    void Promise.resolve().then(() => {
      this.#scheduled = false;
      return this.#drain();
    });
  }

  async #drain() {
    if (this.#flushing) {
      return;
    }
    this.#flushing = true;
    try {
      while (this.#queue.length > 0 && this.#failure === null) {
        const group = this.#takeGroup();
        await this.#writeGroup(group);
      }
    } catch (error) {
      this.#failure = error;
    } finally {
      if (this.#failure !== null) {
        this.#rejectQueued(this.#failure);
      }
      this.#flushing = false;
      if (this.#queue.length > 0) {
        this.#schedule();
      }
    }
  }

  #takeGroup() {
    const first = this.#queue[0];
    const group = [];
    let bytes = 0;
    while (group.length < MAX_PROTOCOL_OBJECTS && this.#queue[0]?.kind === first.kind) {
      const next = this.#queue[0];
      if (group.length > 0 && bytes + next.bytes > MAX_PROTOCOL_BYTES) {
        break;
      }
      group.push(this.#queue.shift());
      bytes += next.bytes;
      if (next.bytes > MAX_PROTOCOL_BYTES) {
        break;
      }
    }
    return group;
  }

  async #writeGroup(group) {
    try {
      const oids = group.length === 1 || group[0].bytes > MAX_PROTOCOL_BYTES
        ? [await this.#writeOne(group[0])]
        : await this.#writeMany(group);
      if (oids.length !== group.length) {
        throw createCasError(
          'Persistence returned the wrong number of write-wave object identifiers',
          ErrorCodes.GIT_ERROR,
          { expected: group.length, actual: oids.length },
        );
      }
      group.forEach((request, index) => request.resolve(oids[index]));
    } catch (error) {
      group.forEach((request) => request.reject(error));
      throw error;
    }
  }

  async #writeOne(request) {
    return request.kind === 'blob'
      ? await this.#persistence.writeBlob(request.value)
      : await this.#persistence.writeTree(request.value);
  }

  async #writeMany(group) {
    const values = group.map((request) => request.value);
    if (group[0].kind === 'blob' && typeof this.#persistence.writeBlobs === 'function') {
      return await this.#persistence.writeBlobs(values);
    }
    if (group[0].kind === 'tree' && typeof this.#persistence.writeTrees === 'function') {
      return await this.#persistence.writeTrees(values);
    }
    const oids = [];
    for (const request of group) {
      oids.push(await this.#writeOne(request));
    }
    return oids;
  }

  #rejectQueued(error) {
    for (const request of this.#queue.splice(0)) {
      request.reject(error);
    }
  }
}

function contentBytes(content) {
  if (content instanceof Uint8Array) {
    return content.byteLength;
  }
  if (typeof content === 'string') {
    return utf8ByteLength(content);
  }
  return Number.MAX_SAFE_INTEGER;
}

function treeBytes(entries) {
  if (!Array.isArray(entries)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return entries.reduce((total, line) => total + utf8ByteLength(line) + 1, 0);
}

function batchLimit(observed, maximum) {
  return createCasError(
    'Asset write batch exceeds its configured aggregate limit',
    ErrorCodes.INVALID_OPTIONS,
    { observed, maximum },
  );
}
