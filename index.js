/* @ts-self-types="./index.d.ts" */
/**
 * @fileoverview Content Addressable Store - Managed blob storage in Git.
 */

// ---------------------------------------------------------------------------
// Imports used in the class body
// ---------------------------------------------------------------------------
import CasService from './src/domain/services/CasService.js';
import VaultService from './src/domain/services/VaultService.js';
import rotateVaultPassphrase from './src/domain/services/rotateVaultPassphrase.js';
import GitPersistenceAdapter from './src/infrastructure/adapters/GitPersistenceAdapter.js';
import GitRefAdapter from './src/infrastructure/adapters/GitRefAdapter.js';
import createCryptoAdapter from './src/infrastructure/adapters/createCryptoAdapter.js';
import { createGitPlumbing } from './src/infrastructure/createGitPlumbing.js';
import { storeFile, restoreFile } from './src/infrastructure/adapters/FileIOHelper.js';
import JsonCodec from './src/infrastructure/codecs/JsonCodec.js';
import CborCodec from './src/infrastructure/codecs/CborCodec.js';
import SilentObserver from './src/infrastructure/adapters/SilentObserver.js';
import resolveChunker from './src/infrastructure/chunkers/resolveChunker.js';
import FixedChunker from './src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from './src/infrastructure/adapters/NodeCompressionAdapter.js';
import { PACKAGE_VERSION } from './src/package-version.js';

const PKG_VERSION = PACKAGE_VERSION;

// ---------------------------------------------------------------------------
// Re-exports — modules used in the class body
// ---------------------------------------------------------------------------
export {
  CasService,
  VaultService,
  GitPersistenceAdapter,
  GitRefAdapter,
  JsonCodec,
  CborCodec,
  SilentObserver,
};

// ---------------------------------------------------------------------------
// Re-exports — barrel-only (no local binding needed)
// ---------------------------------------------------------------------------
export { default as NodeCryptoAdapter } from './src/infrastructure/adapters/NodeCryptoAdapter.js';
export { default as CryptoPort } from './src/ports/CryptoPort.js';
export { default as ChunkingPort } from './src/ports/ChunkingPort.js';
export { default as ObservabilityPort } from './src/ports/ObservabilityPort.js';
export { default as Manifest } from './src/domain/value-objects/Manifest.js';
export { default as Chunk } from './src/domain/value-objects/Chunk.js';
export { default as EventEmitterObserver } from './src/infrastructure/adapters/EventEmitterObserver.js';
export { default as StatsCollector } from './src/infrastructure/adapters/StatsCollector.js';
export { default as FixedChunker } from './src/infrastructure/chunkers/FixedChunker.js';
export { default as CdcChunker } from './src/infrastructure/chunkers/CdcChunker.js';
export { default as CompressionPort } from './src/ports/CompressionPort.js';
export { default as NodeCompressionAdapter } from './src/infrastructure/adapters/NodeCompressionAdapter.js';
export { default as diffManifests } from './src/domain/services/ManifestDiff.js';
export { SCHEME_WHOLE, SCHEME_FRAMED, SCHEME_CONVERGENT } from './src/domain/encryption/schemes.js';

/**
 * High-level facade for the Content Addressable Store library.
 *
 * Wraps {@link CasService} and {@link VaultService} with lazy initialization,
 * runtime-adaptive crypto selection, and convenience helpers for file I/O.
 */
export default class ContentAddressableStore {
  /**
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance for Git operations.
   * @param {number} [options.chunkSize] - Chunk size in bytes (default 256 KiB).
   * @param {import('./src/ports/CodecPort.js').default} [options.codec] - Manifest codec (default JsonCodec).
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto] - Crypto adapter (auto-detected if omitted).
   * @param {import('./src/ports/ObservabilityPort.js').default} [options.observability] - Observability adapter (SilentObserver if omitted).
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy for Git I/O.
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number }} [options.chunking] - Chunking strategy config.
   * @param {import('./src/ports/ChunkingPort.js').default} [options.chunker] - Pre-built ChunkingPort instance (advanced).
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max buffered restore size in bytes for encrypted/compressed restores (default 512 MiB).
   * @param {import('./src/ports/CompressionPort.js').default} [options.compressionAdapter] - Compression adapter (default NodeCompressionAdapter).
   */
  constructor({ plumbing, chunkSize, codec, policy, crypto, observability, merkleThreshold, concurrency, chunking, chunker, maxRestoreBufferSize, compressionAdapter }) {
    this.#config = { plumbing, chunkSize, codec, policy, crypto, observability, merkleThreshold, concurrency, chunking, chunker, maxRestoreBufferSize, compressionAdapter };
    this.service = null;
    this.#servicePromise = null;
  }

