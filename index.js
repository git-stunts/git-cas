/**
 * @fileoverview Content Addressable Store - Managed blob storage in Git.
 */

import { createReadStream } from 'node:fs';
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
    const persistence = new GitPersistenceAdapter({ plumbing, policy });
    this.service = new CasService({
      persistence,
      chunkSize,
      codec: codec || new JsonCodec(),
      crypto: crypto || new NodeCryptoAdapter(),
    });
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
    return this.service.chunkSize;
  }

  encrypt(options) {
    return this.service.encrypt(options);
  }

  decrypt(options) {
    return this.service.decrypt(options);
  }

  /**
   * Opens a file and delegates to CasService.store().
   * Backward-compatible API that accepts a filePath.
   */
  async storeFile({ filePath, slug, filename, encryptionKey }) {
    const source = createReadStream(filePath);
    return this.service.store({
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
    return this.service.store(options);
  }

  async createTree(options) {
    return this.service.createTree(options);
  }
}
