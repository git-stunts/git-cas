import { utf8Encode } from '../encoding/utf8.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import parseApplicationHandle from '../value-objects/ApplicationHandle.js';
import CacheHit from '../value-objects/CacheHit.js';
import CacheKey from '../value-objects/CacheKey.js';
import CachePolicy, { MAX_CACHE_ENTRIES } from '../value-objects/CachePolicy.js';
import RetentionWitness from '../value-objects/RetentionWitness.js';
import CachePolicyEnforcer, {
  cachePolicyReport,
  createCacheState,
} from './CachePolicyEnforcer.js';
import RootSetMetadataCodec from './RootSetMetadataCodec.js';

const RETENTION = Object.freeze(['pinned', 'evictable']);
const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });

/** RootSet-backed lifecycle manager for application cache handles. */
export default class CacheSet {
  #clock;
  #configuredPolicy;
  #crypto;
  #enforcer;
  #index;
  #namespace;
  #resolveHandle;
  #rootSet;

  constructor(options) {
    CacheSet.#assertDependencies(options);
    this.#namespace = options.namespace;
    this.#rootSet = options.rootSet;
    this.#index = options.index;
    this.#resolveHandle = options.resolveHandle;
    this.#crypto = options.crypto;
    this.#clock = options.clock ?? DEFAULT_CLOCK;
    this.#configuredPolicy = options.policy === undefined ? null : CachePolicy.from(options.policy);
    this.#enforcer = new CachePolicyEnforcer({ index: this.#index, namespace: this.#namespace });
    this.ref = this.#rootSet.ref;
    Object.freeze(this);
  }

  async get(keyValue) {
    const key = CacheKey.from(keyValue).toString();
    const digest = await this.#digest(key);
    const state = await this.#rootSet.read();
    const handle = this.#index.fromRootEntries(state.entries);
    const entry = await this.#index.getEntry(handle, digest);
    const now = this.#now();
    assertNoKeyCollision(entry, key);
    if (!entry || isExpired(entry.metadata, now)) {
      return null;
    }
    const target = await this.#resolveTarget(entry.targetHandle);
    assertLogicalBytes(entry.metadata, target.logicalBytes);
    return this.#hit(entry, state.headOid, now);
  }

  async put(key, handle, options = {}) {
    return await this.#store({ key, handle, options, requireExisting: false });
  }

  async replace(key, handle, options = {}) {
    return await this.#store({ key, handle, options, requireExisting: true });
  }

