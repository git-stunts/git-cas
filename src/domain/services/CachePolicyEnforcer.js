import CachePolicy from '../value-objects/CachePolicy.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import {
  CACHE_ACCOUNTING_VERSION,
  CACHE_METADATA_VERSION,
} from './CacheMetadataCodec.js';

/** Applies expiry and bounded approximate-LRU policy without hydrating an index. */
export default class CachePolicyEnforcer {
  #index;
  #namespace;

  constructor({ index, namespace }) {
    this.#index = index;
    this.#namespace = namespace;
  }

  async enforce(handle, { policy: value, now, protectedDigest = null }) {
    const policy = CachePolicy.from(value);
    let current = handle;
    let changed = false;
    while (current !== null) {
      const scan = await this.#index.scan(current, { now, protectedDigest });
      assertNamespace(scan.state, this.#namespace);
      const removals = selectRemovals(scan, policy);
      const policyChanged = !samePolicy(scan.state.policy, policy);
      if (removals.length === 0 && !policyChanged) {
        return result({ handle: current, scan, policy, changed });
      }
      const removeDigests = new Set(removals.map((candidate) => candidate.digest));
      const projected = await this.#index.scan(current, {
        now,
        protectedDigest,
        excludeDigests: removeDigests,
      });
      const state = createCacheState({
        namespace: this.#namespace,
        policy,
        summary: projected.summary,
        previous: scan.state,
        now,
      });
      current = await this.#index.rewrite({
        handle: current,
        removeDigests,
        replacement: null,
        state,
      });
      changed = true;
    }
    return result({ handle: null, scan: { summary: emptySummary() }, policy, changed });
  }
}

export function createCacheState({ namespace, policy: value, summary, previous, now }) {
  const policy = CachePolicy.from(value);
  return Object.freeze({
    version: CACHE_METADATA_VERSION,
    accountingVersion: CACHE_ACCOUNTING_VERSION,
    namespace,
    policy: Object.freeze(policy.toJSON()),
    entryCount: summary.entryCount,
    logicalBytes: summary.logicalBytes,
    pinnedEntries: summary.pinnedEntries,
    evictableEntries: summary.evictableEntries,
    expiredEntries: summary.expiredEntries,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    oldestAccessedAt: summary.oldestAccessedAt,
    nextExpiry: summary.nextExpiry,
  });
}

function selectRemovals(scan, policy) {
  if (scan.summary.expiredEntries > 0) {
    return scan.expiredCandidates;
  }
  let entryCount = scan.summary.entryCount;
  let logicalBytes = scan.summary.logicalBytes;
  const selected = [];
  for (const candidate of scan.evictionCandidates) {
    if (withinCapacity(entryCount, logicalBytes, policy)) {
      break;
    }
    selected.push(candidate);
    entryCount -= 1;
    logicalBytes -= candidate.logicalBytes;
  }
  return selected;
}

function withinCapacity(entryCount, logicalBytes, policy) {
  return entryCount <= policy.maxEntries &&
    (policy.maxBytes === null || logicalBytes <= policy.maxBytes);
}

export function cachePolicyReport(summary, value) {
  const policy = CachePolicy.from(value);
  return Object.freeze({
    satisfied: withinCapacity(summary.entryCount, summary.logicalBytes, policy),
    entryCount: summary.entryCount,
    logicalBytes: summary.logicalBytes,
    pinnedEntries: summary.pinnedEntries,
    evictableEntries: summary.evictableEntries,
    expiredEntries: summary.expiredEntries,
    limits: Object.freeze(policy.toJSON()),
  });
}

function result({ handle, scan, policy, changed }) {
  return Object.freeze({
    handle,
    scan,
    changed,
    policy: cachePolicyReport(scan.summary, policy),
  });
}

function samePolicy(left, right) {
  return JSON.stringify(left) === JSON.stringify(right.toJSON());
}

function assertNamespace(state, namespace) {
  if (state.namespace !== namespace) {
    throw createCasError(
      'Cache index namespace does not match its ref',
      ErrorCodes.CACHE_STATE_INVALID,
      { expected: namespace, actual: state.namespace },
    );
  }
}

function emptySummary() {
  return Object.freeze({
    entryCount: 0,
    logicalBytes: 0,
    pinnedEntries: 0,
    evictableEntries: 0,
    expiredEntries: 0,
    oldestAccessedAt: null,
    nextExpiry: null,
  });
}
