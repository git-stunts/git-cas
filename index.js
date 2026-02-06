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
 * Detects the best crypto adapter for the current runtime.
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
 * Facade class for the CAS library.
 */
export default class ContentAddressableStore {
  /**
   * @param {Object} options
   * @param {import('../plumbing/index.js').default} options.plumbing
   * @param {number} [options.chunkSize]
   * @param {import('./src/ports/CodecPort.js').default} [options.codec]
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto]
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy for Git I/O
   */
  constructor({ plumbing, chunkSize, codec, policy, crypto }) {
    this.plumbing = plumbing;
    this.chunkSizeConfig = chunkSize;
    this.codecConfig = codec;
    this.policyConfig = policy;
    this.cryptoConfig = crypto;
    this.service = null;
  }

  /**
   * Lazily initializes the service to handle async adapter discovery.
   * @private
   */
  async #getService() {
    if (!this.service) {
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
      });
    }
    return this.service;
  }

  /**
   * Lazily initializes and returns the service.
   */
  async getService() {
    return await this.#getService();
  }

  /**
   * Factory to create a CAS with JSON codec.
   */
  static createJson({ plumbing, chunkSize, policy }) {
    return new ContentAddressableStore({ plumbing, chunkSize, codec: new JsonCodec(), policy });
  }

  /**
   * Factory to create a CAS with CBOR codec.
   */
  static createCbor({ plumbing, chunkSize, policy }) {
    return new ContentAddressableStore({ plumbing, chunkSize, codec: new CborCodec(), policy });
  }

  get chunkSize() {
    return this.service?.chunkSize || this.chunkSizeConfig || 256 * 1024;
  }

  async encrypt(options) {
    const service = await this.#getService();
    return await service.encrypt(options);
  }

  async decrypt(options) {
    const service = await this.#getService();
    return await service.decrypt(options);
  }

  /**
   * Opens a file and delegates to CasService.store().
   * Backward-compatible API that accepts a filePath.
   */
  async storeFile({ filePath, slug, filename, encryptionKey }) {
    const source = createReadStream(filePath);
    const service = await this.#getService();
    return await service.store({
      source,
      slug,
      filename: filename || path.basename(filePath),
      encryptionKey,
    });
  }

  /**
   * Direct passthrough for callers who already have an async iterable source.
   */
  async store(options) {
    const service = await this.#getService();
    return await service.store(options);
  }

  /**
   * Restores a file from its manifest and writes it to outputPath.
   */
  async restoreFile({ manifest, encryptionKey, outputPath }) {
    const service = await this.#getService();
    const { buffer, bytesWritten } = await service.restore({
      manifest,
      encryptionKey,
    });
    writeFileSync(outputPath, buffer);
    return { bytesWritten };
  }

  /**
   * Restores a file from its manifest, returning the buffer directly.
   */
  async restore(options) {
    const service = await this.#getService();
    return await service.restore(options);
  }

  async createTree(options) {
    const service = await this.#getService();
    return await service.createTree(options);
  }

  async verifyIntegrity(manifest) {
    const service = await this.#getService();
    return await service.verifyIntegrity(manifest);
  }
}
