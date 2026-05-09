/**
 * Cache for parse-stable vault tree snapshots keyed by immutable tree OID.
 */
export default class VaultStateCache {
  /** @type {Map<string, object>} */
  #trees = new Map();

  /**
   * @param {string} treeOid
   * @returns {object|undefined}
   */
  get(treeOid) {
    return this.#trees.get(treeOid);
  }

  /**
   * @param {string} treeOid
   * @param {{ rawEntries: Array<object>, metadata: object|null }} snapshot
   * @returns {object}
   */
  rememberTree(treeOid, snapshot) {
    const cached = {
      rawEntries: snapshot.rawEntries.map((entry) => ({ ...entry })),
      metadata: cloneMetadata(snapshot.metadata),
      plainEntries: null,
      privacyEntriesByKey: new WeakMap(),
      verifiedEncryptionKeys: new WeakMap(),
    };
    this.#trees.set(treeOid, cached);
    return cached;
  }

  /**
   * @param {object} snapshot
   * @param {(rawEntries: Array<object>) => Map<string, string>} parseEntries
   * @returns {Map<string, string>}
   */
  plainEntries(snapshot, parseEntries) {
    if (!snapshot.plainEntries) {
      snapshot.plainEntries = parseEntries(snapshot.rawEntries);
    }
    return new Map(snapshot.plainEntries);
  }

  /**
   * @param {object} snapshot
   * @param {Uint8Array} encryptionKey
   * @param {(rawEntries: Array<object>, metadata: object|null, encryptionKey: Uint8Array) => Promise<Map<string, string>>} resolveEntries
   * @returns {Promise<Map<string, string>>}
   */
  async privacyEntries(snapshot, encryptionKey, resolveEntries) {
    let cached = snapshot.privacyEntriesByKey.get(encryptionKey);
    if (!cached || !bytesEqual(cached.keyBytes, encryptionKey)) {
      cached = {
        entries: await resolveEntries(snapshot.rawEntries, snapshot.metadata, encryptionKey),
        keyBytes: cloneBytes(encryptionKey),
      };
      snapshot.privacyEntriesByKey.set(encryptionKey, cached);
    }
    return new Map(cached.entries);
  }

  /**
   * @param {object} snapshot
   * @param {Uint8Array} encryptionKey
   * @returns {boolean}
   */
  hasVerifiedEncryptionKey(snapshot, encryptionKey) {
    const verifiedKeyBytes = snapshot.verifiedEncryptionKeys.get(encryptionKey);
    return Boolean(verifiedKeyBytes && bytesEqual(verifiedKeyBytes, encryptionKey));
  }

  /**
   * @param {object} snapshot
   * @param {Uint8Array} encryptionKey
   */
  rememberVerifiedEncryptionKey(snapshot, encryptionKey) {
    snapshot.verifiedEncryptionKeys.set(encryptionKey, cloneBytes(encryptionKey));
  }

  /**
   * @param {object} options
   * @param {Map<string, string>} options.entries
   * @param {object|null} options.metadata
   * @param {string|null} options.parentCommitOid
   * @returns {{ entries: Map<string, string>, parentCommitOid: string|null, metadata: object|null }}
   */
  toState({ entries, metadata, parentCommitOid }) {
    return {
      entries: new Map(entries),
      parentCommitOid,
      metadata: cloneMetadata(metadata),
    };
  }
}

/**
 * @param {object|null} metadata
 * @returns {object|null}
 */
function cloneMetadata(metadata) {
  return metadata ? JSON.parse(JSON.stringify(metadata)) : null;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function cloneBytes(bytes) {
  return Uint8Array.from(bytes);
}

/**
 * @param {Uint8Array} left
 * @param {Uint8Array} right
 * @returns {boolean}
 */
function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.byteLength; i += 1) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}