  async remove(keyValue) {
    const key = CacheKey.from(keyValue).toString();
    const digest = await this.#digest(key);
    const now = this.#now();
    let observed = null;
    let lifecycle = null;
    const mutation = await this.#mutateRoot(async (entries, root) => {
      lifecycle = null;
      const current = this.#index.fromRootEntries(entries);
      const previous = await this.#index.getEntry(current, digest);
      assertNoKeyCollision(previous, key);
      observed = { previous, generation: root.headOid };
      if (!previous) {
        return entries;
      }
      lifecycle = await this.#rewriteRemoval(current, digest, now);
      return [this.#index.toRootEntry(lifecycle.handle)];
    });
    const removed = observed?.previous
      ? this.#hit(observed.previous, observed.generation, now)
      : null;
    return Object.freeze({
      changed: mutation.changed,
      removed,
      generation: mutation.commitOid,
      policy: lifecycle?.policy ?? null,
      witness: lifecycle ? this.#indexWitness(lifecycle.handle, mutation.commitOid, now) : null,
    });
  }

  async sweep() {
    const now = this.#now();
    let lifecycle = null;
    let beforeCount = 0;
    const mutation = await this.#mutateRoot(async (entries) => {
      lifecycle = null;
      beforeCount = 0;
      const current = this.#index.fromRootEntries(entries);
      if (current === null) {
        return entries;
      }
      const scan = await this.#index.scan(current, { now });
      this.#assertState(scan.state);
      beforeCount = scan.summary.entryCount;
      lifecycle = await this.#enforcer.enforce(current, {
        policy: this.#policyFor(scan.state),
        now,
      });
      return [this.#index.toRootEntry(lifecycle.handle)];
    });
    return Object.freeze({
      changed: mutation.changed,
      removed: lifecycle ? beforeCount - lifecycle.scan.summary.entryCount : 0,
      generation: mutation.commitOid,
      policy: lifecycle?.policy ?? null,
      witness: lifecycle ? this.#indexWitness(lifecycle.handle, mutation.commitOid, now) : null,
    });
  }

  async touch(keyValue) {
    const key = CacheKey.from(keyValue).toString();
    const digest = await this.#digest(key);
    const now = this.#now();
    let observed = null;
    let lifecycle = null;
    const mutation = await this.#mutateRoot(async (entries, root) => {
      lifecycle = null;
      const current = this.#index.fromRootEntries(entries);
      const previous = await this.#index.getEntry(current, digest);
      assertNoKeyCollision(previous, key);
      observed = { previous, generation: root.headOid };
      if (!previous || isExpired(previous.metadata, now)) {
        observed = { previous: null, generation: root.headOid };
        return entries;
      }
      const state = await this.#index.getState(current);
      const policy = this.#policyFor(state);
      if (!touchIsDue(previous.metadata, now, policy.accessResolutionMs)) {
        return entries;
      }
      const replacement = await this.#index.stageEntry({
        ...previous.metadata,
        accessedAt: now,
      });
      lifecycle = await this.#rewriteReplacement(current, replacement, now);
      observed = {
        previous: { metadata: replacement.metadata, targetHandle: previous.targetHandle },
        generation: root.headOid,
      };
      return [this.#index.toRootEntry(lifecycle.handle)];
    });
    const hit = observed?.previous
      ? this.#hit(observed.previous, mutation.commitOid, now)
      : null;
    return Object.freeze({
      changed: mutation.changed,
      hit,
      generation: mutation.commitOid,
      policy: lifecycle?.policy ?? null,
      witness: hit?.evidence ?? null,
    });
  }

  async inspect({ limit = 100, cursor = null } = {}) {
    assertInspectOptions(limit, cursor);
    const now = this.#now();
    const root = await this.#rootSet.read();
    const handle = this.#index.fromRootEntries(root.entries);
    if (handle === null) {
      return emptyInspection(this.#namespace, this.ref);
    }
    const scan = await this.#index.scan(handle, { now });
    this.#assertState(scan.state);
    const entries = [];
    for await (const entry of this.#index.entries(handle)) {
      if (isAfterCursor(entry.metadata.keyDigest, cursor)) {
        entries.push(Object.freeze({ ...entry.metadata }));
      }
      if (entries.length > limit) {
        break;
      }
    }
    const hasMore = entries.length > limit;
    if (hasMore) {
      entries.pop();
    }
    return Object.freeze({
      namespace: this.#namespace,
      ref: this.ref,
      generation: root.headOid,
      state: Object.freeze({ ...scan.state }),
      observed: scan.summary,
      policy: cachePolicyReport(scan.summary, this.#policyFor(scan.state)),
      entries: Object.freeze(entries),
      nextCursor: hasMore ? entries.at(-1).keyDigest : null,
    });
  }

  async doctor() {
    const root = await this.#rootSet.doctor();
    if (!root.healthy) {
      return Object.freeze({
        healthy: false,
        root,
        issues: root.issues ?? (root.error ? [root.error] : []),
      });
    }
    try {
      const state = await this.#rootSet.read();
      const handle = this.#index.fromRootEntries(state.entries);
      if (handle === null) {
        return Object.freeze({ healthy: true, root, issues: [] });
      }
      const persisted = await this.#index.getState(handle);
      this.#assertState(persisted);
      const scan = await this.#index.scan(handle, { now: persisted.updatedAt });
      await this.#validateTargetAccounting(handle);
      const expected = createCacheState({
        namespace: this.#namespace,
        policy: CachePolicy.from(persisted.policy),
        summary: scan.summary,
        previous: persisted,
        now: persisted.updatedAt,
      });
      const consistent = JSON.stringify(expected) === JSON.stringify(persisted);
      return Object.freeze({
        healthy: consistent,
        root,
        state: Object.freeze({ ...persisted }),
        observed: scan.summary,
        policy: cachePolicyReport(scan.summary, persisted.policy),
        issues: consistent ? [] : [{ code: ErrorCodes.CACHE_STATE_INVALID }],
      });
    } catch (error) {
      return Object.freeze({
        healthy: false,
        root,
        issues: [{
          code: error?.code ?? ErrorCodes.CACHE_STATE_INVALID,
          message: error instanceof Error ? error.message : String(error),
        }],
      });
    }
  }

  async repair({ entries, policy: value } = {}) {
    const now = this.#now();
    const policy = value === undefined
      ? this.#configuredPolicy ?? new CachePolicy()
      : CachePolicy.from(value);
    const staged = await this.#stageRepairEntries(entries, now);
    const summary = summarizeStaged(staged, now);
    const state = createCacheState({
      namespace: this.#namespace,
      policy,
      summary,
      previous: null,
      now,
    });
    const built = await this.#index.build({ entries: staged, state });
    const lifecycle = await this.#enforcer.enforce(built, { policy, now });
    const repaired = await this.#repairRoot({
      entries: [this.#index.toRootEntry(lifecycle.handle)],
    });
    return Object.freeze({
      repaired: true,
      generation: repaired.commitOid,
      policy: lifecycle.policy,
      witness: this.#indexWitness(lifecycle.handle, repaired.commitOid, now),
    });
  }

  async #stageRepairEntries(entries, now) {
    if (!isIterable(entries)) {
      throw createCasError('Cache repair entries must be iterable', ErrorCodes.CACHE_ENTRY_INVALID);
    }
    const byDigest = new Map();
    for await (const entry of entries) {
      const key = CacheKey.from(entry.key).toString();
      const digest = await this.#digest(key);
      const previous = byDigest.get(digest);
      if (previous) {
        const message = previous.metadata.key === key
          ? 'Cache repair contains a duplicate key'
          : 'Cache repair contains a key digest collision';
        throw createCasError(message, ErrorCodes.CACHE_ENTRY_INVALID);
      }
      if (byDigest.size >= MAX_CACHE_ENTRIES) {
        throw createCasError('Cache repair exceeds the entry limit', ErrorCodes.CACHE_POLICY_INVALID);
      }
      const staged = await this.#prepareEntry({
        key,
        digest,
        handle: entry.handle,
        options: entry,
        now,
      });
      byDigest.set(digest, staged);
    }
    return [...byDigest.values()].sort((left, right) => (
      left.metadata.keyDigest < right.metadata.keyDigest ? -1 : 1
    ));
  }

  async #store({ key: keyValue, handle, options, requireExisting }) {
    assertEntryOptions(options);
    const key = CacheKey.from(keyValue).toString();
    const digest = await this.#digest(key);
    const now = this.#now();
    assertFutureExpiry(options.expiresAt, now);
    const target = await this.#resolveTarget(handle);
    let replacement = null;
    let observed = null;
    let lifecycle = null;
    const expectedHandle = normalizeExpectedHandle(options.expectedHandle);
    const mutation = await this.#mutateRoot(async (entries, root) => {
      lifecycle = null;
      replacement = null;
      const current = this.#index.fromRootEntries(entries);
      const previous = await this.#index.getEntry(current, digest);
      observed = { previous, generation: root.headOid };
      assertNoKeyCollision(previous, key);
      if (!canReplace({ previous, key, expectedHandle, requireExisting })) {
        return entries;
      }
      replacement = await this.#stageEntry({ key, digest, target, options, now });
      lifecycle = await this.#rewriteReplacement(current, replacement, now);
      return [this.#index.toRootEntry(lifecycle.handle)];
    });
    return this.#storeResult({ mutation, observed, lifecycle, replacement, now });
  }

  async #prepareEntry({ key, digest, handle: value, options, now }) {
    const target = await this.#resolveTarget(value);
    return await this.#stageEntry({ key, digest, target, options, now });
  }

  async #resolveTarget(value) {
    const handle = parseApplicationHandle(value);
    const resolved = await this.#resolveHandle(handle);
    const logicalBytes = resolved.logicalBytes ?? resolved.size;
    if (!Number.isSafeInteger(logicalBytes) || logicalBytes < 0) {
      throw createCasError(
        'Cache target has no deterministic logical size',
        ErrorCodes.CACHE_LOGICAL_SIZE_UNKNOWN,
        { handle: handle.toString(), logicalBytes },
      );
    }
    return Object.freeze({ handle, logicalBytes });
  }

  async #validateTargetAccounting(handle) {
    for await (const entry of this.#index.entries(handle)) {
      const target = await this.#resolveTarget(entry.targetHandle);
      assertLogicalBytes(entry.metadata, target.logicalBytes);
    }
  }

  async #stageEntry({ key, digest, target, options, now }) {
    const policy = options.retention ?? 'evictable';
    if (!RETENTION.includes(policy)) {
      throw createCasError('Cache retention must be pinned or evictable', ErrorCodes.CACHE_ENTRY_INVALID);
    }
    return await this.#index.stageEntry({
      version: 1,
      accountingVersion: 1,
      key,
      keyDigest: digest,
      handle: target.handle,
      policy,
      expiresAt: normalizeExpiry(options.expiresAt),
      logicalBytes: target.logicalBytes,
      createdAt: normalizeDate(options.createdAt, now),
      accessedAt: normalizeDate(options.accessedAt, now),
    });
  }

  async #rewriteReplacement(current, replacement, now) {
    const removeDigests = new Set([replacement.metadata.keyDigest]);
    const projected = await this.#index.scan(current, {
      now,
      protectedDigest: replacement.metadata.keyDigest,
      excludeDigests: removeDigests,
      replacement,
    });
    this.#assertState(projected.state);
    const policy = this.#policyFor(projected.state);
    const state = createCacheState({
      namespace: this.#namespace,
      policy,
      summary: projected.summary,
      previous: projected.state,
      now,
    });
    const provisional = await this.#index.rewrite({
      handle: current,
      removeDigests,
      replacement,
      state,
    });
    return await this.#enforcer.enforce(provisional, {
      policy,
      now,
      protectedDigest: replacement.metadata.keyDigest,
    });
  }

  async #rewriteRemoval(current, digest, now) {
    const currentScan = await this.#index.scan(current, { now });
    this.#assertState(currentScan.state);
    const policy = this.#policyFor(currentScan.state);
    const removeDigests = new Set([digest]);
    const projected = await this.#index.scan(current, { now, excludeDigests: removeDigests });
    const state = createCacheState({
      namespace: this.#namespace,
      policy,
      summary: projected.summary,
      previous: currentScan.state,
      now,
    });
    const provisional = await this.#index.rewrite({
      handle: current,
      removeDigests,
      replacement: null,
      state,
    });
    return await this.#enforcer.enforce(provisional, { policy, now });
  }

  #storeResult({ mutation, observed, lifecycle, replacement, now }) {
    const previous = observed?.previous
      ? this.#hit(observed.previous, observed.generation, now)
      : null;
    const accepted = lifecycle !== null;
    const record = accepted
      ? { metadata: replacement.metadata, targetHandle: parseApplicationHandle(replacement.metadata.handle) }
      : observed?.previous;
    const hit = record ? this.#hit(record, mutation.commitOid, now) : null;
    return Object.freeze({
      changed: mutation.changed,
      accepted,
      hit,
      previous,
      generation: mutation.commitOid,
      policy: lifecycle?.policy ?? null,
      witness: hit?.evidence ?? null,
    });
  }

  async #mutateRoot(mutator) {
    try {
      return await this.#rootSet.mutate(mutator);
    } catch (error) {
      throw mapConflict(error, this.ref);
    }
  }

  async #repairRoot(options) {
    try {
      return await this.#rootSet.repair(options);
    } catch (error) {
      throw mapConflict(error, this.ref);
    }
  }

  #hit(entry, generation, observedAt) {
    const evidence = new RetentionWitness({
      handle: entry.targetHandle,
      policy: entry.metadata.policy,
      reachability: 'anchored',
      root: {
        kind: 'cache-set',
        namespace: this.#namespace,
        ref: this.ref,
        generation,
        path: RootSetMetadataCodec.slotFor(0),
      },
      observedAt,
    });
    return new CacheHit({ ...entry.metadata, generation, evidence });
  }

  #indexWitness(handle, generation, observedAt) {
    return new RetentionWitness({
      handle,
      policy: 'pinned',
      reachability: 'anchored',
      root: {
        kind: 'cache-set',
        namespace: this.#namespace,
        ref: this.ref,
        generation,
        path: RootSetMetadataCodec.slotFor(0),
      },
      observedAt,
    });
  }

  #policyFor(state) {
    return this.#configuredPolicy ?? CachePolicy.from(state?.policy);
  }

  #assertState(state) {
    if (state !== null && state.namespace !== this.#namespace) {
      throw createCasError('Cache index namespace does not match its ref', ErrorCodes.CACHE_STATE_INVALID, {
        expected: this.#namespace,
        actual: state.namespace,
      });
    }
  }

  async #digest(key) {
    const digest = await this.#crypto.sha256(utf8Encode(key));
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
      throw createCasError('Cache crypto adapter returned an invalid digest', ErrorCodes.INVALID_OPTIONS);
    }
    return digest;
  }

  #now() {
    const value = this.#clock.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw createCasError('CacheSet clock returned an invalid Date', ErrorCodes.INVALID_OPTIONS);
    }
    return value.toISOString();
  }

  static #assertDependencies(options) {
    const dependencies = [
      ['rootSet', options?.rootSet?.mutate],
      ['index', options?.index?.scan],
      ['resolveHandle', options?.resolveHandle],
      ['crypto', options?.crypto?.sha256],
    ];
    const missing = dependencies
      .filter(([, value]) => typeof value !== 'function')
      .map(([name]) => name);
    if (missing.length > 0) {
      throw createCasError('CacheSet requires complete lifecycle dependencies', ErrorCodes.INVALID_OPTIONS, {
        missing,
      });
    }
  }
}

