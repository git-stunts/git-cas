import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import CollectionNamespace from '../value-objects/CollectionNamespace.js';
import ExpiringSetRef from '../value-objects/ExpiringSetRef.js';
import ExpiringSet from './ExpiringSet.js';
import ExpiringSetIndex from './ExpiringSetIndex.js';
import RootSet from './RootSet.js';
import RootSetMetadataCodec from './RootSetMetadataCodec.js';
import RootSetPersistence from './RootSetPersistence.js';

const OPEN_OPTIONS = new Set(['namespace', 'retry']);

/** Opens managed ExpiringSet instances over shared Git and application services. */
export default class ExpiringSetRegistry {
  constructor(options) {
    ExpiringSetRegistry.#assertDependencies(options);
    this.persistence = options.persistence;
    this.ref = options.ref;
    this.bundles = options.bundles;
    this.pages = options.pages;
    this.crypto = options.crypto;
    this.clock = options.clock;
    Object.freeze(this);
  }

  open(options = {}) {
    assertOpenOptions(options);
    const namespace = CollectionNamespace.from(options.namespace).toString();
    const ref = ExpiringSetRef.forNamespace(namespace).toString();
    const metadataCodec = new RootSetMetadataCodec({ refType: ExpiringSetRef });
    const persistence = new RootSetPersistence({
      rootSetRef: ref,
      persistence: this.persistence,
      ref: this.ref,
      refType: ExpiringSetRef,
      metadataCodec,
    });
    const rootSet = new RootSet({
      ref,
      persistence,
      retry: options.retry,
      refType: ExpiringSetRef,
      metadataCodec,
    });
    return new ExpiringSet({
      namespace,
      rootSet,
      index: new ExpiringSetIndex({
        bundles: this.bundles,
        pages: this.pages,
      }),
      crypto: this.crypto,
      clock: this.clock,
    });
  }

  static #assertDependencies(options) {
    const value = options ?? {};
    const dependencies = [
      ['persistence', hasMethods(value.persistence, [
        'writeBlob', 'writeTree', 'readBlob', 'readTree', 'readObjectType',
      ])],
      ['ref', hasMethods(value.ref, [
        'resolveRef', 'resolveTree', 'resolveParents', 'createCommit', 'updateRef',
      ])],
      ['bundles', hasMethods(value.bundles, [
        'putOrderedReferences', 'getMemberReference', 'iterateMemberReferences',
      ])],
      ['pages', hasMethods(value.pages, ['put', 'get'])],
      ['crypto', hasMethods(value.crypto, ['sha256'])],
    ];
    const missing = dependencies
      .filter(([, available]) => !available)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw createCasError(
        'ExpiringSetRegistry requires complete dependencies',
        ErrorCodes.INVALID_OPTIONS,
        { missing },
      );
    }
  }
}

function assertOpenOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw createCasError('ExpiringSet open options must be an object', ErrorCodes.INVALID_OPTIONS);
  }
  const unknown = Object.keys(options).filter((key) => !OPEN_OPTIONS.has(key));
  if (unknown.length > 0) {
    throw createCasError(
      'ExpiringSet does not accept capacity or eviction policy',
      ErrorCodes.INVALID_OPTIONS,
      { unknown },
    );
  }
}

function hasMethods(target, names) {
  return names.every((name) => typeof target?.[name] === 'function');
}
