import createCasError from '../domain/errors/createCasError.js';
import { ErrorCodes } from '../domain/errors/index.js';

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

  /**
   * Atomically verifies one source ref and creates a new ref to its generation.
   * @param {Object} _options
   * @param {string} _options.sourceRef
   * @param {string} _options.expectedSourceOid
   * @param {string} _options.targetRef
   * @returns {Promise<boolean>} Whether the source generation was anchored.
   */
  async anchorRef(_options) {
    throw unsupportedAcquisitionCapability('anchorRef');
  }

  /**
   * Deletes a ref only when it still names the expected object.
   * @param {Object} _options
   * @param {string} _options.ref
   * @param {string} _options.expectedOldOid
   * @returns {Promise<boolean>} Whether the ref existed and was deleted.
   */
  async deleteRef(_options) {
    throw unsupportedAcquisitionCapability('deleteRef');
  }

  /**
   * Streams refs below a canonical Git ref prefix.
   * @param {Object} _options
   * @param {string} [_options.prefix]
   * @param {string|null} [_options.after] Exclusive ref-name continuation cursor.
   * @param {number} _options.limit Maximum records to request from Git.
   * @returns {AsyncIterable<{ref: string, oid: string, symref: string|null}>}
   */
  iterateRefs(_options) {
    throw unsupportedAcquisitionCapability('iterateRefs');
  }
}

function unsupportedAcquisitionCapability(capability) {
  return createCasError(
    `Git ref adapter does not implement cache acquisition capability: ${capability}`,
    ErrorCodes.CACHE_ACQUISITION_INVALID,
    { capability },
  );
}
