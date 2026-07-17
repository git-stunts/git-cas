import CachePolicy from '../value-objects/CachePolicy.js';
import CacheSetRef from '../value-objects/CacheSetRef.js';
import CollectionNamespace from '../value-objects/CollectionNamespace.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import CacheIndex from './CacheIndex.js';
import CacheAcquisitionRegistry from './CacheAcquisitionRegistry.js';
import CacheSet from './CacheSet.js';
import RootSet from './RootSet.js';
import RootSetMetadataCodec from './RootSetMetadataCodec.js';
import RootSetPersistence from './RootSetPersistence.js';

/** Opens managed CacheSet instances over shared Git and application services. */
export default class CacheSetRegistry {
  constructor(options) {
    CacheSetRegistry.#assertDependencies(options);
    this.persistence = options.persistence;
    this.ref = options.ref;
    this.bundles = options.bundles;
    this.pages = options.pages;
    this.resolveHandle = options.resolveHandle;
    this.crypto = options.crypto;
    this.clock = options.clock;
    this.acquisitions = new CacheAcquisitionRegistry({
      ref: this.ref,
      crypto: this.crypto,
      clock: this.clock,
    });
    Object.freeze(this);
  }

  open({ namespace: value, policy, retry } = {}) {
    const namespace = CollectionNamespace.from(value).toString();
    const ref = CacheSetRef.forNamespace(namespace).toString();
    const metadataCodec = new RootSetMetadataCodec({ refType: CacheSetRef });
    const persistence = new RootSetPersistence({
      rootSetRef: ref,
      persistence: this.persistence,
      ref: this.ref,
      refType: CacheSetRef,
      metadataCodec,
    });
    const rootSet = new RootSet({
      ref,
      persistence,
      retry,
      refType: CacheSetRef,
      metadataCodec,
    });
    return new CacheSet({
      namespace,
      policy: policy === undefined ? undefined : CachePolicy.from(policy),
      rootSet,
      index: new CacheIndex({
        bundles: this.bundles,
        pages: this.pages,
        crypto: this.crypto,
      }),
      resolveHandle: this.resolveHandle,
      acquisitions: this.acquisitions,
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
      ['resolveHandle', typeof value.resolveHandle === 'function'],
      ['crypto', hasMethods(value.crypto, ['sha256'])],
    ];
    const missing = dependencies
      .filter(([, available]) => !available)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw createCasError('CacheSetRegistry requires complete dependencies', ErrorCodes.INVALID_OPTIONS, {
        missing,
      });
    }
  }
}

function hasMethods(target, names) {
  return names.every((name) => typeof target?.[name] === 'function');
}