function canReplace({ previous, key, expectedHandle, requireExisting }) {
  if (!previous || previous.metadata.key !== key) {
    return !requireExisting && expectedHandle === null;
  }
  return expectedHandle === null || previous.targetHandle.toString() === expectedHandle;
}

function normalizeExpectedHandle(value) {
  return value === undefined ? null : parseApplicationHandle(value).toString();
}

function normalizeExpiry(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeDate(value, null);
}

function normalizeDate(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw createCasError('Cache timestamp is invalid', ErrorCodes.CACHE_ENTRY_INVALID);
    }
    return value.toISOString();
  }
  return value;
}

function isExpired(entry, now) {
  return entry.expiresAt !== null && entry.expiresAt <= now;
}

function touchIsDue(entry, now, resolutionMs) {
  return Date.parse(now) - Date.parse(entry.accessedAt) >= resolutionMs;
}

function assertInspectOptions(limit, cursor) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw createCasError('Cache inspection limit must be between 1 and 1000', ErrorCodes.INVALID_OPTIONS);
  }
  if (cursor !== null && !/^[0-9a-f]{64}$/.test(cursor)) {
    throw createCasError('Cache inspection cursor is invalid', ErrorCodes.INVALID_OPTIONS);
  }
}

function emptyInspection(namespace, ref) {
  return Object.freeze({
    namespace,
    ref,
    generation: null,
    state: null,
    observed: null,
    policy: null,
    entries: Object.freeze([]),
    nextCursor: null,
  });
}

