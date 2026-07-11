import { createHash } from 'node:crypto';
import GitPersistencePort from '../../src/ports/GitPersistencePort.js';
import { CasError, ErrorCodes } from '../../src/domain/errors/index.js';

function copyBytes(content) {
  return Uint8Array.from(content);
}

function objectOid(type, content) {
  return createHash('sha1')
    .update(type)
    .update('\0')
    .update(Buffer.from(content))
    .digest('hex');
}

function parseTreeEntry(entry) {
  const tabIndex = entry.indexOf('\t');
  if (tabIndex === -1) {
    throw new Error(`Malformed tree entry: ${entry}`);
  }

  const meta = entry.slice(0, tabIndex).split(' ');
  if (meta.length !== 3) {
    throw new Error(`Malformed tree entry: ${entry}`);
  }

  return {
    mode: meta[0],
    type: meta[1],
    oid: meta[2],
    name: entry.slice(tabIndex + 1),
  };
}

/**
 * In-memory Git persistence adapter for fast domain tests.
 */
export default class MemoryPersistenceAdapter extends GitPersistencePort {
  #blobs = new Map();
  #trees = new Map();

  get blobCount() {
    return this.#blobs.size;
  }

  get treeCount() {
    return this.#trees.size;
  }

  async writeBlob(content) {
    const bytes = copyBytes(content);
    const oid = objectOid('blob', bytes);
    this.#blobs.set(oid, bytes);
    return oid;
  }

  async writeTree(entries) {
    const normalized = [...entries];
    const oid = objectOid('tree', Buffer.from(normalized.join('\n')));
    this.#trees.set(oid, normalized.map(parseTreeEntry));
    return oid;
  }

  async readBlob(oid) {
    const bytes = this.#blobs.get(oid);
    if (!bytes) {
      throw new Error(`Blob not found: ${oid}`);
    }
    return copyBytes(bytes);
  }

  async readBlobStream(oid) {
    const bytes = await this.readBlob(oid);
    return (async function* streamBlob() {
      yield bytes;
    })();
  }

  async readTree(treeOid) {
    const entries = this.#trees.get(treeOid);
    if (!entries) {
      throw new Error(`Tree not found: ${treeOid}`);
    }
    return entries.map((entry) => ({ ...entry }));
  }

  async readTreeEntry(treeOid, treePath) {
    const entries = await this.readTree(treeOid);
    return entries.find((entry) => entry.name === treePath) || null;
  }

  async *iterateTree(treeOid) {
    for (const entry of await this.readTree(treeOid)) {
      yield entry;
    }
  }

  async readObjectType(oid) {
    if (this.#blobs.has(oid)) {
      return 'blob';
    }
    if (this.#trees.has(oid)) {
      return 'tree';
    }
    throw new CasError(`Object not found: ${oid}`, ErrorCodes.GIT_OBJECT_NOT_FOUND, { oid });
  }
}
