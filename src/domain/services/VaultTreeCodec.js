import CasError from '../errors/CasError.js';
import Slug from '../value-objects/Slug.js';

export const VAULT_METADATA_ENTRY = '.vault.json';
export const VAULT_PRIVACY_INDEX_ENTRY = '.privacy-index';
export const GIT_TREE_MODE = '040000';
export const GIT_BLOB_MODE = '100644';
export const GIT_TREE_TYPE = 'tree';
export const GIT_BLOB_TYPE = 'blob';

/**
 * Pure codec for the vault's structured Git tree records.
 */
export default class VaultTreeCodec {
  /**
   * @param {Map<string, string>} entries
   * @returns {Array<{ mode: string, type: string, oid: string, name: string }>}
   */
  assetRecordsFromPlainEntries(entries) {
    const records = [];
    for (const [slug, treeOid] of entries) {
      records.push(this.assetRecord(Slug.from(slug).toTreePath(), treeOid));
    }
    return records;
  }

  /**
   * @param {Map<string, string>} entries
   * @param {Map<string, string>} persistedNameBySlug
   * @returns {Array<{ mode: string, type: string, oid: string, name: string }>}
   */
  assetRecordsFromPersistedNames(entries, persistedNameBySlug) {
    const records = [];
    for (const [slug, treeOid] of entries) {
      const persistedName = persistedNameBySlug.get(slug);
      if (!persistedName) {
        throw new CasError(
          `Vault persisted name missing for slug "${slug}"`,
          'VAULT_PRIVACY_INDEX_MISSING',
          { slug },
        );
      }
      records.push(this.assetRecord(persistedName, treeOid));
    }
    return records;
  }

  /**
   * @param {string} name
   * @param {string} treeOid
   * @returns {{ mode: string, type: string, oid: string, name: string }}
   */
  assetRecord(name, treeOid) {
    return { mode: GIT_TREE_MODE, type: GIT_TREE_TYPE, oid: treeOid, name };
  }

  /**
   * @param {string} blobOid
   * @returns {{ mode: string, type: string, oid: string, name: string }}
   */
  metadataRecord(blobOid) {
    return { mode: GIT_BLOB_MODE, type: GIT_BLOB_TYPE, oid: blobOid, name: VAULT_METADATA_ENTRY };
  }

  /**
   * @param {string} blobOid
   * @returns {{ mode: string, type: string, oid: string, name: string }}
   */
  privacyIndexRecord(blobOid) {
    return { mode: GIT_BLOB_MODE, type: GIT_BLOB_TYPE, oid: blobOid, name: VAULT_PRIVACY_INDEX_ENTRY };
  }

  /**
   * @param {Array<{ mode: string, type: string, oid: string, name: string }>} records
   * @returns {string[]}
   */
  toTreeLines(records) {
    return records.map((record) => (
      `${record.mode} ${record.type} ${record.oid}\t${this.#validatePersistedName(record.name)}`
    ));
  }

  /**
   * @param {Array<{ mode: string, type: string, oid: string, name: string }>} treeEntries
   * @param {object} [options]
   * @param {boolean} [options.privacyEnabled]
   * @returns {{ entries: Map<string, string>, metadataBlobOid: string|null, privacyIndexBlobOid: string|null }}
   */
  parseTreeEntries(treeEntries, { privacyEnabled = false } = {}) {
    const entries = new Map();
    let metadataBlobOid = null;
    let privacyIndexBlobOid = null;
    for (const entry of treeEntries) {
      if (entry.name === VAULT_METADATA_ENTRY) {
        metadataBlobOid = entry.oid;
      } else if (entry.name === VAULT_PRIVACY_INDEX_ENTRY) {
        privacyIndexBlobOid = entry.oid;
      } else {
        const key = privacyEnabled ? entry.name : Slug.from(Slug.decode(entry.name)).toString();
        entries.set(key, entry.oid);
      }
    }
    return { entries, metadataBlobOid, privacyIndexBlobOid };
  }

  /**
   * @param {string} name
   * @returns {string}
   */
  #validatePersistedName(name) {
    if (typeof name !== 'string' || name.length === 0 || Slug.hasControlChars(name)) {
      throw new CasError(
        'Vault tree entry name is invalid for git mktree',
        'INVALID_SLUG',
        { treePath: name },
      );
    }
    return name;
  }
}
