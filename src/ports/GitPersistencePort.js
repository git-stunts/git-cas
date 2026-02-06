/**
 * Abstract port for persisting data to Git's object database.
 * @abstract
 */
export default class GitPersistencePort {
  /**
   * Writes content as a Git blob object.
   * @param {Buffer|string} content - Data to store.
   * @returns {Promise<string>} The Git OID of the stored blob.
   */
  async writeBlob(_content) {
    throw new Error('Not implemented');
  }

  /**
   * Creates a Git tree object from formatted entries.
   * @param {string[]} entries - Lines in `git mktree` format.
   * @returns {Promise<string>} The Git OID of the created tree.
   */
  async writeTree(_entries) {
    throw new Error('Not implemented');
  }

  /**
   * Reads a Git blob by its OID.
   * @param {string} oid - Git object ID.
   * @returns {Promise<Buffer>} The blob content.
   */
  async readBlob(_oid) {
    throw new Error('Not implemented');
  }

  /**
   * Reads and parses a Git tree object.
   * @param {string} treeOid - Git tree OID.
   * @returns {Promise<Array<{ mode: string, type: string, oid: string, name: string }>>} Parsed tree entries.
   */
  async readTree(_treeOid) {
    throw new Error('Not implemented');
  }
}
