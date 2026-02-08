/**
 * Abstract port for Git ref and commit operations.
 * @abstract
 */
export default class GitRefPort {
  /**
   * Resolves a Git ref to its commit OID.
   * @param {string} ref - Git ref (e.g. 'refs/cas/vault').
   * @returns {Promise<string>} The commit OID.
   * @throws If the ref does not exist.
   */
  async resolveRef(_ref) {
    throw new Error('Not implemented');
  }

  /**
   * Resolves the tree OID from a commit OID.
   * @param {string} commitOid - Git commit OID.
   * @returns {Promise<string>} The tree OID.
   */
  async resolveTree(_commitOid) {
    throw new Error('Not implemented');
  }

  /**
   * Creates a Git commit object.
   * @param {Object} options
   * @param {string} options.treeOid - Tree OID for the commit.
   * @param {string|null} [options.parentOid] - Parent commit OID (null for root commit).
   * @param {string} options.message - Commit message.
   * @returns {Promise<string>} The new commit OID.
   */
  async createCommit(_options) {
    throw new Error('Not implemented');
  }

  /**
   * Atomically updates a Git ref with optional CAS (compare-and-swap) semantics.
   * @param {Object} options
   * @param {string} options.ref - Git ref to update.
   * @param {string} options.newOid - New OID to set.
   * @param {string|null} [options.expectedOldOid] - Expected current OID for CAS. If provided and mismatched, throws.
   * @returns {Promise<void>}
   */
  async updateRef(_options) {
    throw new Error('Not implemented');
  }
}
