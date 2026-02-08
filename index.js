/* @ts-self-types="./index.d.ts" */
/**
 * @fileoverview Content Addressable Store - Managed blob storage in Git.
 */

import { createReadStream, writeFileSync } from 'node:fs';
import path from 'node:path';
import CasService from './src/domain/services/CasService.js';
import GitPersistenceAdapter from './src/infrastructure/adapters/GitPersistenceAdapter.js';
import NodeCryptoAdapter from './src/infrastructure/adapters/NodeCryptoAdapter.js';
import Manifest from './src/domain/value-objects/Manifest.js';
import Chunk from './src/domain/value-objects/Chunk.js';
import CryptoPort from './src/ports/CryptoPort.js';
import JsonCodec from './src/infrastructure/codecs/JsonCodec.js';
import CborCodec from './src/infrastructure/codecs/CborCodec.js';
import CasError from './src/domain/errors/CasError.js';

export {
  CasService,
  GitPersistenceAdapter,
  NodeCryptoAdapter,
  CryptoPort,
  Manifest,
  Chunk,
  JsonCodec,
  CborCodec
};

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
 * Detects the best crypto adapter for the current runtime.
 * @returns {Promise<import('./src/ports/CryptoPort.js').default>} A runtime-appropriate CryptoPort implementation.
 */
async function getDefaultCryptoAdapter() {
  if (globalThis.Bun) {
    const { default: BunCryptoAdapter } = await import('./src/infrastructure/adapters/BunCryptoAdapter.js');
    return new BunCryptoAdapter();
  }
  if (globalThis.Deno) {
    const { default: WebCryptoAdapter } = await import('./src/infrastructure/adapters/WebCryptoAdapter.js');
    return new WebCryptoAdapter();
  }
  return new NodeCryptoAdapter();
}

/**
 * High-level facade for the Content Addressable Store library.
 *
 * Wraps {@link CasService} with lazy initialization, runtime-adaptive crypto
 * selection, and convenience helpers for file I/O.
 */
export default class ContentAddressableStore {
  /**
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance for Git operations.
   * @param {number} [options.chunkSize] - Chunk size in bytes (default 256 KiB).
   * @param {import('./src/ports/CodecPort.js').default} [options.codec] - Manifest codec (default JsonCodec).
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto] - Crypto adapter (auto-detected if omitted).
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy for Git I/O.
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   */
  constructor({ plumbing, chunkSize, codec, policy, crypto, merkleThreshold }) {
    this.plumbing = plumbing;
    this.chunkSizeConfig = chunkSize;
    this.codecConfig = codec;
    this.policyConfig = policy;
    this.cryptoConfig = crypto;
    this.merkleThresholdConfig = merkleThreshold;
    this.service = null;
    this.#servicePromise = null;
  }

  #servicePromise = null;

