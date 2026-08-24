import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import WorkspaceCompoundScope from './WorkspaceCompoundScope.js';

/** Executes one bounded provisional graph build before exact workspace retention. */
export default class WorkspaceCompoundAdmission {
  #bundles;
  #pages;
  #persistence;

  constructor({ persistence, pages, bundles }) {
    WorkspaceCompoundAdmission.#assertDependencies({ persistence, pages, bundles });
    this.#persistence = persistence;
    this.#pages = pages;
    this.#bundles = bundles;
    Object.freeze(this);
  }

  async admit({ operation, maxOperations, install } = {}) {
    if (typeof install !== 'function') {
      throw createCasError(
        'Workspace compound admission requires an installation callback',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    return await this.#persistence.withWriteScope(async (persistence) => {
      const scope = new WorkspaceCompoundScope({
        pages: this.#pages,
        bundles: this.#bundles,
        persistence,
        maxOperations,
      });
      const prepared = await scope.execute(operation);
      const retention = await install(prepared.staged, persistence);
      return Object.freeze({ value: prepared.value, retention });
    });
  }

  static #assertDependencies({ persistence, pages, bundles }) {
    const missing = [
      ['persistence.withWriteScope', typeof persistence?.withWriteScope !== 'function'],
      ['pages.putBatch', typeof pages?.putBatch !== 'function'],
      ['bundles', bundles === null || typeof bundles !== 'object'],
    ]
      .filter(([, absent]) => absent)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw createCasError(
        'Workspace compound admission requires complete dependencies',
        ErrorCodes.INVALID_OPTIONS,
        { missing }
      );
    }
  }
}
