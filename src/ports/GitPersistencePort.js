/**
 * Port for persisting data to Git.
 */
export default class GitPersistencePort {
  /**
   * @param {Buffer|string} content
   * @returns {Promise<string>} The Git OID of the stored blob.
   */
  async writeBlob(_content) {
    throw new Error('Not implemented');
  }

  /**
   * @param {string[]} entries - Lines for git mktree.
   * @returns {Promise<string>} The Git OID of the created tree.
   */
  async writeTree(_entries) {
    throw new Error('Not implemented');
  }

  /**
   * @param {string} oid
   * @returns {Promise<Buffer>}
   */
  async readBlob(_oid) {
    throw new Error('Not implemented');
  }

  /**
   * @param {string} treeOid
   * @returns {Promise<Array<{ mode: string, type: string, oid: string, name: string }>>}
   */
  async readTree(_treeOid) {
    throw new Error('Not implemented');
  }
}
