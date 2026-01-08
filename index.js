/**
 * @fileoverview Content Addressable Store - Managed blob storage in Git.
 */

import CasService from './src/domain/services/CasService.js';
import GitPersistenceAdapter from './src/infrastructure/adapters/GitPersistenceAdapter.js';
import Manifest from './src/domain/value-objects/Manifest.js';
import Chunk from './src/domain/value-objects/Chunk.js';

export {
  CasService,
  GitPersistenceAdapter,
  Manifest,
  Chunk
};

/**
 * Facade class for the CAS library.
 * Maintains backward compatibility.
 */
export default class ContentAddressableStore {
  /**
   * @param {Object} options
   * @param {import('../plumbing/index.js').default} options.plumbing
   * @param {number} [options.chunkSize]
   */
  constructor({ plumbing, chunkSize }) {
    const persistence = new GitPersistenceAdapter({ plumbing });
    this.service = new CasService({ persistence, chunkSize });
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