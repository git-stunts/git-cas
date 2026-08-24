import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import parseApplicationHandle from '../value-objects/ApplicationHandle.js';
import WorkspaceCompoundScope from './WorkspaceCompoundScope.js';

/** Executes one bounded provisional graph build before exact workspace retention. */
export default class WorkspaceCompoundAdmission {
  #assets;
  #bundles;
  #pages;
  #persistence;

  constructor({ persistence, assets, pages, bundles }) {
    WorkspaceCompoundAdmission.#assertDependencies({ persistence, assets, pages, bundles });
    this.#persistence = persistence;
    this.#assets = assets;
    this.#pages = pages;
    this.#bundles = bundles;
    Object.freeze(this);
  }

  async admit({ operation, maxOperations, retain, install } = {}) {
    if (typeof install !== 'function') {
      throw createCasError(
        'Workspace compound admission requires an installation callback',
        ErrorCodes.INVALID_OPTIONS
      );
    }
    return await withWriteScope(this.#persistence, async (persistence) => {
      const scope = new WorkspaceCompoundScope({
        assets: this.#assets,
        pages: this.#pages,
        bundles: this.#bundles,
        persistence,
        maxOperations,
      });
      const prepared = await scope.execute(operation);
      const selected = retainedArtifacts(prepared, retain);
      const retention = await install(selected, persistence);
      return Object.freeze({ value: prepared.value, retention });
    });
  }

  static #assertDependencies({ persistence, assets, pages, bundles }) {
    const missing = [
      ['persistence', persistence === null || typeof persistence !== 'object'],
      ['assets', assets === null || typeof assets !== 'object'],
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

function retainedArtifacts(prepared, retain) {
  if (retain === undefined) {
    return prepared.staged;
  }
  const requested = selectedInputs(prepared, retain);
  const staged = new Map(prepared.staged.map((artifact) => [artifact.handle.toString(), artifact]));
  const selected = [];
  const seen = new Set();
  for (const input of requested) {
    const handle = selectedHandle(input);
    const key = handle.toString();
    const artifact = staged.get(key);
    if (artifact === undefined) {
      throw createCasError(
        'Workspace compound retention selector returned an unstaged handle',
        ErrorCodes.INVALID_OPTIONS,
        { handle: key }
      );
    }
    if (!seen.has(key)) {
      selected.push(artifact);
      seen.add(key);
    }
  }
  return Object.freeze(selected);
}

function selectedInputs(prepared, retain) {
  if (typeof retain !== 'function') {
    throw createCasError(
      'Workspace compound retention selector must be a function',
      ErrorCodes.INVALID_OPTIONS
    );
  }
  const requested = retain(prepared.value);
  if (!Array.isArray(requested)) {
    throw createCasError(
      'Workspace compound retention selector must synchronously return an array',
      ErrorCodes.INVALID_OPTIONS
    );
  }
  if (requested.length === 0) {
    throw createCasError(
      'Workspace compound retention selector must choose at least one staged handle',
      ErrorCodes.INVALID_OPTIONS
    );
  }
  if (requested.length > prepared.staged.length) {
    throw createCasError(
      'Workspace compound retention selector exceeds the staged handle count',
      ErrorCodes.INVALID_OPTIONS,
      { requestedCount: requested.length, stagedCount: prepared.staged.length }
    );
  }
  return requested;
}

function selectedHandle(input) {
  try {
    return parseApplicationHandle(input);
  } catch (error) {
    throw createCasError(
      'Workspace compound retention selector returned an invalid handle',
      ErrorCodes.INVALID_OPTIONS,
      { originalError: error }
    );
  }
}

async function withWriteScope(persistence, operation) {
  return typeof persistence.withWriteScope === 'function'
    ? await persistence.withWriteScope(operation)
    : await operation(persistence);
}