function summarizeStaged(entries, now) {
  const summary = {
    entryCount: entries.length,
    logicalBytes: 0,
    pinnedEntries: 0,
    evictableEntries: 0,
    expiredEntries: 0,
    oldestAccessedAt: null,
    nextExpiry: null,
  };
  for (const entry of entries) {
    addStagedSummary(summary, entry.metadata, now);
  }
  return Object.freeze(summary);
}

function addStagedSummary(summary, entry, now) {
  const logicalBytes = summary.logicalBytes + entry.logicalBytes;
  if (!Number.isSafeInteger(logicalBytes)) {
    throw createCasError('Cache logical size exceeds safe integer accounting', ErrorCodes.CACHE_LOGICAL_SIZE_UNKNOWN);
  }
  summary.logicalBytes = logicalBytes;
  summary[`${entry.policy}Entries`] += 1;
  summary.expiredEntries += isExpired(entry, now) ? 1 : 0;
  summary.oldestAccessedAt = minTimestamp(summary.oldestAccessedAt, entry.accessedAt);
  summary.nextExpiry = minTimestamp(summary.nextExpiry, entry.expiresAt);
}

function minTimestamp(left, right) {
  if (right === null) {
    return left;
  }
  return left === null || right < left ? right : left;
}

function assertEntryOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw createCasError('Cache entry options must be an object', ErrorCodes.CACHE_ENTRY_INVALID);
  }
}

