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
      cached = this.#startPrivacyEntryResolution(snapshot, encryptionKey, resolveEntries);
      snapshot.privacyEntriesByKey.set(encryptionKey, cached);
    }
    const entries = cached.entries || await cached.pending;
    return new Map(entries);
  }

  /**
   * @param {object} snapshot
   * @param {Uint8Array} encryptionKey
   * @param {(rawEntries: Array<object>, metadata: object|null, encryptionKey: Uint8Array) => Promise<Map<string, string>>} resolveEntries
   * @returns {{ keyBytes: Uint8Array, entries: Map<string, string>|null, pending: Promise<Map<string, string>> }}
   */
  #startPrivacyEntryResolution(snapshot, encryptionKey, resolveEntries) {
    const cached = {
      entries: null,
      keyBytes: cloneBytes(encryptionKey),
      pending: null,
    };
    cached.pending = this.#resolvePrivacyEntries({
      cached,
      encryptionKey,
      resolveEntries,
      snapshot,
    });
    return cached;
  }

  /**
   * @param {object} context
   * @param {{ entries: Map<string, string>|null, pending: Promise<Map<string, string>>|null }} context.cached
   * @param {Uint8Array} context.encryptionKey
   * @param {(rawEntries: Array<object>, metadata: object|null, encryptionKey: Uint8Array) => Promise<Map<string, string>>} context.resolveEntries
   * @param {object} context.snapshot
   * @returns {Promise<Map<string, string>>}
   */
  async #resolvePrivacyEntries({ cached, encryptionKey, resolveEntries, snapshot }) {
    try {
      const entries = await resolveEntries(snapshot.rawEntries, snapshot.metadata, encryptionKey);
      cached.entries = entries;
      return entries;
    } catch (err) {
      if (snapshot.privacyEntriesByKey.get(encryptionKey) === cached) {
        snapshot.privacyEntriesByKey.delete(encryptionKey);
      }
      throw err;
    } finally {
      cached.pending = null;
    }
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
