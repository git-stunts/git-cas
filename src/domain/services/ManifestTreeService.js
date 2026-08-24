import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';

/** Validates manifest-tree requests and retains per-manifest threshold choices. */
export default class ManifestTreeService {
  #repository;
  #thresholds = new WeakMap();

  constructor({ repository }) {
    this.#repository = repository;
  }

  remember(manifest, merkleThreshold) {
    if (merkleThreshold !== undefined) {
      this.#thresholds.set(manifest, merkleThreshold);
    }
  }

  async createTree({ manifest, merkleThreshold }) {
    return await this.#repository.createTree(
      this.#validated({ manifest, merkleThreshold })
    );
  }

  async createTrees(requests) {
    return await this.#repository.createTrees(
      requests.map((request) => this.#validated(request))
    );
  }

  #validated({ manifest, merkleThreshold }) {
    if (
      merkleThreshold !== undefined &&
      (!Number.isSafeInteger(merkleThreshold) || merkleThreshold < 1)
    ) {
      throw createCasError(
        'merkleThreshold must be a positive safe integer',
        ErrorCodes.INVALID_OPTIONS,
        { merkleThreshold },
      );
    }
    return {
      manifest,
      merkleThreshold: merkleThreshold ?? this.#thresholds.get(manifest),
    };
  }
}
