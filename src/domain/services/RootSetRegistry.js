import CasError from '../errors/CasError.js';
import { ErrorCodes } from '../errors/index.js';
import RootSet from './RootSet.js';
import RootSetPersistence from './RootSetPersistence.js';

/**
 * Opens ref-backed RootSet instances over shared Git adapters.
 */
export default class RootSetRegistry {
  /**
   * @param {object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/GitRefPort.js').default} options.ref
   */
  constructor({ persistence, ref }) {
    if (!persistence || !ref) {
      throw new CasError(
        'RootSetRegistry requires Git persistence and ref adapters',
        ErrorCodes.ROOT_SET_DEPENDENCY_INVALID,
      );
    }
    this.persistence = persistence;
    this.ref = ref;
    Object.freeze(this);
  }

  /**
   * @param {object} options
   * @param {string} options.ref
   * @param {object} [options.retry]
   * @returns {RootSet}
   */
  open({ ref, retry } = {}) {
    return new RootSet({
      ref,
      retry,
      persistence: new RootSetPersistence({
        rootSetRef: ref,
        persistence: this.persistence,
        ref: this.ref,
      }),
    });
  }
}
