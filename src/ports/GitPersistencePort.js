/**
 * Abstract port for persisting data to Git's object database.
 * @abstract
 */
export default class GitPersistencePort {
  /**
   * Writes content as a Git blob object.
   * @param {Uint8Array} _content - Data to store.
   * @returns {Promise<string>} The Git OID of the stored blob.
   */
  async writeBlob(_content) {
    throw new Error('Not implemented');
  }

  /**
   * Writes a bounded group of blobs. Adapters may override this to amortize
   * process startup while preserving visibility before the method resolves.
   * @param {Iterable<Uint8Array>} contents
   * @returns {Promise<string[]>}
   */
  async writeBlobs(contents) {
    const oids = [];
    for (const content of contents) {
      oids.push(await this.writeBlob(content));
    }
    return oids;
  }

  /**
   * Creates a Git tree object from formatted entries.
   * @param {string[]} _entries - Lines in `git mktree` format.
   * @returns {Promise<string>} The Git OID of the created tree.
   */
  async writeTree(_entries) {
    throw new Error('Not implemented');
  }

  /**
   * Reads a Git blob by its OID.
   * @param {string} _oid - Git object ID.
   * @param {number} [_maxBytes] - Maximum bytes the adapter may materialize.
   * @returns {Promise<Uint8Array>} The blob content.
   */
  async readBlob(_oid, _maxBytes) {
    throw new Error('Not implemented');
  }

  /**
   * Reads a Git blob by its OID as an async byte stream.
   * Required for hard-limited buffered restore modes. `readBlob()` remains a
   * compatibility fallback for plaintext restore only.
   * @param {string} _oid - Git object ID.
   * @returns {Promise<AsyncIterable<Uint8Array>>} The blob byte stream.
   */
  async readBlobStream(_oid) {
    throw new Error('Not implemented');
  }

  /**
   * Reads and parses a Git tree object.
   * @param {string} _treeOid - Git tree OID.
   * @returns {Promise<Array<{ mode: string, type: string, oid: string, name: string }>>} Parsed tree entries.
   */
  async readTree(_treeOid) {
    throw new Error('Not implemented');
  }

  /**
   * Reads one Git tree entry by path without enumerating the full tree.
   * @param {string} _treeOid - Git tree OID.
   * @param {string} _treePath - Tree entry path/name to resolve.
   * @returns {Promise<{ mode: string, type: string, oid: string, name: string }|null>} Parsed entry or null.
   */
  async readTreeEntry(_treeOid, _treePath) {
    throw new Error('Not implemented');
  }

  /**
   * Streams parsed Git tree entries.
   * @param {string} _treeOid - Git tree OID.
   * @returns {AsyncIterable<{ mode: string, type: string, oid: string, name: string }>}
   */
  iterateTree(_treeOid) {
    throw new Error('Not implemented');
  }

  /**
   * Reads the Git object type without materializing object content.
   * @param {string} _oid - Git object ID.
   * @returns {Promise<string>} Git object type such as `blob`, `tree`, or `commit`.
   */
  async readObjectType(_oid) {
    throw new Error('Not implemented');
  }

  /**
   * Reads the Git object size without materializing object content.
   * @param {string} _oid - Git object ID.
   * @returns {Promise<number>} Object size in bytes.
   */
  async readObjectSize(_oid) {
    throw new Error('Not implemented');
  }

  /**
   * Releases adapter-owned local resources. The default implementation is a
   * no-op so persistence adapters without long-lived resources remain valid.
   * @returns {Promise<void>}
   */
  async close() {}

  /** @returns {Promise<void>} */
  async [Symbol.asyncDispose]() {
    await this.close();
  }
}
