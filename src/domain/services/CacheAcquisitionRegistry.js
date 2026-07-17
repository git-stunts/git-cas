import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import CacheAcquisition from '../value-objects/CacheAcquisition.js';
import CacheAcquisitionRef from '../value-objects/CacheAcquisitionRef.js';
import CollectionNamespace from '../value-objects/CollectionNamespace.js';
import Oid from '../value-objects/Oid.js';
import RetentionWitness from '../value-objects/RetentionWitness.js';
import RootSetMetadataCodec from './RootSetMetadataCodec.js';

const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });

/** Creates and releases git-cas-managed cache-generation anchors. */
export default class CacheAcquisitionRegistry {
  constructor({ ref, crypto, clock = DEFAULT_CLOCK }) {
    this.ref = ref;
    this.crypto = crypto;
    this.clock = clock;
    Object.freeze(this);
  }

  async acquire({ namespace, cacheRef, keyDigest, generation, hit }) {
    this.#assertAcquireCapabilities();
    const acquiredAt = this.#now();
    const acquisitionRef = CacheAcquisitionRef.create({
      namespace,
      keyDigest,
      acquiredAt,
      nonce: bytesToHex(await this.crypto.randomBytes(16)),
    });
    const anchored = await this.ref.anchorRef({
      sourceRef: cacheRef,
      expectedSourceOid: generation,
      targetRef: acquisitionRef.toString(),
    });
    if (!anchored) {
      throw createCasError(
        'Cache generation changed before it could be acquired',
        ErrorCodes.CACHE_ACQUISITION_CONFLICT,
        { cacheRef, generation },
      );
    }
    const evidence = new RetentionWitness({
      handle: hit.handle,
      policy: 'pinned',
      reachability: 'anchored',
      root: {
        kind: 'cache-set',
        namespace,
        ref: acquisitionRef.toString(),
        generation,
        path: RootSetMetadataCodec.slotFor(0),
      },
      observedAt: acquiredAt,
    });
    return new CacheAcquisition({
      id: acquisitionRef.id,
      hit,
      evidence,
      acquiredAt,
      release: () => this.release({
        namespace,
        id: acquisitionRef.id,
        expectedGeneration: generation,
      }),
    });
  }

  async inspect({ namespace: value, limit = 100 }) {
    assertMethod(
      this.ref,
      'iterateRefs',
      'Cache acquisition inspection requires ref iteration',
    );
    const namespace = CollectionNamespace.from(value).toString();
    assertInspectionLimit(limit);
    const prefix = CacheAcquisitionRef.prefixForNamespace(namespace);
    const entries = [];
    for await (const record of this.ref.iterateRefs({ prefix, limit: limit + 1 })) {
      if (record.symref !== null) {
        throw invalid('Symbolic cache acquisition refs are unsafe', {
          ref: record.ref,
          symref: record.symref,
        });
      }
      const acquisitionRef = CacheAcquisitionRef.from(record.ref);
      if (acquisitionRef.namespace !== namespace) {
        throw invalid('Cache acquisition iterator escaped its requested namespace', {
          namespace,
          ref: record.ref,
        });
      }
      entries.push(Object.freeze({
        id: acquisitionRef.id,
        generation: Oid.from(record.oid).toString(),
        acquiredAt: acquisitionRef.acquiredAt,
        keyDigest: acquisitionRef.keyDigest,
      }));
      if (entries.length > limit) {
        break;
      }
    }
    const truncated = entries.length > limit;
    if (truncated) {
      entries.pop();
    }
    return Object.freeze({
      namespace,
      entries: Object.freeze(entries),
      truncated,
    });
  }

  async release({ namespace, id, expectedGeneration }) {
    assertMethod(
      this.ref,
      'deleteRef',
      'Cache acquisition release requires checked ref deletion',
    );
    const acquisitionRef = CacheAcquisitionRef.forId({ namespace, id });
    const generation = Oid.from(expectedGeneration).toString();
    let changed;
    try {
      changed = await this.ref.deleteRef({
        ref: acquisitionRef.toString(),
        expectedOldOid: generation,
      });
    } catch (error) {
      if (error?.code !== ErrorCodes.GIT_REF_CONFLICT) {
        throw error;
      }
      throw createCasError(
        'Cache acquisition release could not prove the expected direct generation',
        ErrorCodes.CACHE_ACQUISITION_RELEASE_CONFLICT,
        { id: acquisitionRef.id, generation, originalError: error },
      );
    }
    return Object.freeze({
      id: acquisitionRef.id,
      generation,
      changed,
      releasedAt: this.#now(),
    });
  }

  #now() {
    const value = this.clock.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw invalid('Cache acquisition clock returned an invalid Date');
    }
    return value.toISOString();
  }

  #assertAcquireCapabilities() {
    assertMethod(
      this.ref,
      'anchorRef',
      'Cache acquisition requires atomic ref anchoring',
    );
    assertMethod(
      this.crypto,
      'randomBytes',
      'Cache acquisition requires random bytes',
    );
  }
}

function assertInspectionLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw invalid('Cache acquisition inspection limit must be between 1 and 1000', { limit });
  }
}

function bytesToHex(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw invalid('Cache acquisition random source returned invalid bytes');
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function invalid(message, meta) {
  return createCasError(message, ErrorCodes.CACHE_ACQUISITION_INVALID, meta);
}

function assertMethod(target, name, message) {
  if (typeof target?.[name] !== 'function') {
    throw invalid(message, { capability: name });
  }
}