  /** @type {{ plumbing: *, chunkSize?: number, codec?: *, policy?: *, crypto?: *, observability?: *, merkleThreshold?: number, concurrency?: number, chunking?: *, chunker?: *, maxRestoreBufferSize?: number, compressionAdapter?: * }} */
  #config;
  /** @type {VaultService|null} */
  #vault = null;
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
   * Constructs adapters, resolves crypto, and creates CasService + VaultService.
   * @private
   * @returns {Promise<CasService>}
   */
  async #initService() {
    const cfg = this.#config;
    const persistence = new GitPersistenceAdapter({
      plumbing: cfg.plumbing,
      policy: cfg.policy,
    });
    const crypto = cfg.crypto || await createCryptoAdapter();
    const chunkSize = cfg.chunkSize || 256 * 1024;
    const chunker = resolveChunker({ chunker: cfg.chunker, chunking: cfg.chunking })
      || new FixedChunker({ chunkSize });
    this.service = new CasService({
      persistence,
      chunkSize,
      codec: cfg.codec || new JsonCodec(),
      crypto,
      observability: cfg.observability || new SilentObserver(),
      merkleThreshold: cfg.merkleThreshold,
      concurrency: cfg.concurrency,
      chunker,
      maxRestoreBufferSize: cfg.maxRestoreBufferSize,
      compressionAdapter: cfg.compressionAdapter || new NodeCompressionAdapter(),
      formatVersion: PKG_VERSION,
    });

    const ref = new GitRefAdapter({
      plumbing: cfg.plumbing,
      policy: cfg.policy,
    });
    this.#vault = new VaultService({ persistence, ref, crypto, observability: this.service.observability });

