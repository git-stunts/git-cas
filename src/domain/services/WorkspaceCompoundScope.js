import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';

export const DEFAULT_WORKSPACE_COMPOUND_OPERATIONS = 64;
export const MAX_WORKSPACE_COMPOUND_OPERATIONS = 1_024;

/** Bounded provisional page and bundle writes owned by one compound admission. */
export default class WorkspaceCompoundScope {
  #active = true;
  #abortFailure;
  #aborted = false;
  #bundles;
  #failed = false;
  #failure;
  #maxOperations;
  #operationCount = 0;
  #pages;
  #persistence;
  #staged = [];
  #tail = Promise.resolve();

  constructor({ pages, bundles, persistence, maxOperations }) {
    WorkspaceCompoundScope.#assertDependencies({ pages, bundles, persistence });
    this.#pages = pages;
    this.#bundles = bundles;
    this.#persistence = persistence;
    this.#maxOperations = WorkspaceCompoundScope.#operationLimit(maxOperations);
    this.api = Object.freeze({
      pages: Object.freeze({
        putBatch: (options) =>
          this.#enqueue('pages.putBatch', async () => await this.#putPages(options)),
      }),
      bundles: Object.freeze({
        putOrderedBatch: (options) =>
          this.#enqueue('bundles.putOrderedBatch', async () => await this.#putBundles(options)),
      }),
    });
    Object.freeze(this);
  }

  async execute(operation) {
    if (typeof operation !== 'function') {
      throw createCasError(
        'Workspace compound admission requires an operation callback',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    let value;
    let callbackError;
    let callbackFailed = false;
    try {
      value = await operation(this.api);
    } catch (error) {
      callbackFailed = true;
      callbackError = error;
      this.#aborted = true;
      this.#abortFailure = error;
    }
    this.#active = false;
    await this.#tail;
    if (callbackFailed && this.#failed && callbackError !== this.#failure) {
      throw new AggregateError(
        [callbackError, this.#failure],
        'Workspace compound callback and staged operation both failed'
      );
    }
    if (callbackFailed) {
      throw callbackError;
    }
    if (this.#failed) {
      throw this.#failure;
    }
    if (this.#staged.length === 0) {
      throw createCasError(
        'Workspace compound admission staged no handles',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    return Object.freeze({
      value,
      staged: Object.freeze([...this.#staged]),
      operationCount: this.#operationCount,
    });
  }

  #enqueue(method, operation) {
    if (!this.#active) {
      return Promise.reject(
        createCasError('Workspace compound scope is closed', ErrorCodes.WORKSPACE_STATE_INVALID, {
          method,
        })
      );
    }
    this.#operationCount += 1;
    const limitError =
      this.#operationCount > this.#maxOperations
        ? createCasError(
            'Workspace compound operation count exceeds the configured maximum',
            ErrorCodes.INVALID_OPTIONS,
            {
              operationCount: this.#operationCount,
              maxOperations: this.#maxOperations,
              method,
            }
          )
        : null;
    const result = this.#tail.then(async () => {
      if (this.#failed) {
        throw this.#failure;
      }
      if (this.#aborted) {
        throw this.#abortFailure;
      }
      if (limitError !== null) {
        this.#recordFailure(limitError);
        throw limitError;
      }
      try {
        return await operation();
      } catch (error) {
        this.#recordFailure(error);
        throw error;
      }
    });
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #recordFailure(error) {
    if (!this.#failed) {
      this.#failed = true;
      this.#failure = error;
    }
  }

  async #putPages(options) {
    const staged = await this.#pages.putBatchWithPersistence(options, this.#persistence);
    return this.#record(staged, 'page');
  }

  async #putBundles(options) {
    const staged = await this.#bundles.putOrderedBatchWithPersistence(options, this.#persistence);
    return this.#record(staged, 'bundle');
  }

  #record(staged, kind) {
    if (!Array.isArray(staged) || staged.some((artifact) => !artifact?.handle)) {
      throw createCasError(
        `Workspace compound ${kind} batch did not return staged handles`,
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { kind }
      );
    }
    this.#staged.push(...staged);
    return Object.freeze(staged.map((artifact) => artifact.handle));
  }

  static #operationLimit(value) {
    const limit = value ?? DEFAULT_WORKSPACE_COMPOUND_OPERATIONS;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_WORKSPACE_COMPOUND_OPERATIONS) {
      throw createCasError(
        'Workspace compound operation limit is outside the supported range',
        ErrorCodes.INVALID_OPTIONS,
        { maxOperations: value, hardMaximum: MAX_WORKSPACE_COMPOUND_OPERATIONS }
      );
    }
    return limit;
  }

  static #assertDependencies({ pages, bundles, persistence }) {
    const missing = [
      ['pages.putBatchWithPersistence', typeof pages?.putBatchWithPersistence !== 'function'],
      [
        'bundles.putOrderedBatchWithPersistence',
        typeof bundles?.putOrderedBatchWithPersistence !== 'function',
      ],
      ['persistence', persistence === null || typeof persistence !== 'object'],
    ]
      .filter(([, absent]) => absent)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw createCasError(
        'Workspace compound scope requires complete dependencies',
        ErrorCodes.INVALID_OPTIONS,
        { missing }
      );
    }
  }
}
