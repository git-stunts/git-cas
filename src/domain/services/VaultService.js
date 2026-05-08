import { ErrorCodes } from '../errors/index.js';
/**
 * @fileoverview Domain service for vault (GC-safe ref-based asset index) operations.
 */
import CasError from '../errors/CasError.js';
import buildKdfMetadata from '../helpers/buildKdfMetadata.js';
import { prepareKdfOptions } from '../../helpers/kdfPolicy.js';
import Slug from '../value-objects/Slug.js';
import RedactingObservability from './RedactingObservability.js';
import VaultMetadataCodec, {
  VAULT_ENCRYPTION_COUNT_MAX,
  VAULT_ENCRYPTION_COUNT_WARN,
} from './VaultMetadataCodec.js';
import VaultMutationRetryPolicy from './VaultMutationRetryPolicy.js';
import VaultPersistence, { VAULT_REF } from './VaultPersistence.js';
import VaultPrivacyIndex from './VaultPrivacyIndex.js';
import VaultStateCache from './VaultStateCache.js';
import VaultTreeCodec, {
  VAULT_METADATA_ENTRY,
  VAULT_PRIVACY_INDEX_ENTRY,
} from './VaultTreeCodec.js';
import VaultKeyVerifier from './VaultKeyVerifier.js';

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
 * Vault state read from the current vault head.
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
 * @property {WeakMap<Uint8Array, { keyBytes: Uint8Array, entries: Map<string, string> }>} privacyEntriesByKey
 *   Privacy entries by key object and byte snapshot.
 * @property {WeakMap<Uint8Array, Uint8Array>} verifiedEncryptionKeys
 *   Vault keys already checked against metadata by key object and byte snapshot.
 */

/**
 * Domain service for vault operations.
 *
 * The vault is a GC-safe ref-based index that maps slugs to Git tree OIDs.
 * It is backed by a vault-head commit chain. Each commit's tree contains one
 * entry per stored asset plus a `.vault.json` metadata blob.
 *
 * `VaultService` orchestrates public vault use cases. Persistence, cache,
 * boundary codecs, privacy indexing, key verification, and retry timing are
 * injected collaborators.
 */
export default class VaultService {
  static VAULT_REF = VAULT_REF;

  /** @type {number} Nonce usage warning threshold (2^31). */
  static ENCRYPTION_COUNT_WARN = VAULT_ENCRYPTION_COUNT_WARN;

  /** @type {number} Maximum encrypted vault writes before key rotation is required (2^32 - 1). */
  static ENCRYPTION_COUNT_MAX = VAULT_ENCRYPTION_COUNT_MAX;

  /**
   * @param {Object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/GitRefPort.js').default} options.ref
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {import('../../ports/ObservabilityPort.js').default} [options.observability]
   * @param {VaultPersistence} [options.vaultPersistence]
   * @param {VaultStateCache} [options.stateCache]
   * @param {VaultMetadataCodec} [options.metadataCodec]
   * @param {VaultTreeCodec} [options.treeCodec]
   * @param {VaultKeyVerifier} [options.keyVerifier]
   * @param {VaultPrivacyIndex} [options.privacyIndex]
   * @param {VaultMutationRetryPolicy} [options.retryPolicy]
   */
  constructor({
    persistence,
    ref,
    crypto,
    observability,
    vaultPersistence,
    stateCache,
    metadataCodec,
    treeCodec,
    keyVerifier,
    privacyIndex,
    retryPolicy,
  }) {
    this.crypto = crypto;
    this.metadataCodec = metadataCodec || new VaultMetadataCodec();
    this.treeCodec = treeCodec || new VaultTreeCodec();
    this.vaultPersistence = vaultPersistence || new VaultPersistence({
      persistence,
      ref,
      treeCodec: this.treeCodec,
      metadataCodec: this.metadataCodec,
    });
    this.stateCache = stateCache || new VaultStateCache();
    this.keyVerifier = keyVerifier || new VaultKeyVerifier({ crypto });
    this.privacyIndex = privacyIndex || new VaultPrivacyIndex({ crypto });
    this.retryPolicy = retryPolicy || new VaultMutationRetryPolicy();
    /** @type {import('../../ports/ObservabilityPort.js').default} */
    this.observability = RedactingObservability.wrap(
      observability || { metric() {}, log() {}, span: () => ({ end() {} }) },
    );
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
  // State read / write
  // ---------------------------------------------------------------------------

  /**
   * Loads and caches parse-stable vault tree data by tree OID.
   * @param {string} treeOid
   * @returns {Promise<CachedVaultTree>}
   */
  async #readCachedVaultTree(treeOid) {
    const cached = this.stateCache.get(treeOid);
    if (cached) {
      return cached;
    }
    return this.stateCache.rememberTree(
      treeOid,
      await this.vaultPersistence.readTreeSnapshot(treeOid),
    );
  }

