/**
 * @fileoverview Domain service for vault (GC-safe ref-based asset index) operations.
 */
import CasError from '../errors/CasError.js';

const VAULT_REF = 'refs/cas/vault';
const MAX_CAS_RETRIES = 3;
const CAS_RETRY_BASE_MS = 50;

/**
 * Percent-encodes a vault slug for use as a git tree entry name.
 * Git tree entry names cannot contain '/'.
 * @param {string} slug
 * @returns {string}
 */
function encodeSlug(slug) {
  return slug.replaceAll('%', '%25').replaceAll('/', '%2F');
}

/**
 * Decodes a percent-encoded tree entry name back to a vault slug.
 * @param {string} name
 * @returns {string}
 */
function decodeSlug(name) {
  return name.replaceAll('%2F', '/').replaceAll('%25', '%');
}

/**
 * Returns true if the string contains ASCII control characters (0x00–0x1f, 0x7f).
 * @param {string} str
 * @returns {boolean}
 */
function hasControlChars(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

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

  /**
   * @param {Object} options
   * @param {import('../../../src/ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../../src/ports/GitRefPort.js').default} options.ref
   * @param {import('../../../src/ports/CryptoPort.js').default} options.crypto
   */
  constructor({ persistence, ref, crypto }) {
    this.persistence = persistence;
    this.ref = ref;
    this.crypto = crypto;
  }

  // ---------------------------------------------------------------------------
  // Slug validation
  // ---------------------------------------------------------------------------

  /**
   * Validates a single slug segment.
   * @private
   */
  static #validateSegment(seg, slug) {
    if (seg.length === 0) {
      throw new CasError('Slug contains empty segment', 'INVALID_SLUG', { slug });
    }
    if (seg === '.' || seg === '..') {
      throw new CasError('Slug contains "." or ".." segment', 'INVALID_SLUG', { slug });
    }
    if (Buffer.byteLength(seg, 'utf8') > 255) {
      throw new CasError('Slug segment exceeds 255 bytes', 'INVALID_SLUG', { slug });
    }
    if (hasControlChars(seg)) {
      throw new CasError('Slug contains control characters', 'INVALID_SLUG', { slug });
    }
  }

  /**
   * Validates a vault slug.
   * @param {string} slug
   * @throws {CasError} INVALID_SLUG if the slug is invalid.
   */
  validateSlug(slug) {
    if (typeof slug !== 'string' || slug.length === 0) {
      throw new CasError('Slug must be a non-empty string', 'INVALID_SLUG', { slug });
    }
    if (slug.startsWith('/') || slug.endsWith('/')) {
      throw new CasError('Slug must not start or end with "/"', 'INVALID_SLUG', { slug });
    }
    if (Buffer.byteLength(slug, 'utf8') > 1024) {
      throw new CasError('Slug exceeds 1024 bytes total', 'INVALID_SLUG', { slug });
    }
    for (const seg of slug.split('/')) {
      VaultService.#validateSegment(seg, slug);
    }
  }

  // ---------------------------------------------------------------------------
  // Metadata validation
  // ---------------------------------------------------------------------------

  /**
   * Validates encryption-specific metadata fields.
   * @private
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
  }

  /**
   * Validates vault metadata object structure.
   * @private
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
  }

  /**
   * Reads and validates vault metadata from a blob OID.
   * @private
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
        `Failed to parse .vault.json: ${err.message}`,
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
   * @private
   * @param {Array<{ mode: string, type: string, oid: string, name: string }>} treeEntries
   */
  static #parseTreeEntries(treeEntries) {
    const entries = new Map();
    let metadataBlobOid = null;
    for (const entry of treeEntries) {
      if (entry.name === '.vault.json') {
        metadataBlobOid = entry.oid;
      } else {
        entries.set(decodeSlug(entry.name), entry.oid);
      }
    }
    return { entries, metadataBlobOid };
  }

  /**
   * Reads the current vault state from refs/cas/vault.
   * @returns {Promise<{ entries: Map<string, string>, parentCommitOid: string|null, metadata: object|null }>}
   */
  async readState() {
    let commitOid;
    try {
      commitOid = await this.ref.resolveRef(VAULT_REF);
    } catch {
      return { entries: new Map(), parentCommitOid: null, metadata: null };
    }

    const treeOid = await this.ref.resolveTree(commitOid);
    const rawEntries = await this.persistence.readTree(treeOid);
    const { entries, metadataBlobOid } = VaultService.#parseTreeEntries(rawEntries);
    const metadata = metadataBlobOid
      ? await this.#readMetadataBlob(metadataBlobOid)
      : null;

    return { entries, parentCommitOid: commitOid, metadata };
  }

  /**
   * Writes a new vault commit and updates the ref atomically.
   * @param {Object} options
   * @param {Map<string, string>} options.entries - Slug→treeOid map.
   * @param {object} options.metadata - Vault metadata (.vault.json contents).
   * @param {string|null} options.parentCommitOid - Parent commit OID (null for first commit).
   * @param {string} options.message - Commit message.
   * @returns {Promise<{ commitOid: string }>}
   */
  async writeCommit({ entries, metadata, parentCommitOid, message }) {
    const metadataBlob = await this.persistence.writeBlob(
      JSON.stringify(metadata, null, 2),
    );

    const treeLines = [`100644 blob ${metadataBlob}\t.vault.json`];
    for (const [slug, treeOid] of entries) {
      treeLines.push(`040000 tree ${treeOid}\t${encodeSlug(slug)}`);
    }

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
   * Atomically updates the vault ref with CAS semantics.
   * @private
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
   * Wraps a vault mutation with CAS retry logic.
   * @private
   * @param {function} mutationFn - Async function(state) → { entries, metadata, message }
   * @returns {Promise<{ commitOid: string }>}
   */
  async #retryMutation(mutationFn) {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const state = await this.readState();
      const { entries, metadata, message } = await mutationFn(state);
      try {
        return await this.writeCommit({
          entries, metadata, parentCommitOid: state.parentCommitOid, message,
        });
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
   * @private
   */
  static #buildEncryptionMeta(salt, params) {
    return {
      cipher: 'aes-256-gcm',
      kdf: {
        algorithm: params.algorithm,
        salt: salt.toString('base64'),
        ...('iterations' in params && { iterations: params.iterations }),
        ...('cost' in params && { cost: params.cost }),
        ...('blockSize' in params && { blockSize: params.blockSize }),
        ...('parallelization' in params && { parallelization: params.parallelization }),
        keyLength: params.keyLength,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Initializes the vault, optionally with encryption.
   * @param {Object} [options]
   * @param {string} [options.passphrase] - Passphrase for vault-level encryption.
   * @param {Object} [options.kdfOptions] - KDF options (algorithm, iterations, etc.).
   * @returns {Promise<{ commitOid: string }>}
   */
  async initVault({ passphrase, kdfOptions } = {}) {
    const state = await this.readState();

    if (state.metadata?.encryption) {
      throw new CasError(
        'Vault encryption is already configured',
        'VAULT_ENCRYPTION_ALREADY_CONFIGURED',
      );
    }

    const metadata = { version: 1 };
    if (passphrase) {
      const { salt, params } = await this.crypto.deriveKey({ passphrase, ...kdfOptions });
      metadata.encryption = VaultService.#buildEncryptionMeta(salt, params);
    }

    return await this.writeCommit({
      entries: state.entries,
      metadata,
      parentCommitOid: state.parentCommitOid,
      message: 'vault: init',
    });
  }

  /**
   * Adds or updates an entry in the vault.
   * @param {Object} options
   * @param {string} options.slug - Entry slug.
   * @param {string} options.treeOid - Git tree OID.
   * @param {boolean} [options.force=false] - Overwrite existing entry.
   * @returns {Promise<{ commitOid: string }>}
   */
  async addToVault({ slug, treeOid, force = false }) {
    this.validateSlug(slug);

    return await this.#retryMutation((state) => {
      if (state.entries.has(slug) && !force) {
        throw new CasError(
          `Vault entry "${slug}" already exists (use force to overwrite)`,
          'VAULT_ENTRY_EXISTS',
          { slug },
        );
      }
      const isUpdate = state.entries.has(slug);
      state.entries.set(slug, treeOid);
      return {
        entries: state.entries,
        metadata: state.metadata || { version: 1 },
        message: isUpdate ? `vault: update ${slug}` : `vault: add ${slug}`,
      };
    });
  }

  /**
   * Lists all vault entries.
   * @returns {Promise<Array<{ slug: string, treeOid: string }>>}
   */
  async listVault() {
    const { entries } = await this.readState();
    return [...entries.entries()]
      .map(([slug, treeOid]) => ({ slug, treeOid }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Removes an entry from the vault.
   * @param {Object} options
   * @param {string} options.slug - Entry slug to remove.
   * @returns {Promise<{ commitOid: string, removedTreeOid: string }>}
   */
  async removeFromVault({ slug }) {
    let removedTreeOid;

    const result = await this.#retryMutation((state) => {
      if (!state.entries.has(slug)) {
        throw new CasError(
          `Vault entry "${slug}" not found`,
          'VAULT_ENTRY_NOT_FOUND',
          { slug },
        );
      }
      removedTreeOid = state.entries.get(slug);
      state.entries.delete(slug);
      return {
        entries: state.entries,
        metadata: state.metadata || { version: 1 },
        message: `vault: remove ${slug}`,
      };
    });

    return { commitOid: result.commitOid, removedTreeOid };
  }

  /**
   * Resolves a vault entry slug to its tree OID.
   * @param {Object} options
   * @param {string} options.slug - Entry slug.
   * @returns {Promise<string>} The tree OID.
   */
  async resolveVaultEntry({ slug }) {
    const { entries } = await this.readState();
    if (!entries.has(slug)) {
      throw new CasError(
        `Vault entry "${slug}" not found`,
        'VAULT_ENTRY_NOT_FOUND',
        { slug },
      );
    }
    return entries.get(slug);
  }

  /**
   * Returns the vault metadata, or null if no vault exists.
   * @returns {Promise<object|null>}
   */
  async getVaultMetadata() {
    const { metadata } = await this.readState();
    return metadata;
  }
}
