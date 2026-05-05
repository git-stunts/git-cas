/**
 * @fileoverview Domain service for vault (GC-safe ref-based asset index) operations.
 */
import CasError from '../errors/CasError.js';
import buildKdfMetadata from '../helpers/buildKdfMetadata.js';
import { prepareKdfOptions, prepareStoredKdfOptions } from '../../helpers/kdfPolicy.js';
import validateAesGcmMeta from '../../helpers/aesGcmMeta.js';
import { decodeBase64, encodeBase64 } from '../encoding/base64.js';
import { encodeHex } from '../encoding/hex.js';
import { utf8Decode, utf8Encode } from '../encoding/utf8.js';
import Slug from '../value-objects/Slug.js';

const VAULT_REF = 'refs/cas/vault';
const MAX_CAS_RETRIES = 3;
const CAS_RETRY_BASE_MS = 50;
const PRIVACY_DERIVATION_LABEL = 'git-cas-privacy-v1';
const PRIVACY_INDEX_ENTRY = '.privacy-index';
const VAULT_VERIFIER_PLAINTEXT = utf8Encode('git-cas-vault-verifier-v1');
const VAULT_VERIFIER_AAD = utf8Encode('git-cas-vault-verifier-metadata-v1');

/**
 * Vault key verifier stored in .vault.json.
 * @typedef {Object} VaultEncryptionVerifier
 * @property {number} version - Verifier format version.
 * @property {string} ciphertext - Base64 ciphertext of the verifier plaintext.
 * @property {import('../../ports/CryptoPort.js').EncryptionMeta} meta - AES-GCM metadata.
 */

/**
 * Vault encryption metadata stored in .vault.json.
 * @typedef {Object} VaultEncryptionMeta
 * @property {string} cipher - Cipher algorithm (e.g. 'aes-256-gcm').
 * @property {{ algorithm: string, salt: string, iterations?: number, cost?: number, blockSize?: number, parallelization?: number, keyLength: number }} kdf - KDF parameters.
 * @property {VaultEncryptionVerifier} [verifier] - Encrypted verifier for the vault key.
 */

/**
 * Vault metadata stored in .vault.json.
 * @typedef {Object} VaultMetadata
 * @property {number} version - Metadata version (currently 1).
 * @property {VaultEncryptionMeta} [encryption] - Encryption configuration.
 * @property {number} [encryptionCount] - Number of encrypted vault writes under the current key.
 */

/**
 * Vault state read from refs/cas/vault.
 * @typedef {Object} VaultState
 * @property {Map<string, string>} entries - Slug→treeOid map.
 * @property {string|null} parentCommitOid - Parent commit OID.
 * @property {VaultMetadata|null} metadata - Vault metadata.
 */

/**
 * Git tree entry shape returned by the persistence port.
 * @typedef {Object} VaultTreeEntry
 * @property {string} mode - Git file mode.
 * @property {string} type - Git object type.
 * @property {string} oid - Git object OID.
 * @property {string} name - Tree entry name.
 */

/**
 * Cached parse-stable vault tree data.
 * @typedef {Object} CachedVaultTree
 * @property {VaultTreeEntry[]} rawEntries - Raw tree entries from persistence.
 * @property {VaultMetadata|null} metadata - Parsed vault metadata.
 * @property {Map<string, string>|null} plainEntries - Parsed plain slug entries.
 * @property {WeakMap<Uint8Array, Map<string, string>>} privacyEntriesByKey - Privacy entries by key object.
 * @property {WeakSet<Uint8Array>} verifiedEncryptionKeys - Vault keys already checked against metadata.
 */

/**
 * Domain service for vault operations.
 *
 * The vault is a GC-safe ref-based index that maps slugs to Git tree OIDs.
 * It is backed by a single Git ref (`refs/cas/vault`) pointing to a commit
 * chain. Each commit's tree contains one entry per stored asset plus a
 * `.vault.json` metadata blob.
 *
 * Requires three ports:
 * - `persistence` ({@link GitPersistencePort}) for blob/tree read/write
 * - `ref` ({@link GitRefPort}) for ref resolution, commits, and atomic updates
 * - `crypto` ({@link CryptoPort}) for KDF when vault-level encryption is enabled
 */
export default class VaultService {
  static VAULT_REF = VAULT_REF;

  /** @type {number} Nonce usage warning threshold (2^31). */
  static ENCRYPTION_COUNT_WARN = 2 ** 31;

  /** @type {number} Maximum encrypted vault writes before key rotation is required (2^32 - 1). */
  static ENCRYPTION_COUNT_MAX = 2 ** 32 - 1;

  /** @type {Map<string, CachedVaultTree>} */
  #stateCache = new Map();