  /**
   * Resolves the current vault commit and tree.
   * @returns {Promise<{ commitOid: string, treeOid: string }|null>}
   */
  async #resolveCurrentVaultTree() {
    return await this.vaultPersistence.resolveHead();
  }

  /**
   * Reads one persisted vault tree entry.
   * @param {string} treeOid
   * @param {string} treePath
   * @returns {Promise<VaultTreeEntry|null>}
   */
  async #readTreeEntry(treeOid, treePath) {
    const cached = this.stateCache.get(treeOid);
    if (cached) {
      return cached.rawEntries.find((entry) => entry.name === treePath) || null;
    }
    return await this.vaultPersistence.readEntry(treeOid, treePath);
  }

  /**
   * Streams tree entries, falling back to readTree() for older adapters.
   * @param {string} treeOid
   * @returns {AsyncIterable<VaultTreeEntry>}
   */
  async *#iterateTreeEntries(treeOid) {
    const cached = this.stateCache.get(treeOid);
    if (cached) {
      yield* cached.rawEntries;
      return;
    }
    yield* this.vaultPersistence.iterateEntries(treeOid);
  }

  /**
   * Reads vault metadata without enumerating the whole vault tree.
   * @param {string} treeOid
   * @returns {Promise<VaultMetadata|null>}
   */
  async #readMetadataFromTree(treeOid) {
    const cached = this.stateCache.get(treeOid);
    if (cached) {
      return cached.metadata;
    }
    const { metadata, snapshot } = await this.vaultPersistence.readMetadataSnapshot(treeOid);
    if (snapshot) {
      this.stateCache.rememberTree(treeOid, snapshot);
    }
    return metadata;
  }

  /**
   * Builds public vault state from a cached plain vault tree.
   * @param {CachedVaultTree} cached
   * @param {string} commitOid
   * @returns {VaultState}
   */
  #plainStateFromCache(cached, commitOid) {
    const entries = this.stateCache.plainEntries(
      cached,
      (rawEntries) => this.treeCodec.parseTreeEntries(rawEntries).entries,
    );
    return this.stateCache.toState({
      entries,
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
    const parsed = this.treeCodec.parseTreeEntries(rawEntries, { privacyEnabled: true });

    if (!parsed.privacyIndexBlobOid) {
      throw new CasError(
        'Privacy mode is enabled but .privacy-index is missing',
        ErrorCodes.VAULT_PRIVACY_INDEX_MISSING,
      );
    }

    const indexBlob = await this.vaultPersistence.readBlob(parsed.privacyIndexBlobOid);
    const slugToHmac = await this.privacyIndex.decryptIndex({
      bytes: indexBlob,
      encryptionKey,
      meta: metadata.privacy.indexMeta,
    });

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
   * Builds a HMAC-name to slug map from the encrypted privacy index.
   * @param {string} treeOid
   * @param {VaultMetadata} metadata
   * @param {Uint8Array} encryptionKey
   * @returns {Promise<Map<string, string>>}
   */
  async #readPrivacyHmacToSlug(treeOid, metadata, encryptionKey) {
    const privacyIndexEntry = await this.#readTreeEntry(treeOid, VAULT_PRIVACY_INDEX_ENTRY);
    if (!privacyIndexEntry) {
      throw new CasError(
        'Privacy mode is enabled but .privacy-index is missing',
        ErrorCodes.VAULT_PRIVACY_INDEX_MISSING,
      );
    }

    const indexBlob = await this.vaultPersistence.readBlob(privacyIndexEntry.oid);
    const slugToHmac = await this.privacyIndex.decryptIndex({
      bytes: indexBlob,
      encryptionKey,
      meta: metadata.privacy.indexMeta,
    });
    const hmacToSlug = new Map();
    for (const [slug, hmac] of slugToHmac) {
      hmacToSlug.set(hmac, slug);
    }
    return hmacToSlug;
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
        ErrorCodes.VAULT_PRIVACY_KEY_REQUIRED,
      );
    }
    const entries = await this.stateCache.privacyEntries(
      cached,
      encryptionKey,
      async (rawEntries, metadata) => await this.#resolvePrivacyEntries(
        rawEntries,
        /** @type {VaultMetadata} */ (metadata),
        encryptionKey,
      ),
    );
    return this.stateCache.toState({
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
    return this.#plainStateFromCache(cached, commitOid);
  }

  /**
   * Reads the current vault state from the current vault head.
   * @param {Object} [options]
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (required when privacy mode is enabled).
   * @returns {Promise<VaultState>}
   */
  async readState({ encryptionKey } = {}) {
    const current = await this.#resolveCurrentVaultTree();
    if (!current) {
      return { entries: new Map(), parentCommitOid: null, metadata: null };
    }

    const cached = await this.#readCachedVaultTree(current.treeOid);
    return await this.#stateForCachedTree(cached, current.commitOid, encryptionKey);
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
        ErrorCodes.VAULT_PRIVACY_KEY_REQUIRED,
      );
    }

    const metaCopy = JSON.parse(JSON.stringify(metadata));
    if (metaCopy.encryption && encryptionKey) {
      if (metaCopy.encryption.verifier) {
        await this.keyVerifier.verify(metaCopy, encryptionKey);
      } else {
        metaCopy.encryption.verifier = await this.keyVerifier.create(encryptionKey);
      }
    }

    const privateWrite = privacyEnabled
      ? await this.#preparePrivacyWrite(entries, metaCopy, encryptionKey)
      : {};

    return await this.vaultPersistence.writeCommit({
      entries,
      metadata: metaCopy,
      parentCommitOid,
      message,
      ...privateWrite,
    });
  }

  /**
   * Builds HMAC-masked entry names and encrypted privacy index bytes.
   * Mutates `metaCopy.privacy.indexMeta` with encryption metadata.
   * @param {Map<string, string>} entries - Slug→treeOid map.
   * @param {VaultMetadata} metaCopy - Mutable metadata clone.
   * @param {Uint8Array} encryptionKey - Vault encryption key.
   * @returns {Promise<{ persistedNameBySlug: Map<string, string>, privacyIndexBytes: Uint8Array }>}
   */
  async #preparePrivacyWrite(entries, metaCopy, encryptionKey) {
    const { persistedNameBySlug, slugToHmac } = await this.privacyIndex.persistedNamesForEntries(
      entries,
      encryptionKey,
    );
    const encryptedIndex = await this.privacyIndex.encryptIndex({ slugToHmac, encryptionKey });
    metaCopy.privacy.indexMeta = encryptedIndex.meta;
    return {
      persistedNameBySlug,
      privacyIndexBytes: encryptedIndex.bytes,
    };
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
    for (let attempt = 0; attempt < this.retryPolicy.maxAttempts; attempt++) {
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
        if (!this.retryPolicy.isRetryable(err) || attempt >= this.retryPolicy.maxAttempts - 1) {
          throw err;
        }
        await this.retryPolicy.waitBeforeRetry(attempt);
      }
    }
    /* c8 ignore next 2 */
    throw new CasError('Vault CAS retries exhausted', ErrorCodes.VAULT_CONFLICT);
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
    if (this.stateCache.hasVerifiedEncryptionKey(cached, encryptionKey)) {
      return true;
    }
    const verified = await this.keyVerifier.verify(cached.metadata, encryptionKey);
    if (verified) {
      this.stateCache.rememberVerifiedEncryptionKey(cached, encryptionKey);
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
        ErrorCodes.VAULT_PRIVACY_REQUIRES_ENCRYPTION,
      );
    }

    return await this.#withVaultRetry(async ({ state, draft }) => {
      if (state.metadata?.encryption) {
        throw new CasError(
          'Vault encryption is already configured',
          ErrorCodes.VAULT_ENCRYPTION_ALREADY_CONFIGURED,
        );
      }

      draft.metadata = { version: 1 };
      /** @type {Uint8Array|undefined} */
      let derivedKey;
      if (passphrase) {
        const options = prepareKdfOptions(kdfOptions, { source: 'vault-init' });
        const { key, salt, params } = await this.crypto.deriveKey({ passphrase, ...options });
        draft.metadata.encryption = VaultService.#buildEncryptionMeta(salt, params);
        draft.metadata.encryption.verifier = await this.keyVerifier.create(key);
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
          ErrorCodes.VAULT_ENTRY_EXISTS,
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
            ErrorCodes.VAULT_NONCE_EXHAUSTED,
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
   * Streams vault entries.
   * @param {Object} [options]
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (required when privacy is enabled).
   * @returns {AsyncIterable<{ slug: string, treeOid: string }>}
   */
  async *iterateVault({ encryptionKey } = {}) {
    const current = await this.#resolveCurrentVaultTree();
    if (!current) {
      return;
    }
    const metadata = await this.#readMetadataFromTree(current.treeOid);
    if (metadata?.encryption && encryptionKey) {
      await this.keyVerifier.verify(metadata, encryptionKey);
    }
    if (metadata?.privacy?.enabled) {
      yield* this.#iteratePrivateVaultEntries(current.treeOid, metadata, encryptionKey);
      return;
    }
    yield* this.#iteratePlainVaultEntries(current.treeOid);
  }

  /**
   * Lists all vault entries.
   * @param {Object} [options]
   * @param {Uint8Array} [options.encryptionKey] - Vault encryption key (required when privacy is enabled).
   * @returns {Promise<Array<{ slug: string, treeOid: string }>>}
   */
  async listVault({ encryptionKey } = {}) {
    const entries = [];
    for await (const entry of this.iterateVault({ encryptionKey })) {
      entries.push(entry);
    }
    return entries.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * @param {string} treeOid
   * @returns {AsyncIterable<{ slug: string, treeOid: string }>}
   */
  async *#iteratePlainVaultEntries(treeOid) {
    for await (const entry of this.#iterateTreeEntries(treeOid)) {
      if (entry.name === VAULT_METADATA_ENTRY || entry.name === VAULT_PRIVACY_INDEX_ENTRY) {
        continue;
      }
      yield {
        slug: Slug.from(Slug.decode(entry.name)).toString(),
        treeOid: entry.oid,
      };
    }
  }

  /**
   * @param {string} treeOid
   * @param {VaultMetadata} metadata
   * @param {Uint8Array|undefined} encryptionKey
   * @returns {AsyncIterable<{ slug: string, treeOid: string }>}
   */
  async *#iteratePrivateVaultEntries(treeOid, metadata, encryptionKey) {
    if (!encryptionKey) {
      throw new CasError(
        'Privacy mode is enabled — encryption key is required to read vault state',
        ErrorCodes.VAULT_PRIVACY_KEY_REQUIRED,
      );
    }
    const hmacToSlug = await this.#readPrivacyHmacToSlug(treeOid, metadata, encryptionKey);
    let treeEntryCount = 0;
    let resolvedCount = 0;
    for await (const entry of this.#iterateTreeEntries(treeOid)) {
      if (entry.name === VAULT_METADATA_ENTRY || entry.name === VAULT_PRIVACY_INDEX_ENTRY) {
        continue;
      }
      treeEntryCount++;
      const slug = hmacToSlug.get(entry.name);
      if (slug) {
        resolvedCount++;
        yield { slug, treeOid: entry.oid };
      }
    }
    if (resolvedCount < treeEntryCount) {
      const unmatchedCount = treeEntryCount - resolvedCount;
      this.observability.log(
        'warn',
        `Privacy index resolution: ${unmatchedCount} tree entries had no matching slug — potential corruption`,
        { unmatchedCount, treeEntryCount, resolvedCount },
      );
    }
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
          ErrorCodes.VAULT_ENTRY_NOT_FOUND,
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
    const current = await this.#resolveCurrentVaultTree();
    if (!current) {
      throw new CasError(
        `Vault entry "${vaultSlug}" not found`,
        ErrorCodes.VAULT_ENTRY_NOT_FOUND,
        { slug: vaultSlug },
      );
    }
    const metadata = await this.#readMetadataFromTree(current.treeOid);
    if (metadata?.encryption && encryptionKey) {
      await this.keyVerifier.verify(metadata, encryptionKey);
    }
    const treePath = await this.#treePathForVaultSlug({
      metadata,
      vaultSlug,
      encryptionKey,
    });
    const entry = await this.#readTreeEntry(current.treeOid, treePath);
    if (!entry) {
      throw new CasError(
        `Vault entry "${vaultSlug}" not found`,
        ErrorCodes.VAULT_ENTRY_NOT_FOUND,
        { slug: vaultSlug },
      );
    }
    return entry.oid;
  }

  /**
   * @param {Object} options
   * @param {VaultMetadata|null} options.metadata
   * @param {string} options.vaultSlug
   * @param {Uint8Array|undefined} options.encryptionKey
   * @returns {Promise<string>}
   */
  async #treePathForVaultSlug({ metadata, vaultSlug, encryptionKey }) {
    if (!metadata?.privacy?.enabled) {
      return Slug.from(vaultSlug).toTreePath();
    }
    if (!encryptionKey) {
      throw new CasError(
        'Privacy mode is enabled — encryption key is required to read vault state',
        ErrorCodes.VAULT_PRIVACY_KEY_REQUIRED,
      );
    }
    return await this.privacyIndex.persistedNameForSlug({ encryptionKey, slug: vaultSlug });
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
      throw new CasError('Vault is not encrypted', ErrorCodes.VAULT_METADATA_INVALID);
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
    const current = await this.#resolveCurrentVaultTree();
    if (!current) {
      return null;
    }
    return await this.#readMetadataFromTree(current.treeOid);
  }
}