function assertFutureExpiry(value, now) {
  if (value === undefined || value === null) {
    return;
  }
  const timestamp = normalizeDate(value, now);
  if (Number.isNaN(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
    throw createCasError('Cache expiry must be a canonical UTC timestamp', ErrorCodes.CACHE_ENTRY_INVALID);
  }
  if (timestamp <= now) {
    throw createCasError('Cache expiry must be later than the write time', ErrorCodes.CACHE_ENTRY_INVALID);
  }
}

function assertNoKeyCollision(previous, key) {
  if (previous && previous.metadata.key !== key) {
    throw createCasError('Cache key digest collision detected', ErrorCodes.CACHE_ENTRY_INVALID, {
      expectedKey: key,
      actualKey: previous.metadata.key,
    });
  }
}

function assertLogicalBytes(metadata, logicalBytes) {
  if (metadata.logicalBytes !== logicalBytes) {
    throw createCasError(
      'Cache entry logical size does not match its target',
      ErrorCodes.CACHE_ENTRY_INVALID,
      { handle: metadata.handle, expected: metadata.logicalBytes, actual: logicalBytes },
    );
  }
}

function isIterable(value) {
  return Boolean(value?.[Symbol.iterator] || value?.[Symbol.asyncIterator]);
}

function isAfterCursor(digest, cursor) {
  return cursor === null || digest > cursor;
}

function mapConflict(error, ref) {
  if (error?.code !== ErrorCodes.ROOT_SET_CONFLICT) {
    return error;
  }
  return createCasError('Concurrent CacheSet update detected', ErrorCodes.CACHE_CONFLICT, {
    ref,
    originalError: error,
  });
}