  /**
   * @param {Object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/GitRefPort.js').default} options.ref
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {import('../../ports/ObservabilityPort.js').default} [options.observability]
   */
  constructor({ persistence, ref, crypto, observability }) {
    this.persistence = persistence;
    this.ref = ref;
    this.crypto = crypto;
    /** @type {import('../../ports/ObservabilityPort.js').default} */
    this.observability = observability || { metric() {}, log() {}, span: () => ({ end() {} }) };
  }

  /**
   * Validates a vault slug.
   * @param {string} slug
   * @throws {CasError} INVALID_SLUG if the slug is invalid.
   */
  validateSlug(slug) {
    Slug.validate(slug);
  }

  // ---------------------------------------------------------------------------
  // Metadata validation
  // ---------------------------------------------------------------------------

  /**
   * Validates encryption-specific metadata fields.
   * @param {VaultEncryptionMeta} encryption - Encryption metadata.
   * @param {VaultMetadata} metadata - Full metadata (for error context).
   */
  static #validateEncryption(encryption, metadata) {
    const { cipher, kdf } = encryption;
    if (!cipher || !kdf?.algorithm || !kdf?.salt || !kdf?.keyLength) {
      throw new CasError(
        'Vault encryption metadata missing required fields',
        'VAULT_METADATA_INVALID',
        { metadata },
      );
    }
    VaultService.#validateStoredKdf(kdf, metadata);
    if (encryption.verifier !== undefined) {
      VaultService.#validateVerifier(encryption.verifier, metadata);
    }
  }

  /**
   * Validates encrypted vault verifier metadata.
   * @param {VaultEncryptionVerifier} verifier
   * @param {VaultMetadata} metadata
   */
  static #validateVerifier(verifier, metadata) {
    const invalid = (
      typeof verifier !== 'object' ||
      verifier === null ||
      verifier.version !== 1 ||
      typeof verifier.ciphertext !== 'string' ||
      typeof verifier.meta !== 'object' ||
      verifier.meta === null
    );
    if (invalid) {
      throw new CasError(
        'Vault encryption verifier metadata missing required fields',
        'VAULT_METADATA_INVALID',
        { metadata, field: 'encryption.verifier' },
      );
    }

    try {
      decodeBase64(verifier.ciphertext);
      validateAesGcmMeta(verifier.meta);
    } catch (err) {
      throw new CasError(
        `Vault encryption verifier metadata invalid: ${/** @type {Error} */ (err).message}`,
        'VAULT_METADATA_INVALID',
        { metadata, field: 'encryption.verifier', originalError: err },
      );
    }
  }

  /**
   * Normalizes stored-KDF validation errors to vault-metadata parse errors.
   * @param {VaultEncryptionMeta['kdf']} kdf
   * @param {VaultMetadata} metadata
   */
  static #validateStoredKdf(kdf, metadata) {
    try {
      prepareStoredKdfOptions(kdf, { source: 'vault-metadata' });
    } catch (err) {
      if (!(err instanceof CasError) || err.code !== 'KDF_POLICY_VIOLATION') {
        throw err;
      }
      throw new CasError(
        `Vault encryption metadata invalid: ${err.message}`,
        'VAULT_METADATA_INVALID',
        { metadata, originalError: err },
      );
    }
  }

  /**
   * Validates nonce-budget metadata.
   * @param {VaultMetadata} metadata - Full metadata (for error context).
   */
  static #validateEncryptionCount(metadata) {
    if (metadata.encryptionCount === undefined) {
      return;
    }
    if (
      !Number.isSafeInteger(metadata.encryptionCount) ||
      metadata.encryptionCount < 0 ||
      metadata.encryptionCount > VaultService.ENCRYPTION_COUNT_MAX
    ) {
      throw new CasError(
        `Vault encryptionCount metadata must be a non-negative safe integer no greater than ${VaultService.ENCRYPTION_COUNT_MAX}`,
        'VAULT_METADATA_INVALID',
        {
          metadata,
          field: 'encryptionCount',
          value: metadata.encryptionCount,
          maxEncryptionCount: VaultService.ENCRYPTION_COUNT_MAX,
        },
      );
    }
  }

  /**
   * Validates vault metadata object structure.
   * @param {VaultMetadata} metadata - Metadata to validate.
   */
  static #validateMetadata(metadata) {
    if (typeof metadata.version !== 'number' || metadata.version !== 1) {
      throw new CasError(
        `Unsupported vault metadata version: ${metadata.version}`,
        'VAULT_METADATA_INVALID',
        { metadata },
      );
    }
    if (metadata.encryption) {
      VaultService.#validateEncryption(metadata.encryption, metadata);
    }
    VaultService.#validateEncryptionCount(metadata);
  }

  /**
   * Reads and validates vault metadata from a blob OID.
   * @param {string} blobOid - Git blob OID of the .vault.json file.
   * @returns {Promise<VaultMetadata>}
   */
  async #readMetadataBlob(blobOid) {
    try {
      const blob = await this.persistence.readBlob(blobOid);
      const metadata = JSON.parse(blob.toString());
      VaultService.#validateMetadata(metadata);
      return metadata;
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(
        `Failed to parse .vault.json: ${/** @type {Error} */ (err).message}`,
        'VAULT_METADATA_INVALID',
        { originalError: err },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // State read / write
  // ---------------------------------------------------------------------------

  /**
   * Separates vault tree entries into slug→OID map and metadata blob OID.
   * @param {VaultTreeEntry[]} treeEntries
   * @param {Object} [options]
   * @param {boolean} [options.privacyEnabled=false] - When true, entry names are HMAC hashes (skip decodeSlug).
   * @returns {{ entries: Map<string, string>, metadataBlobOid: string|null, privacyIndexBlobOid: string|null }}
   */
  static #parseTreeEntries(treeEntries, { privacyEnabled = false } = {}) {
    const entries = new Map();
    let metadataBlobOid = null;
    let privacyIndexBlobOid = null;
    for (const entry of treeEntries) {
      if (entry.name === '.vault.json') {
        metadataBlobOid = entry.oid;
      } else if (entry.name === PRIVACY_INDEX_ENTRY) {
        privacyIndexBlobOid = entry.oid;
      } else {
        // When privacy is enabled, entry names are raw HMAC hashes — store as-is.
        // When privacy is disabled, decode percent-encoded slugs.
        const key = privacyEnabled ? entry.name : Slug.from(Slug.decode(entry.name)).toString();
        entries.set(key, entry.oid);
      }
    }
    return { entries, metadataBlobOid, privacyIndexBlobOid };
  }

  /**
   * Loads and caches parse-stable vault tree data by tree OID.
   * @param {string} treeOid
   * @returns {Promise<CachedVaultTree>}
   */
  async #readCachedVaultTree(treeOid) {
    const cached = this.#stateCache.get(treeOid);
    if (cached) {
      return cached;
    }

    const rawEntries = await this.persistence.readTree(treeOid);
    const { metadataBlobOid } = VaultService.#parseTreeEntries(rawEntries);
    const metadata = metadataBlobOid
      ? await this.#readMetadataBlob(metadataBlobOid)
      : null;
    const loaded = {
      rawEntries,
      metadata,
      plainEntries: null,
      privacyEntriesByKey: new WeakMap(),
      verifiedEncryptionKeys: new WeakSet(),
    };
    this.#stateCache.set(treeOid, loaded);
    return loaded;
  }

  /**
   * Clones metadata for public read-state results.
   * @param {VaultMetadata|null} metadata
   * @returns {VaultMetadata|null}
   */
  static #cloneReadMetadata(metadata) {
    return metadata ? JSON.parse(JSON.stringify(metadata)) : null;
  }

  /**
   * Builds a defensive VaultState from cached entries.
   * @param {Object} options
   * @param {Map<string, string>} options.entries
   * @param {string} options.parentCommitOid
   * @param {VaultMetadata|null} options.metadata
   * @returns {VaultState}
   */
  static #stateFromCache({ entries, parentCommitOid, metadata }) {
    return {
      entries: new Map(entries),
      parentCommitOid,
      metadata: VaultService.#cloneReadMetadata(metadata),
    };
  }

  /**
   * Builds public vault state from a cached plain vault tree.
   * @param {CachedVaultTree} cached
   * @param {string} commitOid
   * @returns {VaultState}
   */
  static #plainStateFromCache(cached, commitOid) {
    if (!cached.plainEntries) {
      cached.plainEntries = VaultService.#parseTreeEntries(cached.rawEntries).entries;
    }
    return VaultService.#stateFromCache({
      entries: cached.plainEntries,
      parentCommitOid: commitOid,
      metadata: cached.metadata,
    });
  }

  /**
   * Resolves HMAC tree entry names to slugs using the encrypted privacy index.
   * @param {VaultTreeEntry[]} rawEntries - Raw tree entries.
   * @param {VaultMetadata} metadata - Vault metadata (must have privacy.indexMeta).
   * @param {Uint8Array} encryptionKey - Vault encryption key.
   * @returns {Promise<Map<string, string>>} Slug→treeOid map.
   */
  async #resolvePrivacyEntries(rawEntries, metadata, encryptionKey) {
    const parsed = VaultService.#parseTreeEntries(rawEntries, { privacyEnabled: true });

    if (!parsed.privacyIndexBlobOid) {
      throw new CasError(
        'Privacy mode is enabled but .privacy-index is missing',
        'VAULT_PRIVACY_INDEX_MISSING',
      );
    }

    const indexBlob = await this.persistence.readBlob(parsed.privacyIndexBlobOid);
    const slugToHmac = await this.#decryptPrivacyIndex(
      indexBlob, encryptionKey, metadata.privacy.indexMeta,
    );

    // Reverse the index: hmacName → slug.
    const hmacToSlug = new Map();
    for (const [slug, hmac] of slugToHmac) {
      hmacToSlug.set(hmac, slug);
    }

    const entries = new Map();
    for (const [hmacName, oid] of parsed.entries) {
      const slug = hmacToSlug.get(hmacName);
      if (slug) {
        entries.set(slug, oid);
      }
    }

    if (entries.size < parsed.entries.size) {
      const unmatchedCount = parsed.entries.size - entries.size;
      this.observability.log(
        'warn',
        `Privacy index resolution: ${unmatchedCount} tree entries had no matching slug — potential corruption`,
        { unmatchedCount, treeEntryCount: parsed.entries.size, resolvedCount: entries.size },
      );
    }

    return entries;
  }

  /**
   * Builds public vault state from a cached privacy-enabled vault tree.
   * @param {CachedVaultTree} cached
   * @param {string} commitOid
   * @param {Uint8Array|undefined} encryptionKey
   * @returns {Promise<VaultState>}
   */
  async #privacyStateFromCache(cached, commitOid, encryptionKey) {
    if (!encryptionKey) {
      throw new CasError(
        'Privacy mode is enabled — encryption key is required to read vault state',
        'VAULT_PRIVACY_KEY_REQUIRED',
      );
    }
    let entries = cached.privacyEntriesByKey.get(encryptionKey);
    if (!entries) {
      entries = await this.#resolvePrivacyEntries(
        cached.rawEntries,
        /** @type {VaultMetadata} */ (cached.metadata),
        encryptionKey,
      );
      cached.privacyEntriesByKey.set(encryptionKey, entries);
    }
    return VaultService.#stateFromCache({
      entries,
      parentCommitOid: commitOid,
      metadata: cached.metadata,
    });
  }

  /**
   * Builds public vault state from cached tree data.
   * @param {CachedVaultTree} cached
   * @param {string} commitOid
   * @param {Uint8Array|undefined} encryptionKey
   * @returns {Promise<VaultState>}
   */
  async #stateForCachedTree(cached, commitOid, encryptionKey) {
    if (cached.metadata?.encryption && encryptionKey) {
      await this.#verifyCachedEncryptionKey(cached, encryptionKey);
    }
    if (cached.metadata?.privacy?.enabled) {
      return await this.#privacyStateFromCache(cached, commitOid, encryptionKey);
    }
    return VaultService.#plainStateFromCache(cached, commitOid);
  }

  /**
   * Reads the current vault state from refs/cas/vault.
   * @param {Object} [options]
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (required when privacy mode is enabled).
   * @returns {Promise<VaultState>}
   */
  async readState({ encryptionKey } = {}) {
    let commitOid;
    try {
      commitOid = await this.ref.resolveRef(VAULT_REF);
    } catch {
      return { entries: new Map(), parentCommitOid: null, metadata: null };
    }

    const treeOid = await this.ref.resolveTree(commitOid);
    const cached = await this.#readCachedVaultTree(treeOid);
    return await this.#stateForCachedTree(cached, commitOid, encryptionKey);
  }

  /**
   * Writes a new vault commit and updates the ref atomically.
   * @param {Object} options
   * @param {Map<string, string>} options.entries - Slug→treeOid map.
   * @param {VaultMetadata} options.metadata - Vault metadata (.vault.json contents).
   * @param {string|null} options.parentCommitOid - Parent commit OID (null for first commit).
   * @param {string} options.message - Commit message.
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (required when privacy is enabled).
   * @returns {Promise<{ commitOid: string }>}
   */
  async writeCommit({ entries, metadata, parentCommitOid, message, encryptionKey }) {
    const privacyEnabled = Boolean(metadata?.privacy?.enabled);

    if (privacyEnabled && !encryptionKey) {
      throw new CasError(
        'Privacy mode is enabled — encryption key is required to write vault state',
        'VAULT_PRIVACY_KEY_REQUIRED',
      );
    }

    const metaCopy = JSON.parse(JSON.stringify(metadata));
    if (metaCopy.encryption && encryptionKey) {
      if (metaCopy.encryption.verifier) {
        await this.#verifyEncryptionVerifier(metaCopy, encryptionKey);
      } else {
        metaCopy.encryption.verifier = await this.#createEncryptionVerifier(encryptionKey);
      }
    }
    const treeLines = privacyEnabled
      ? await this.#buildPrivacyTreeLines(entries, metaCopy, encryptionKey)
      : VaultService.#buildPlainTreeLines(entries);

    const metadataBlob = await this.persistence.writeBlob(
      JSON.stringify(metaCopy, null, 2),
    );
    treeLines.unshift(`100644 blob ${metadataBlob}\t.vault.json`);
    const newTreeOid = await this.persistence.writeTree(treeLines);

    const commitOid = await this.ref.createCommit({
      treeOid: newTreeOid,
      parentOid: parentCommitOid,
      message,
    });
    await this.#casUpdateRef(commitOid, parentCommitOid);
    return { commitOid };
  }

  /**
   * Builds tree lines with plain (percent-encoded) slug names.
   * @param {Map<string, string>} entries - Slug→treeOid map.
   * @returns {string[]}
   */
  static #buildPlainTreeLines(entries) {
    const lines = [];
    for (const [slug, treeOid] of entries) {
      lines.push(`040000 tree ${treeOid}\t${Slug.from(slug).toTreePath()}`);
    }
    return lines;
  }

  /**
   * Builds tree lines with HMAC-masked slug names and an encrypted privacy index.
   * Mutates `metaCopy.privacy.indexMeta` with encryption metadata.
   * @param {Map<string, string>} entries - Slug→treeOid map.
   * @param {VaultMetadata} metaCopy - Mutable metadata clone.
   * @param {Uint8Array} encryptionKey - Vault encryption key.
   * @returns {Promise<string[]>}
   */
  async #buildPrivacyTreeLines(entries, metaCopy, encryptionKey) {
    const privacyKey = await this.#derivePrivacyKey(encryptionKey);
    const lines = [];
    const slugToHmac = new Map();

    for (const [slug, treeOid] of entries) {
      const hmacName = await this.#hmacSlug(privacyKey, slug);
      slugToHmac.set(slug, hmacName);
      lines.push(`040000 tree ${treeOid}\t${hmacName}`);
    }

    const { buf: indexBuf, meta: indexMeta } = await this.#encryptPrivacyIndex(
      slugToHmac, encryptionKey,
    );
    const indexBlobOid = await this.persistence.writeBlob(indexBuf);
    lines.push(`100644 blob ${indexBlobOid}\t${PRIVACY_INDEX_ENTRY}`);
    metaCopy.privacy.indexMeta = indexMeta;

    return lines;
  }

  /**
   * Atomically updates the vault ref with CAS semantics.
   * @param {string} newOid - New commit OID.
   * @param {string|null} expectedOldOid - Expected current commit OID.
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
        'VAULT_CONFLICT',
        { expectedParent: expectedOldOid, newCommit: newOid, originalError: err },
      );
    }
  }

  /**
   * Creates an isolated mutable draft for a vault mutation attempt.
   * @param {VaultState} state
   * @returns {{ entries: Map<string, string>, metadata: VaultMetadata }}
   */
  static #createMutationDraft(state) {
    return {
      entries: new Map(state.entries),
      metadata: VaultService.#cloneMetadata(state.metadata || { version: 1 }),
    };
  }

  /**
   * Clones vault metadata so retry attempts mutate an isolated working copy.
   * @param {VaultMetadata} metadata
   * @returns {VaultMetadata}
   */
  static #cloneMetadata(metadata) {
    return {
      ...metadata,
      encryption: metadata.encryption
        ? {
          ...metadata.encryption,
          kdf: { ...metadata.encryption.kdf },
          verifier: metadata.encryption.verifier
            ? {
              ...metadata.encryption.verifier,
              meta: { ...metadata.encryption.verifier.meta },
            }
            : undefined,
        }
        : undefined,
      privacy: metadata.privacy
        ? {
          ...metadata.privacy,
          indexMeta: metadata.privacy.indexMeta ? { ...metadata.privacy.indexMeta } : undefined,
        }
        : undefined,
    };
  }

  /**
   * Wraps a vault mutation with CAS retry logic.
   *
   * The mutation function may return an `encryptionKey` to override the one
   * from options — this is needed by `initVault` where the key is derived
   * inside the mutation.
   *
   * @param {(context: { state: VaultState, draft: { entries: Map<string, string>, metadata: VaultMetadata } }) => { message: string, result?: Record<string, unknown>, encryptionKey?: Uint8Array }|Promise<{ message: string, result?: Record<string, unknown>, encryptionKey?: Uint8Array }>} mutationFn
   * @param {Object} [options]
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (threaded to readState/writeCommit for privacy mode).
   * @returns {Promise<{ commitOid: string } & Record<string, unknown>>}
   */
  async #withVaultRetry(mutationFn, { encryptionKey } = {}) {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const state = await this.readState({ encryptionKey });
      const draft = VaultService.#createMutationDraft(state);
      const { message, result, encryptionKey: mutationKey } = await mutationFn({ state, draft });
      const effectiveKey = mutationKey || encryptionKey;
      try {
        const commit = await this.writeCommit({
          entries: draft.entries,
          metadata: draft.metadata,
          parentCommitOid: state.parentCommitOid,
          message,
          encryptionKey: effectiveKey,
        });
        return result ? { ...commit, ...result } : commit;
      } catch (err) {
        const isRetryable = err instanceof CasError && err.code === 'VAULT_CONFLICT';
        if (!isRetryable || attempt >= MAX_CAS_RETRIES - 1) {
          throw err;
        }
        const delay = CAS_RETRY_BASE_MS * (2 ** attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    /* c8 ignore next 2 */
    throw new CasError('Vault CAS retries exhausted', 'VAULT_CONFLICT');
  }

  // ---------------------------------------------------------------------------
  // Encryption helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds vault encryption metadata from KDF result.
   * @param {Uint8Array} salt - KDF salt.
   * @param {import('../../ports/CryptoPort.js').KdfParamSet} params - KDF parameters.
   * @returns {VaultEncryptionMeta}
   */
  static #buildEncryptionMeta(salt, params) {
    return {
      cipher: 'aes-256-gcm',
      kdf: buildKdfMetadata(salt, params),
    };
  }

  // ---------------------------------------------------------------------------
  // Privacy mode helpers
  // ---------------------------------------------------------------------------

  /**
   * Derives a privacy key from the vault encryption key.
   * @param {Uint8Array} encryptionKey - 32-byte vault encryption key.
   * @returns {Promise<Uint8Array>} 32-byte privacy key.
   */
  async #derivePrivacyKey(encryptionKey) {
    return await Promise.resolve(this.crypto.hmacSha256(encryptionKey, utf8Encode(PRIVACY_DERIVATION_LABEL)));
  }

  /**
   * Computes the HMAC-SHA256 of a slug using the privacy key.
   * @param {Uint8Array} privacyKey - 32-byte privacy key.
   * @param {string} slug - Vault slug.
   * @returns {Promise<string>} 64-char lowercase hex string.
   */
  async #hmacSlug(privacyKey, slug) {
    return encodeHex(await Promise.resolve(this.crypto.hmacSha256(privacyKey, utf8Encode(slug))));
  }

  /**
   * Encrypts the privacy index (slug→hmacName mapping).
   * @param {Map<string, string>} slugToHmac - Slug→HMAC name mapping.
   * @param {Uint8Array} encryptionKey - 32-byte vault encryption key.
   * @returns {Promise<{ buf: Uint8Array, meta: import('../../ports/CryptoPort.js').EncryptionMeta }>}
   */
  async #encryptPrivacyIndex(slugToHmac, encryptionKey) {
    const json = JSON.stringify(Object.fromEntries(slugToHmac));
    return await this.crypto.encryptBuffer(utf8Encode(json), encryptionKey);
  }

  /**
   * Decrypts the privacy index blob.
   * @param {Uint8Array} blob - Encrypted index blob.
   * @param {Uint8Array} encryptionKey - 32-byte vault encryption key.
   * @param {import('../../ports/CryptoPort.js').EncryptionMeta} meta - Encryption metadata.
   * @returns {Promise<Map<string, string>>} slug→hmacName mapping.
   */
  async #decryptPrivacyIndex(blob, encryptionKey, meta) {
    const plaintext = await this.crypto.decryptBuffer(blob, encryptionKey, meta);
    const obj = JSON.parse(utf8Decode(plaintext));
    return new Map(Object.entries(obj));
  }

  /**
   * Creates encrypted verifier metadata for a vault key.
   * @param {Uint8Array} encryptionKey
   * @returns {Promise<VaultEncryptionVerifier>}
   */
  async #createEncryptionVerifier(encryptionKey) {
    const { buf, meta } = await this.crypto.encryptBuffer(
      VAULT_VERIFIER_PLAINTEXT,
      encryptionKey,
      VAULT_VERIFIER_AAD,
    );
    return {
      version: 1,
      ciphertext: encodeBase64(buf),
      meta,
    };
  }

  /**
   * @param {Uint8Array} a
   * @param {Uint8Array} b
   * @returns {boolean}
   */
  static #bytesEqual(a, b) {
    if (a.length !== b.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  }

  /**
   * Verifies a key against encrypted vault verifier metadata when present.
   * @param {VaultMetadata} metadata
   * @param {Uint8Array} encryptionKey
   * @returns {Promise<boolean>} True when verifier metadata was present and validated.
   */
  async #verifyEncryptionVerifier(metadata, encryptionKey) {
    const verifier = metadata.encryption?.verifier;
    if (!verifier) {
      return false;
    }

    let plaintext;
    try {
      plaintext = await this.crypto.decryptBuffer(
        decodeBase64(verifier.ciphertext),
        encryptionKey,
        verifier.meta,
        VAULT_VERIFIER_AAD,
      );
    } catch (err) {
      throw new CasError(
        'Vault passphrase verification failed',
        'INTEGRITY_ERROR',
        { originalError: err, verifier: 'vault-metadata' },
      );
    }

    if (!VaultService.#bytesEqual(plaintext, VAULT_VERIFIER_PLAINTEXT)) {
      throw new CasError(
        'Vault passphrase verification failed',
        'INTEGRITY_ERROR',
        { verifier: 'vault-metadata', reason: 'plaintext-mismatch' },
      );
    }
    return true;
  }

  /**
   * Verifies and memoizes an encryption key for cached vault metadata.
   * @param {CachedVaultTree} cached
   * @param {Uint8Array} encryptionKey
   * @returns {Promise<boolean>}
   */
  async #verifyCachedEncryptionKey(cached, encryptionKey) {
    if (!cached.metadata?.encryption) {
      return false;
    }
    if (cached.verifiedEncryptionKeys.has(encryptionKey)) {
      return true;
    }
    const verified = await this.#verifyEncryptionVerifier(cached.metadata, encryptionKey);
    if (verified) {
      cached.verifiedEncryptionKeys.add(encryptionKey);
    }
    return verified;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Initializes the vault, optionally with encryption and privacy mode.
   * @param {Object} [options]
   * @param {string} [options.passphrase] - Passphrase for vault-level encryption.
   * @param {Object} [options.kdfOptions] - KDF options (algorithm, iterations, etc.).
   * @param {boolean} [options.privacy=false] - Enable privacy mode (requires passphrase/encryption).
   * @returns {Promise<{ commitOid: string }>}
   */
  async initVault({ passphrase, kdfOptions, privacy = false } = {}) {
    if (privacy && !passphrase) {
      throw new CasError(
        'Privacy mode requires vault encryption — provide a passphrase',
        'VAULT_PRIVACY_REQUIRES_ENCRYPTION',
      );
    }

    return await this.#withVaultRetry(async ({ state, draft }) => {
      if (state.metadata?.encryption) {
        throw new CasError(
          'Vault encryption is already configured',
          'VAULT_ENCRYPTION_ALREADY_CONFIGURED',
        );
      }

      draft.metadata = { version: 1 };
      /** @type {Uint8Array|undefined} */
      let derivedKey;
      if (passphrase) {
        const options = prepareKdfOptions(kdfOptions, { source: 'vault-init' });
        const { key, salt, params } = await this.crypto.deriveKey({ passphrase, ...options });
        draft.metadata.encryption = VaultService.#buildEncryptionMeta(salt, params);
        draft.metadata.encryption.verifier = await this.#createEncryptionVerifier(key);
        derivedKey = key;
      }

      if (privacy) {
        draft.metadata.privacy = { enabled: true };
      }

      return { message: 'vault: init', encryptionKey: derivedKey };
    });
  }

  /**
   * Adds or updates an entry in the vault.
   * @param {Object} options
   * @param {string} options.slug - Entry slug.
   * @param {string} options.treeOid - Git tree OID.
   * @param {boolean} [options.force=false] - Overwrite existing entry.
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (required when privacy is enabled).
   * @returns {Promise<{ commitOid: string }>}
   */
  async addToVault({ slug, treeOid, force = false, encryptionKey }) {
    const vaultSlug = Slug.from(slug).toString();

    return await this.#withVaultRetry(({ draft }) => {
      if (draft.entries.has(vaultSlug) && !force) {
        throw new CasError(
          `Vault entry "${vaultSlug}" already exists (use force to overwrite)`,
          'VAULT_ENTRY_EXISTS',
          { slug: vaultSlug },
        );
      }
      const isUpdate = draft.entries.has(vaultSlug);
      draft.entries.set(vaultSlug, treeOid);
      if (draft.metadata.encryption) {
        // Tracks nonce-relevant operations: every addToVault on an encrypted
        // vault implies an encryption occurred at the store layer.
        const currentCount = draft.metadata.encryptionCount || 0;
        if (currentCount >= VaultService.ENCRYPTION_COUNT_MAX) {
          throw new CasError(
            `Vault encryption nonce budget exhausted (${currentCount}/${VaultService.ENCRYPTION_COUNT_MAX}); rotate your vault key before storing more encrypted assets`,
            'VAULT_NONCE_EXHAUSTED',
            {
              encryptionCount: currentCount,
              maxEncryptionCount: VaultService.ENCRYPTION_COUNT_MAX,
            },
          );
        }
        draft.metadata.encryptionCount = currentCount + 1;
        if (draft.metadata.encryptionCount >= VaultService.ENCRYPTION_COUNT_WARN) {
          this.observability.log(
            'warn',
            `Vault encryption count (${draft.metadata.encryptionCount}) exceeds ` +
            `${VaultService.ENCRYPTION_COUNT_WARN} — rotate your key`,
            { encryptionCount: draft.metadata.encryptionCount },
          );
        }
      }
      return {
        message: isUpdate ? `vault: update ${vaultSlug}` : `vault: add ${vaultSlug}`,
      };
    }, { encryptionKey });
  }

  /**
   * Lists all vault entries.
   * @param {Object} [options]
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (required when privacy is enabled).
   * @returns {Promise<Array<{ slug: string, treeOid: string }>>}
   */
  async listVault({ encryptionKey } = {}) {
    const { entries } = await this.readState({ encryptionKey });
    return [...entries.entries()]
      .map(([slug, treeOid]) => ({ slug, treeOid }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Removes an entry from the vault.
   * @param {Object} options
   * @param {string} options.slug - Entry slug to remove.
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (required when privacy is enabled).
   * @returns {Promise<{ commitOid: string, removedTreeOid: string }>}
   */
  async removeFromVault({ slug, encryptionKey }) {
    const vaultSlug = Slug.from(slug).toString();
    const result = await this.#withVaultRetry(({ draft }) => {
      if (!draft.entries.has(vaultSlug)) {
        throw new CasError(
          `Vault entry "${vaultSlug}" not found`,
          'VAULT_ENTRY_NOT_FOUND',
          { slug: vaultSlug },
        );
      }
      const removedTreeOid = /** @type {string} */ (draft.entries.get(vaultSlug));
      draft.entries.delete(vaultSlug);
      return {
        message: `vault: remove ${vaultSlug}`,
        result: { removedTreeOid },
      };
    }, { encryptionKey });

    return {
      commitOid: result.commitOid,
      removedTreeOid: /** @type {string} */ (result.removedTreeOid),
    };
  }

  /**
   * Resolves a vault entry slug to its tree OID.
   * @param {Object} options
   * @param {string} options.slug - Entry slug.
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (required when privacy is enabled).
   * @returns {Promise<string>} The tree OID.
   */
  async resolveVaultEntry({ slug, encryptionKey }) {
    const vaultSlug = Slug.from(slug).toString();
    const { entries } = await this.readState({ encryptionKey });
    if (!entries.has(vaultSlug)) {
      throw new CasError(
        `Vault entry "${vaultSlug}" not found`,
        'VAULT_ENTRY_NOT_FOUND',
        { slug: vaultSlug },
      );
    }
    return /** @type {string} */ (entries.get(vaultSlug));
  }

  /**
   * Verifies a vault encryption key against metadata when verifier data exists.
   * @param {Object} options
   * @param {Uint8Array} options.encryptionKey - Vault encryption key to verify.
   * @returns {Promise<{ verified: boolean, requiresMigration: boolean }>}
   */
  async verifyVaultKey({ encryptionKey }) {
    const state = await this.readState({ encryptionKey });
    if (!state.metadata?.encryption) {
      throw new CasError('Vault is not encrypted', 'VAULT_METADATA_INVALID');
    }
    const verified = Boolean(state.metadata.encryption.verifier);
    return {
      verified,
      requiresMigration: !verified,
    };
  }

  /**
   * Returns the vault metadata, or null if no vault exists.
   * @returns {Promise<VaultMetadata|null>}
   */
  async getVaultMetadata() {
    let commitOid;
    try {
      commitOid = await this.ref.resolveRef(VAULT_REF);
    } catch {
      return null;
    }

    const treeOid = await this.ref.resolveTree(commitOid);
    const rawEntries = await this.persistence.readTree(treeOid);
    const { metadataBlobOid } = VaultService.#parseTreeEntries(rawEntries);
    return metadataBlobOid
      ? await this.#readMetadataBlob(metadataBlobOid)
      : null;
  }
}
