/**
 * Abstract port for Git ref and commit operations.
 * @abstract
 */
export default class GitRefPort {
  /**
   * Resolves a Git ref to its commit OID.
   * @param {string} _ref - Git ref (e.g. 'refs/cas/vault').
   * @returns {Promise<string>} The commit OID.
   * @throws If the ref does not exist.
   */
  async resolveRef(_ref) {
    throw new Error('Not implemented');
  }

  /**
   * Resolves the tree OID from a commit OID.
   * @param {string} _commitOid - Git commit OID.
   * @returns {Promise<string>} The tree OID.
   */
  async resolveTree(_commitOid) {
    throw new Error('Not implemented');
  }

  /**
   * Resolves the direct parent OIDs from a commit OID.
   * @param {string} _commitOid - Git commit OID.
   * @returns {Promise<string[]>} Direct parent OIDs; empty for a root commit.
   */
  async resolveParents(_commitOid) {
    throw new Error('Not implemented');
  }

  /**
   * Creates a Git commit object.
   * @param {Object} _options
   * @param {string} _options.treeOid - Tree OID for the commit.
   * @param {string|null} [_options.parentOid] - Parent commit OID (null for root commit).
   * @param {string[]} [_options.parentOids] - Ordered parent commit OIDs.
   * @param {string} _options.message - Commit message.
   * @returns {Promise<string>} The new commit OID.
   */
  async createCommit(_options) {
    throw new Error('Not implemented');
  }

  /**
   * Atomically updates a Git ref with optional CAS (compare-and-swap) semantics.
   * @param {Object} _options
   * @param {string} _options.ref - Git ref to update.
   * @param {string} _options.newOid - New OID to set.
   * @param {string|null} [_options.expectedOldOid] - Expected current OID for CAS; `null` means the ref must not exist.
   * @returns {Promise<void>}
   */
  async updateRef(_options) {
    throw new Error('Not implemented');
  }
}
