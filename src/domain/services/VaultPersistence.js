import CasError from '../errors/CasError.js';
import VaultMetadataCodec from './VaultMetadataCodec.js';
import VaultTreeCodec, {
  VAULT_METADATA_ENTRY,
  VAULT_PRIVACY_INDEX_ENTRY,
} from './VaultTreeCodec.js';
import { ErrorCodes } from '../errors/index.js';

export const VAULT_REF = 'refs/cas/vault';
const GIT_REF_NOT_FOUND_CODE = 'GIT_REF_NOT_FOUND';
const MISSING_REF_MARKERS = Object.freeze({
  ambiguousArgument: 'ambiguous argument',
  neededSingleRevision: 'needed a single revision',
  unknownRevision: 'unknown revision',
});

/**
 * Stateless persistence boundary for the vault ref and vault tree format.
 */
export default class VaultPersistence {
  /**
   * @param {object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/GitRefPort.js').default} options.ref
   * @param {VaultTreeCodec} [options.treeCodec]
   * @param {VaultMetadataCodec} [options.metadataCodec]
   */
  constructor({
    persistence,
    ref,
    treeCodec = new VaultTreeCodec(),
    metadataCodec = new VaultMetadataCodec(),
  }) {
    validatePersistence(persistence);
    validateRef(ref);
    this.persistence = persistence;
    this.ref = ref;
    this.treeCodec = treeCodec;
    this.metadataCodec = metadataCodec;
    Object.freeze(this);
  }

  /**
   * @returns {Promise<{ commitOid: string, treeOid: string }|null>}
   */
  async resolveHead() {
    let commitOid;
    try {
      commitOid = await this.ref.resolveRef(VAULT_REF);
    } catch (err) {
      if (isMissingVaultRefError(err)) {
        return null;
      }
      throw buildInvalidHeadError('Vault head ref could not be resolved', err);
    }

    try {
      return { commitOid, treeOid: await this.ref.resolveTree(commitOid) };
    } catch (err) {
      throw buildInvalidHeadError('Vault head commit does not resolve to a tree', err, { commitOid });
    }
  }

  /**
   * @param {string} treeOid
   * @returns {Promise<{ rawEntries: Array<object>, metadata: object|null }>}
   */
  async readTreeSnapshot(treeOid) {
    const rawEntries = await this.persistence.readTree(treeOid);
    const { metadataBlobOid } = this.treeCodec.parseTreeEntries(rawEntries);
    const metadata = metadataBlobOid ? await this.readMetadataBlob(metadataBlobOid) : null;
    return { rawEntries, metadata };
  }

  /**
   * @param {string} treeOid
   * @returns {Promise<object|null>}
   */
  async readMetadata(treeOid) {
    return (await this.readMetadataSnapshot(treeOid)).metadata;
  }

  /**
   * @param {string} treeOid
   * @returns {Promise<{ metadata: object|null, snapshot: { rawEntries: Array<object>, metadata: object|null }|null }>}
   */
  async readMetadataSnapshot(treeOid) {
    const direct = await this.#readDirectTreeEntry(treeOid, VAULT_METADATA_ENTRY);
    if (direct !== undefined) {
      return {
        metadata: direct ? await this.readMetadataBlob(direct.oid) : null,
        snapshot: null,
      };
    }
    const iterator = this.#treeIterator(treeOid);
    if (iterator) {
      for await (const entry of iterator) {
        if (entry.name === VAULT_METADATA_ENTRY) {
          return { metadata: await this.readMetadataBlob(entry.oid), snapshot: null };
        }
      }
      return { metadata: null, snapshot: null };
    }
    const snapshot = await this.readTreeSnapshot(treeOid);
    return { metadata: snapshot.metadata, snapshot };
  }

  /**
   * @param {string} blobOid
   * @returns {Promise<object>}
   */
  async readMetadataBlob(blobOid) {
    return this.metadataCodec.decode(await this.persistence.readBlob(blobOid));
  }

  /**
   * @param {string} blobOid
   * @returns {Promise<Uint8Array>}
   */
  async readBlob(blobOid) {
    return await this.persistence.readBlob(blobOid);
  }

  /**
   * @param {string} treeOid
   * @param {string} treePath
   * @returns {Promise<object|null>}
   */
  async readEntry(treeOid, treePath) {
    const direct = await this.#readDirectTreeEntry(treeOid, treePath);
    if (direct !== undefined) {
      return direct;
    }
    const entries = await this.persistence.readTree(treeOid);
    return entries.find((entry) => entry.name === treePath) || null;
  }

  /**
   * @param {string} treeOid
   * @returns {AsyncIterable<object>}
   */
  async *iterateEntries(treeOid) {
    const iterator = this.#treeIterator(treeOid);
    if (iterator) {
      yield* iterator;
      return;
    }
    for (const entry of await this.persistence.readTree(treeOid)) {
      yield entry;
    }
  }

