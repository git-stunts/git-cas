/**
 * @fileoverview Content Addressable Store - Managed blob storage in Git.
 */

import CasService from './src/domain/services/CasService.js';
import GitPersistenceAdapter from './src/infrastructure/adapters/GitPersistenceAdapter.js';
import Manifest from './src/domain/value-objects/Manifest.js';
import Chunk from './src/domain/value-objects/Chunk.js';
import JsonCodec from './src/infrastructure/codecs/JsonCodec.js';
import CborCodec from './src/infrastructure/codecs/CborCodec.js';

export {
  CasService,
  GitPersistenceAdapter,
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
   */
  constructor({ plumbing, chunkSize, codec }) {
    const persistence = new GitPersistenceAdapter({ plumbing });
    // Default to JSON if no codec provided
    this.service = new CasService({ 
      persistence, 
      chunkSize, 
      codec: codec || new JsonCodec() 
    });
  }

  /**
   * Factory to create a CAS with JSON codec.
   */
  static createJson({ plumbing, chunkSize }) {
    return new ContentAddressableStore({ plumbing, chunkSize, codec: new JsonCodec() });
  }

  /**
   * Factory to create a CAS with CBOR codec.
   */
  static createCbor({ plumbing, chunkSize }) {
    return new ContentAddressableStore({ plumbing, chunkSize, codec: new CborCodec() });
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

  async storeFile(options) {
    return this.service.storeFile(options);
  }

  async createTree(options) {
    return this.service.createTree(options);
  }
}