  /**
   * Lazily initializes the service, handling async adapter discovery.
   * @private
   * @returns {Promise<CasService>}
   */
  async #getService() {
    if (!this.#servicePromise) {
      this.#servicePromise = this.#initService();
    }
    return await this.#servicePromise;
  }

  /**
   * Constructs the persistence adapter, resolves crypto, and creates the CasService.
   * @private
   * @returns {Promise<CasService>}
   */
  async #initService() {
    const persistence = new GitPersistenceAdapter({
      plumbing: this.plumbing,
      policy: this.policyConfig
    });
    const crypto = this.cryptoConfig || await getDefaultCryptoAdapter();
    this.service = new CasService({
      persistence,
      chunkSize: this.chunkSizeConfig,
      codec: this.codecConfig || new JsonCodec(),
      crypto,
      merkleThreshold: this.merkleThresholdConfig,
    });
    return this.service;
  }

  /**
   * Lazily initializes and returns the underlying {@link CasService}.
   * @returns {Promise<CasService>}
   */
  async getService() {
    return await this.#getService();
  }

  /**
   * Factory to create a CAS with JSON codec.
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {number} [options.chunkSize] - Chunk size in bytes.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   * @returns {ContentAddressableStore}
   */
  static createJson({ plumbing, chunkSize, policy }) {
    return new ContentAddressableStore({ plumbing, chunkSize, codec: new JsonCodec(), policy });
  }

  /**
   * Factory to create a CAS with CBOR codec.
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {number} [options.chunkSize] - Chunk size in bytes.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   * @returns {ContentAddressableStore}
   */
  static createCbor({ plumbing, chunkSize, policy }) {
    return new ContentAddressableStore({ plumbing, chunkSize, codec: new CborCodec(), policy });
  }

  /**
   * Returns the configured chunk size in bytes.
   * @returns {number}
   */
  get chunkSize() {
    return this.service?.chunkSize || this.chunkSizeConfig || 256 * 1024;
  }

  /**
   * Encrypts a buffer using AES-256-GCM.
   * @param {Object} options
   * @param {Buffer} options.buffer - Plaintext data to encrypt.
   * @param {Buffer} options.key - 32-byte encryption key.
   * @returns {Promise<{ buf: Buffer, meta: { algorithm: string, nonce: string, tag: string, encrypted: boolean } }>}
   */
  async encrypt(options) {
    const service = await this.#getService();
    return await service.encrypt(options);
  }

  /**
   * Decrypts a buffer. Returns it unchanged if `meta.encrypted` is falsy.
   * @param {Object} options
   * @param {Buffer} options.buffer - Ciphertext to decrypt.
   * @param {Buffer} options.key - 32-byte encryption key.
   * @param {{ encrypted: boolean, algorithm: string, nonce: string, tag: string }} options.meta - Encryption metadata.
   * @returns {Promise<Buffer>}
   */
  async decrypt(options) {
    const service = await this.#getService();
    return await service.decrypt(options);
  }

  /**
   * Reads a file from disk and stores it in Git as chunked blobs.
   *
   * Convenience wrapper that opens a read stream and delegates to
   * {@link CasService#store}.
   *
   * @param {Object} options
   * @param {string} options.filePath - Absolute or relative path to the file.
   * @param {string} options.slug - Logical identifier for the stored asset.
   * @param {string} [options.filename] - Override filename (defaults to basename of filePath).
   * @param {Buffer} [options.encryptionKey] - 32-byte key for AES-256-GCM encryption.
   * @param {string} [options.passphrase] - Derive encryption key from passphrase.
   * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
   * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
   * @returns {Promise<import('./src/domain/value-objects/Manifest.js').default>} The resulting manifest.
   */
  async storeFile({ filePath, slug, filename, encryptionKey, passphrase, kdfOptions, compression }) {
    const source = createReadStream(filePath);
    const service = await this.#getService();
    return await service.store({
      source,
      slug,
      filename: filename || path.basename(filePath),
      encryptionKey,
      passphrase,
      kdfOptions,
      compression,
    });
  }

  /**
   * Stores an async iterable source in Git as chunked blobs.
   * @param {Object} options
   * @param {AsyncIterable<Buffer>} options.source - Data to store.
   * @param {string} options.slug - Logical identifier for the stored asset.
   * @param {string} options.filename - Filename for the manifest.
   * @param {Buffer} [options.encryptionKey] - 32-byte key for AES-256-GCM encryption.
   * @param {string} [options.passphrase] - Derive encryption key from passphrase.
   * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
   * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
   * @returns {Promise<import('./src/domain/value-objects/Manifest.js').default>} The resulting manifest.
   */
  async store(options) {
    const service = await this.#getService();
    return await service.store(options);
  }

  /**
   * Restores a file from its manifest and writes it to disk.
   * @param {Object} options
   * @param {import('./src/domain/value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @param {Buffer} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @param {string} options.outputPath - Destination file path.
   * @returns {Promise<{ bytesWritten: number }>}
   */
  async restoreFile({ manifest, encryptionKey, passphrase, outputPath }) {
    const service = await this.#getService();
    const { buffer, bytesWritten } = await service.restore({
      manifest,
      encryptionKey,
      passphrase,
    });
    writeFileSync(outputPath, buffer);
    return { bytesWritten };
  }

  /**
   * Restores a file from its manifest, returning the buffer directly.
   * @param {Object} options
   * @param {import('./src/domain/value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @param {Buffer} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @returns {Promise<{ buffer: Buffer, bytesWritten: number }>}
   */
  async restore(options) {
    const service = await this.#getService();
    return await service.restore(options);
  }

  /**
   * Creates a Git tree object from a manifest.
   * @param {Object} options
   * @param {import('./src/domain/value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @returns {Promise<string>} Git OID of the created tree.
   */
  async createTree(options) {
    const service = await this.#getService();
    return await service.createTree(options);
  }

  /**
   * Verifies the integrity of a stored file by re-hashing its chunks.
   * @param {import('./src/domain/value-objects/Manifest.js').default} manifest - The file manifest.
   * @returns {Promise<boolean>} `true` if all chunks pass verification.
   */
  async verifyIntegrity(manifest) {
    const service = await this.#getService();
    return await service.verifyIntegrity(manifest);
  }

  /**
   * Reads a manifest from a Git tree OID.
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID to read the manifest from.
   * @returns {Promise<import('./src/domain/value-objects/Manifest.js').default>}
   */
  async readManifest(options) {
    const service = await this.#getService();
    return await service.readManifest(options);
  }

  /**
   * Returns deletion metadata for an asset stored in a Git tree.
   * Does not perform any destructive Git operations.
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID of the asset.
   * @returns {Promise<{ slug: string, chunksOrphaned: number }>}
   */
  async deleteAsset(options) {
    const service = await this.#getService();
    return await service.deleteAsset(options);
  }

  /**
   * Aggregates referenced chunk blob OIDs across multiple stored assets.
   * Analysis only — does not delete or modify anything.
   * @param {Object} options
   * @param {string[]} options.treeOids - Git tree OIDs to analyze.
   * @returns {Promise<{ referenced: Set<string>, total: number }>}
   */
  async findOrphanedChunks(options) {
    const service = await this.#getService();
    return await service.findOrphanedChunks(options);
  }

  /**
   * Derives an encryption key from a passphrase using PBKDF2 or scrypt.
   * @param {Object} options
   * @param {string} options.passphrase - The passphrase.
   * @param {Buffer} [options.salt] - Salt (random if omitted).
   * @param {'pbkdf2'|'scrypt'} [options.algorithm='pbkdf2'] - KDF algorithm.
   * @param {number} [options.iterations] - PBKDF2 iterations.
   * @param {number} [options.cost] - scrypt cost (N).
   * @param {number} [options.blockSize] - scrypt block size (r).
   * @param {number} [options.parallelization] - scrypt parallelization (p).
   * @param {number} [options.keyLength=32] - Derived key length.
   * @returns {Promise<{ key: Buffer, salt: Buffer, params: Object }>}
   */
  async deriveKey(options) {
    const service = await this.#getService();
    return await service.deriveKey(options);
  }

  // ---------------------------------------------------------------------------
  // Vault — GC-safe ref-based storage
  // ---------------------------------------------------------------------------

  static VAULT_REF = 'refs/cas/vault';
  static #MAX_CAS_RETRIES = 3;
  static #CAS_RETRY_BASE_MS = 50;

  /**
   * Validates a single slug segment.
   * @private
   * @param {string} seg
   * @param {string} slug - Full slug for error context.
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
  _validateSlug(slug) {
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
      ContentAddressableStore.#validateSegment(seg, slug);
    }
  }

  /**
   * Parses ls-tree output into entries Map and metadata blob OID.
   * @private
   */
  static #parseTreeEntries(output) {
    const entries = new Map();
    let metadataBlobOid = null;
    if (!output || output.length === 0) {
      return { entries, metadataBlobOid };
    }
    for (const line of output.split('\0').filter(Boolean)) {
      const tabIdx = line.indexOf('\t');
      const oid = line.slice(0, tabIdx).split(' ')[2];
      const name = line.slice(tabIdx + 1);
      if (name === '.vault.json') {
        metadataBlobOid = oid;
      } else {
        entries.set(name, oid);
      }
    }
    return { entries, metadataBlobOid };
  }

  /**
   * Validates vault metadata object structure.
   * @private
   */
  static #validateVaultMetadata(metadata) {
    if (typeof metadata.version !== 'number' || metadata.version !== 1) {
      throw new CasError(
        `Unsupported vault metadata version: ${metadata.version}`,
        'VAULT_METADATA_INVALID',
        { metadata },
      );
    }
    if (!metadata.encryption) {
      return;
    }
    const { cipher, kdf } = metadata.encryption;
    if (!cipher || !kdf?.algorithm || !kdf?.salt) {
      throw new CasError(
        'Vault encryption metadata missing required fields',
        'VAULT_METADATA_INVALID',
        { metadata },
      );
    }
  }

  /**
   * Reads and validates vault metadata from a blob OID.
   * @private
   */
  async #readVaultMetadataBlob(blobOid) {
    try {
      const blob = await this.plumbing.execute({
        args: ['cat-file', 'blob', blobOid],
      });
      const metadata = JSON.parse(blob);
      ContentAddressableStore.#validateVaultMetadata(metadata);
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

  /**
   * Reads the current vault state from refs/cas/vault.
   * @returns {Promise<{ entries: Map<string, string>, parentCommitOid: string|null, metadata: object|null }>}
   */
  async _readVaultState() {
    let commitOid;
    try {
      commitOid = await this.plumbing.execute({
        args: ['rev-parse', ContentAddressableStore.VAULT_REF],
      });
    } catch {
      return { entries: new Map(), parentCommitOid: null, metadata: null };
    }

    const treeOid = await this.plumbing.execute({
      args: ['rev-parse', `${ContentAddressableStore.VAULT_REF}^{tree}`],
    });
    const output = await this.plumbing.execute({
      args: ['ls-tree', '-z', treeOid],
    });

    const { entries, metadataBlobOid } = ContentAddressableStore.#parseTreeEntries(output);
    const metadata = metadataBlobOid
      ? await this.#readVaultMetadataBlob(metadataBlobOid)
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
  async _writeVaultCommit({ entries, metadata, parentCommitOid, message }) {
    const metadataBlob = await this.plumbing.execute({
      args: ['hash-object', '-w', '--stdin'],
      input: JSON.stringify(metadata, null, 2),
    });

    const treeLines = [`100644 blob ${metadataBlob}\t.vault.json`];
    for (const [slug, treeOid] of entries) {
      treeLines.push(`040000 tree ${treeOid}\t${slug}`);
    }

    const newTreeOid = await this.plumbing.execute({
      args: ['mktree'],
      input: `${treeLines.join('\n')}\n`,
    });

    const commitOid = await this.#createVaultCommit(newTreeOid, parentCommitOid, message);
    await this.#casUpdateRef(commitOid, parentCommitOid);
    return { commitOid };
  }

  /**
   * Creates a commit-tree for the vault.
   * @private
   */
  async #createVaultCommit(treeOid, parentOid, message) {
    const args = ['commit-tree', treeOid, '-m', message];
    if (parentOid) {
      args.push('-p', parentOid);
    }
    return await this.plumbing.execute({ args });
  }

  /**
   * Atomically updates the vault ref with CAS semantics.
   * @private
   */
  async #casUpdateRef(newOid, expectedOldOid) {
    const args = ['update-ref', ContentAddressableStore.VAULT_REF, newOid];
    if (expectedOldOid) {
      args.push(expectedOldOid);
    }
    try {
      await this.plumbing.execute({ args });
    } catch {
      throw new CasError(
        'Concurrent vault update detected',
        'VAULT_CONFLICT',
        { expectedParent: expectedOldOid, newCommit: newOid },
      );
    }
  }

  /**
   * Wraps a vault mutation with CAS retry logic.
   * @param {function} mutationFn - Async function(state) → { entries, metadata, message }
   * @returns {Promise<{ commitOid: string }>}
   */
  async #retryVaultMutation(mutationFn) {
    const maxRetries = ContentAddressableStore.#MAX_CAS_RETRIES;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const state = await this._readVaultState();
      const { entries, metadata, message } = await mutationFn(state);
      try {
        return await this._writeVaultCommit({
          entries, metadata, parentCommitOid: state.parentCommitOid, message,
        });
      } catch (err) {
        const isRetryable = err instanceof CasError && err.code === 'VAULT_CONFLICT';
        if (!isRetryable || attempt >= maxRetries - 1) {
          throw err;
        }
        const delay = ContentAddressableStore.#CAS_RETRY_BASE_MS * (2 ** attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    /* c8 ignore next 2 */
    throw new CasError('Vault CAS retries exhausted', 'VAULT_CONFLICT');
  }

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

  /**
   * Initializes the vault, optionally with encryption.
   * @param {Object} [options]
   * @param {string} [options.passphrase] - Passphrase for vault-level encryption.
   * @param {Object} [options.kdfOptions] - KDF options (algorithm, iterations, etc.).
   * @returns {Promise<{ commitOid: string }>}
   */
  async initVault({ passphrase, kdfOptions } = {}) {
    const state = await this._readVaultState();

    if (state.metadata?.encryption) {
      throw new CasError(
        'Vault encryption is already configured',
        'VAULT_ENCRYPTION_ALREADY_CONFIGURED',
      );
    }

    const metadata = { version: 1 };
    if (passphrase) {
      const service = await this.#getService();
      const { salt, params } = await service.deriveKey({ passphrase, ...kdfOptions });
      metadata.encryption = ContentAddressableStore.#buildEncryptionMeta(salt, params);
    }

    return await this._writeVaultCommit({
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
    this._validateSlug(slug);

    return await this.#retryVaultMutation((state) => {
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
    const { entries } = await this._readVaultState();
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

    const result = await this.#retryVaultMutation((state) => {
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
    const { entries } = await this._readVaultState();
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
    const { metadata } = await this._readVaultState();
    return metadata;
  }
}