  /**
   * @param {object} options
   * @param {Map<string, string>} options.entries
   * @param {Map<string, string>} [options.persistedNameBySlug]
   * @param {Uint8Array} [options.privacyIndexBytes]
   * @param {object} options.metadata
   * @param {string|null} options.parentCommitOid
   * @param {string} options.message
   * @returns {Promise<{ commitOid: string }>}
   */
  async writeCommit({
    entries,
    persistedNameBySlug,
    privacyIndexBytes,
    metadata,
    parentCommitOid,
    message,
  }) {
    const records = persistedNameBySlug
      ? this.treeCodec.assetRecordsFromPersistedNames(entries, persistedNameBySlug)
      : this.treeCodec.assetRecordsFromPlainEntries(entries);

    if (privacyIndexBytes) {
      const privacyIndexBlobOid = await this.persistence.writeBlob(privacyIndexBytes);
      records.push(this.treeCodec.privacyIndexRecord(privacyIndexBlobOid));
    }

    const metadataBlobOid = await this.persistence.writeBlob(this.metadataCodec.encode(metadata));
    records.unshift(this.treeCodec.metadataRecord(metadataBlobOid));
    const newTreeOid = await this.persistence.writeTree(this.treeCodec.toTreeLines(records));
    const commitOid = await this.ref.createCommit({
      treeOid: newTreeOid,
      parentOid: parentCommitOid,
      message,
    });
    await this.#casUpdateRef(commitOid, parentCommitOid);
    return { commitOid };
  }

  /**
   * @param {string} treeOid
   * @param {string} treePath
   * @returns {Promise<object|null|undefined>}
   */
  async #readDirectTreeEntry(treeOid, treePath) {
    if (typeof this.persistence.readTreeEntry !== 'function') {
      return undefined;
    }
    return await this.persistence.readTreeEntry(treeOid, treePath);
  }

  /**
   * @param {string} treeOid
   * @returns {AsyncIterable<object>|null}
   */
  #treeIterator(treeOid) {
    const iterator = typeof this.persistence.iterateTree === 'function'
      ? this.persistence.iterateTree(treeOid)
      : null;
    return iterator && typeof iterator[Symbol.asyncIterator] === 'function'
      ? iterator
      : null;
  }

  /**
   * @param {string} newOid
   * @param {string|null} expectedOldOid
   */
  async #casUpdateRef(newOid, expectedOldOid) {
    try {
      await this.ref.updateRef({
        ref: VAULT_REF,
        newOid,
        expectedOldOid,
      });
    } catch (err) {
      throw new CasError(
        'Concurrent vault update detected',
        ErrorCodes.VAULT_CONFLICT,
        {
          expectedOldOid,
          actualOldOid: await this.#resolveActualOid(),
          newCommit: newOid,
          originalError: err,
        },
      );
    }
  }

  /**
   * @returns {Promise<string|null>}
   */
  async #resolveActualOid() {
    try {
      return await this.ref.resolveRef(VAULT_REF);
    } catch {
      return null;
    }
  }
}

/**
 * @param {object} persistence
 */
function validatePersistence(persistence) {
  const required = ['writeBlob', 'writeTree', 'readBlob', 'readTree'];
  const missing = required.filter((method) => typeof persistence?.[method] !== 'function');
  if (missing.length > 0) {
    throw new CasError(
      'VaultPersistence requires a complete GitPersistencePort',
      ErrorCodes.VAULT_DEPENDENCY_INVALID,
      { missing },
    );
  }
}

/**
 * @param {object} ref
 */
function validateRef(ref) {
  const required = ['resolveRef', 'resolveTree', 'createCommit', 'updateRef'];
  const missing = required.filter((method) => typeof ref?.[method] !== 'function');
  if (missing.length > 0) {
    throw new CasError(
      'VaultPersistence requires a complete GitRefPort',
      ErrorCodes.VAULT_DEPENDENCY_INVALID,
      { missing },
    );
  }
}

/**
 * @param {string} message
 * @param {unknown} originalError
 * @param {object} [meta]
 * @returns {CasError}
 */
function buildInvalidHeadError(message, originalError, meta = {}) {
  return new CasError(message, ErrorCodes.VAULT_HEAD_INVALID, {
    vaultHead: VAULT_REF,
    ...meta,
    originalError,
  });
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isMissingVaultRefError(err) {
  if (typeof err?.code === 'string' && err.code === GIT_REF_NOT_FOUND_CODE) {
    return true;
  }
  const message = errorDetailsText(err);
  return isGitMissingRefMessage(message);
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isGitMissingRefMessage(message) {
  const normalized = message.toLowerCase();
  if (!normalized.includes(VAULT_REF)) {
    return false;
  }
  return (
    normalized.includes(MISSING_REF_MARKERS.neededSingleRevision) ||
    (
      normalized.includes(MISSING_REF_MARKERS.ambiguousArgument) &&
      normalized.includes(MISSING_REF_MARKERS.unknownRevision)
    )
  );
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorDetailsText(err) {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const details = typeof err.details === 'object' && err.details ? err.details : {};
  return [
    err.message,
    typeof details.stderr === 'string' ? details.stderr : '',
    typeof details.stdout === 'string' ? details.stdout : '',
  ].join('\n');
}

export { VAULT_METADATA_ENTRY, VAULT_PRIVACY_INDEX_ENTRY };