    return this.service;
  }

  /**
   * Lazily initializes and returns the underlying {@link VaultService}.
   * @private
   * @returns {Promise<VaultService>}
   */
  async #getVault() {
    await this.#getService();
    return this.#vault;
  }

  /**
   * Lazily initializes and returns the underlying {@link CasService}.
   * @returns {Promise<CasService>}
   */
  async getService() {
    return await this.#getService();
  }

  /**
   * Lazily initializes and returns the underlying {@link VaultService}.
   * @returns {Promise<VaultService>}
   */
  async getVaultService() {
    return await this.#getVault();
  }

  /**
   * Factory to create a default JSON CAS from a Git working directory.
   *
   * This is the shortest path for normal callers: the facade constructs the
   * runtime-aware Git plumbing adapter and keeps all other options available.
   *
   * @param {Object} [options]
   * @param {string} [options.cwd='.'] - Git working directory.
   * @param {string} [options.env] - Shell runner environment override.
   * @param {number} [options.chunkSize] - Chunk size in bytes.
   * @param {import('./src/ports/CodecPort.js').default} [options.codec] - Manifest codec.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto] - Crypto adapter.
   * @param {import('./src/ports/ObservabilityPort.js').default} [options.observability] - Observability adapter.
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number }} [options.chunking] - Chunking strategy config.
   * @param {import('./src/ports/ChunkingPort.js').default} [options.chunker] - Pre-built ChunkingPort instance.
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max buffered restore size in bytes.
   * @param {import('./src/ports/CompressionPort.js').default} [options.compressionAdapter] - Compression adapter.
   * @returns {ContentAddressableStore}
   */
  static open({ cwd = '.', env, ...options } = {}) {
    return new ContentAddressableStore({
      ...options,
      plumbing: createGitPlumbing({ cwd, env }),
    });
  }

  /**
   * Factory to create a CAS with JSON codec.
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {number} [options.chunkSize] - Chunk size in bytes.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto] - Crypto adapter.
   * @param {import('./src/ports/ObservabilityPort.js').default} [options.observability] - Observability adapter.
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number }} [options.chunking] - Chunking strategy config.
   * @param {import('./src/ports/ChunkingPort.js').default} [options.chunker] - Pre-built ChunkingPort instance.
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max buffered restore size in bytes.
   * @param {import('./src/ports/CompressionPort.js').default} [options.compressionAdapter] - Compression adapter.
   * @returns {ContentAddressableStore}
   */
  static createJson({ plumbing, ...options }) {
    return new ContentAddressableStore({ ...options, plumbing, codec: new JsonCodec() });
  }

  /**
   * Factory to create a CAS with CBOR codec.
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {number} [options.chunkSize] - Chunk size in bytes.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto] - Crypto adapter.
   * @param {import('./src/ports/ObservabilityPort.js').default} [options.observability] - Observability adapter.
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number }} [options.chunking] - Chunking strategy config.
   * @param {import('./src/ports/ChunkingPort.js').default} [options.chunker] - Pre-built ChunkingPort instance.
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max buffered restore size in bytes.
   * @param {import('./src/ports/CompressionPort.js').default} [options.compressionAdapter] - Compression adapter.
   * @returns {ContentAddressableStore}
   */
  static createCbor({ plumbing, ...options }) {
    return new ContentAddressableStore({ ...options, plumbing, codec: new CborCodec() });
  }

  /**
   * Returns the configured chunk size in bytes.
   * @returns {number}
   */
  get chunkSize() {
    return this.service?.chunkSize || this.#config.chunkSize || 256 * 1024;
  }

  /**
   * Encrypts bytes using AES-256-GCM.
   * @param {Object} options
   * @param {Uint8Array} options.buffer - Plaintext data to encrypt.
   * @param {Uint8Array} options.key - 32-byte encryption key.
   * @returns {Promise<{ buf: Uint8Array, meta: { algorithm: string, nonce: string, tag: string, encrypted: boolean } }>}
   */
  async encrypt(options) {
    const service = await this.#getService();
    return await service.encrypt(options);
  }

  /**
   * Decrypts bytes. Returns them unchanged if `meta.encrypted` is falsy.
   * @param {Object} options
   * @param {Uint8Array} options.buffer - Ciphertext to decrypt.
   * @param {Uint8Array} options.key - 32-byte encryption key.
   * @param {{ encrypted: boolean, algorithm: string, nonce: string, tag: string }} options.meta - Encryption metadata.
   * @returns {Promise<Uint8Array>}
   */
  async decrypt(options) {
    const service = await this.#getService();
    return await service.decrypt(options);
  }

  /**
   * Reads a file from disk and stores it in Git as chunked blobs.
   * @param {Object} options
   * @param {string} options.filePath - Absolute or relative path to the file.
   * @param {string} options.slug - Logical identifier for the stored asset.
   * @param {string} [options.filename] - Override filename (defaults to basename of filePath).
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key for AES-256-GCM encryption.
   * @param {string} [options.passphrase] - Derive encryption key from passphrase.
   * @param {{ scheme?: 'whole'|'framed'|'convergent', frameBytes?: number, convergent?: boolean }} [options.encryption] - Explicit encryption scheme selection.
   * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
   * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
   * @param {Array<{label: string, key: Uint8Array}>} [options.recipients] - Envelope recipients (mutually exclusive with encryptionKey/passphrase).
   * @returns {Promise<import('./src/domain/value-objects/Manifest.js').default>} The resulting manifest.
   */
  async storeFile(options) {
    const service = await this.#getService();
    return await storeFile(service, options);
  }

  /**
   * Stores an async iterable source in Git as chunked blobs.
   * @param {Object} options
   * @param {AsyncIterable<Uint8Array>} options.source - Data to store.
   * @param {string} options.slug - Logical identifier for the stored asset.
   * @param {string} options.filename - Filename for the manifest.
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key for AES-256-GCM encryption.
   * @param {string} [options.passphrase] - Derive encryption key from passphrase.
   * @param {{ scheme?: 'whole'|'framed'|'convergent', frameBytes?: number, convergent?: boolean }} [options.encryption] - Explicit encryption scheme selection.
   * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
   * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
   * @param {Array<{label: string, key: Uint8Array}>} [options.recipients] - Envelope recipients (mutually exclusive with encryptionKey/passphrase).
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
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @param {string} options.outputPath - Destination file path.
   * @returns {Promise<{ bytesWritten: number }>}
   */
  async restoreFile(options) {
    const service = await this.#getService();
    return await restoreFile(service, options);
  }

  /**
   * Restores a file from its manifest, returning the bytes directly.
   * @param {Object} options
   * @param {import('./src/domain/value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @returns {Promise<{ buffer: Uint8Array, bytesWritten: number }>}
   */
  async restore(options) {
    const service = await this.#getService();
    return await service.restore(options);
  }

  /**
   * Restores a file from its manifest as an async iterable of byte chunks.
   * @param {Object} options
   * @param {import('./src/domain/value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *restoreStream(options) {
    const service = await this.#getService();
    yield* service.restoreStream(options);
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
   * @param {{ encryptionKey?: Uint8Array, passphrase?: string }} [options] - Optional decryption credentials for encrypted manifests.
   * @returns {Promise<boolean>} `true` if all chunks pass verification.
   */
  async verifyIntegrity(manifest, options) {
    const service = await this.#getService();
    return await service.verifyIntegrity(manifest, options);
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
   * Compares two manifests by chunk digest.
   * Pure function — no I/O needed. Does not require initialization.
   * @param {import('./src/domain/value-objects/Manifest.js').default} oldManifest
   * @param {import('./src/domain/value-objects/Manifest.js').default} newManifest
   * @returns {import('./src/domain/services/ManifestDiff.js').ManifestDiffResult}
   */
  static diffManifests(oldManifest, newManifest) {
    return CasService.diffManifests(oldManifest, newManifest);
  }

  /**
   * Reads a manifest from a Git tree and returns inspection metadata.
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID of the asset.
   * @returns {Promise<{ slug: string, chunksOrphaned: number }>}
   */
  async inspectAsset(options) {
    const service = await this.#getService();
    return await service.inspectAsset(options);
  }

  /**
   * @deprecated Use {@link inspectAsset} instead.
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
   * @param {Object} options
   * @param {string[]} options.treeOids - Git tree OIDs to analyze.
   * @returns {Promise<{ referenced: Set<string>, total: number }>}
   */
  async collectReferencedChunks(options) {
    const service = await this.#getService();
    return await service.collectReferencedChunks(options);
  }

  /**
   * @deprecated Use {@link collectReferencedChunks} instead.
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
   * @param {Uint8Array} [options.salt] - Salt (random if omitted).
   * @param {'pbkdf2'|'scrypt'} [options.algorithm='pbkdf2'] - KDF algorithm.
   * @param {number} [options.iterations] - PBKDF2 iterations.
   * @param {number} [options.cost] - scrypt cost (N).
   * @param {number} [options.blockSize] - scrypt block size (r).
   * @param {number} [options.parallelization] - scrypt parallelization (p).
   * @param {number} [options.keyLength=32] - Derived key length.
   * @returns {Promise<{ key: Uint8Array, salt: Uint8Array, params: Object }>}
   */
  async deriveKey(options) {
    const service = await this.#getService();
    return await service.deriveKey(options);
  }

  // ---------------------------------------------------------------------------
  // Recipient management — delegates to CasService
  // ---------------------------------------------------------------------------

  /**
   * Adds a recipient to an envelope-encrypted manifest.
   * @param {Object} options
   * @param {import('./src/domain/value-objects/Manifest.js').default} options.manifest
   * @param {Uint8Array} options.existingKey - KEK of an existing recipient.
   * @param {Uint8Array} options.newRecipientKey - KEK for the new recipient.
   * @param {string} options.label - Label for the new recipient.
   * @returns {Promise<import('./src/domain/value-objects/Manifest.js').default>}
   */
  async addRecipient(options) {
    const service = await this.#getService();
    return await service.addRecipient(options);
  }

  /**
   * Removes a recipient from an envelope-encrypted manifest.
   * @param {Object} options
   * @param {import('./src/domain/value-objects/Manifest.js').default} options.manifest
   * @param {string} options.label - Label to remove.
   * @returns {Promise<import('./src/domain/value-objects/Manifest.js').default>}
   */
  async removeRecipient(options) {
    const service = await this.#getService();
    return await service.removeRecipient(options);
  }

  /**
   * Lists recipient labels from an envelope-encrypted manifest.
   * @param {import('./src/domain/value-objects/Manifest.js').default} manifest
   * @returns {Promise<string[]>}
   */
  async listRecipients(manifest) {
    const service = await this.#getService();
    return service.listRecipients(manifest);
  }

  /**
   * Rotates a recipient's key without re-encrypting data blobs.
   * @param {Object} options
   * @param {import('./src/domain/value-objects/Manifest.js').default} options.manifest
   * @param {Uint8Array} options.oldKey - Current KEK of the recipient to rotate.
   * @param {Uint8Array} options.newKey - New KEK to wrap the DEK with.
   * @param {string} [options.label] - If provided, only rotate the named recipient.
   * @returns {Promise<import('./src/domain/value-objects/Manifest.js').default>}
   */
  async rotateKey(options) {
    const service = await this.#getService();
    return await service.rotateKey(options);
  }

  // ---------------------------------------------------------------------------
  // Vault — delegates to VaultService
  // ---------------------------------------------------------------------------

  static VAULT_REF = VaultService.VAULT_REF;

  /** @see VaultService#initVault */
  async initVault(options) {
    const vault = await this.#getVault();
    return vault.initVault(options);
  }

  /** @see VaultService#addToVault */
  async addToVault(options) {
    const vault = await this.#getVault();
    return vault.addToVault(options);
  }

  /** @see VaultService#listVault */
  async listVault(options) {
    const vault = await this.#getVault();
    return vault.listVault(options);
  }

  /** @see VaultService#removeFromVault */
  async removeFromVault(options) {
    const vault = await this.#getVault();
    return vault.removeFromVault(options);
  }

  /** @see VaultService#resolveVaultEntry */
  async resolveVaultEntry(options) {
    const vault = await this.#getVault();
    return vault.resolveVaultEntry(options);
  }

  /** @see VaultService#verifyVaultKey */
  async verifyVaultKey(options) {
    const vault = await this.#getVault();
    return vault.verifyVaultKey(options);
  }

  /** @see VaultService#getVaultMetadata */
  async getVaultMetadata() {
    const vault = await this.#getVault();
    return vault.getVaultMetadata();
  }

  // ---------------------------------------------------------------------------
  // Key rotation — orchestrates CasService + VaultService
  // ---------------------------------------------------------------------------

  /**
   * Rotates the vault-level passphrase. Re-wraps every envelope-encrypted
   * entry's DEK with a new KEK derived from `newPassphrase`. Entries using
   * direct-key encryption are skipped.
   *
   * @param {Object} options
   * @param {string} options.oldPassphrase - Current vault passphrase.
   * @param {string} options.newPassphrase - New vault passphrase.
   * @param {Object} [options.kdfOptions] - KDF options for new passphrase.
   * @param {number} [options.maxRetries=3] - Maximum optimistic-concurrency retries on VAULT_CONFLICT.
   * @param {number} [options.retryBaseMs=50] - Base delay in ms for exponential backoff between retries.
   * @returns {Promise<{ commitOid: string, rotatedSlugs: string[], skippedSlugs: string[] }>}
   */
  async rotateVaultPassphrase(options) {
    const service = await this.#getService();
    const vault = await this.#getVault();
    return await rotateVaultPassphrase({ service, vault }, options);
  }
}
