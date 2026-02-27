/* @ts-self-types="./index.d.ts" */
/**
 * @fileoverview Content Addressable Store - Managed blob storage in Git.
 */

import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import CasService from './src/domain/services/CasService.js';
import VaultService from './src/domain/services/VaultService.js';
import GitPersistenceAdapter from './src/infrastructure/adapters/GitPersistenceAdapter.js';
import GitRefAdapter from './src/infrastructure/adapters/GitRefAdapter.js';
import NodeCryptoAdapter from './src/infrastructure/adapters/NodeCryptoAdapter.js';
import Manifest from './src/domain/value-objects/Manifest.js';
import Chunk from './src/domain/value-objects/Chunk.js';
import CryptoPort from './src/ports/CryptoPort.js';
import ObservabilityPort from './src/ports/ObservabilityPort.js';
import JsonCodec from './src/infrastructure/codecs/JsonCodec.js';
import CborCodec from './src/infrastructure/codecs/CborCodec.js';
import SilentObserver from './src/infrastructure/adapters/SilentObserver.js';
import EventEmitterObserver from './src/infrastructure/adapters/EventEmitterObserver.js';
import StatsCollector from './src/infrastructure/adapters/StatsCollector.js';

export {
  CasService,
  VaultService,
  GitPersistenceAdapter,
  GitRefAdapter,
  NodeCryptoAdapter,
  CryptoPort,
  ObservabilityPort,
  Manifest,
  Chunk,
  JsonCodec,
  CborCodec,
  SilentObserver,
  EventEmitterObserver,
  StatsCollector,
};

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
   */
  constructor({ plumbing, chunkSize, codec, policy, crypto, observability, merkleThreshold, concurrency }) {
    this.plumbing = plumbing;
    this.chunkSizeConfig = chunkSize;
    this.codecConfig = codec;
    this.policyConfig = policy;
    this.cryptoConfig = crypto;
    this.observabilityConfig = observability;
    this.merkleThresholdConfig = merkleThreshold;
    this.concurrencyConfig = concurrency;
    this.service = null;
    this.#servicePromise = null;
  }

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
      observability: this.observabilityConfig || new SilentObserver(),
      merkleThreshold: this.merkleThresholdConfig,
      concurrency: this.concurrencyConfig,
    });

    const ref = new GitRefAdapter({
      plumbing: this.plumbing,
      policy: this.policyConfig,
    });
    this.#vault = new VaultService({ persistence, ref, crypto });

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
    const iterable = service.restoreStream({ manifest, encryptionKey, passphrase });
    const readable = Readable.from(iterable);
    const writable = createWriteStream(outputPath);
    let bytesWritten = 0;
    const counter = new Transform({
      transform(chunk, _encoding, cb) {
        bytesWritten += chunk.length;
        cb(null, chunk);
      },
    });
    await pipeline(readable, counter, writable);
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
   * Restores a file from its manifest as an async iterable of Buffer chunks.
   * @param {Object} options
   * @param {import('./src/domain/value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @param {Buffer} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @returns {AsyncIterable<Buffer>}
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
  async listVault() {
    const vault = await this.#getVault();
    return vault.listVault();
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

  /** @see VaultService#getVaultMetadata */
  async getVaultMetadata() {
    const vault = await this.#getVault();
    return vault.getVaultMetadata();
  }
}
