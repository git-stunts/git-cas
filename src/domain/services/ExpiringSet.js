import { utf8Encode } from '../encoding/utf8.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import ExpiringMarker from '../value-objects/ExpiringMarker.js';
import ExpiringSetKey from '../value-objects/ExpiringSetKey.js';
import RetentionWitness from '../value-objects/RetentionWitness.js';
import { createExpiringSetState } from './ExpiringSetMetadataCodec.js';
import RootSetMetadataCodec from './RootSetMetadataCodec.js';

const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });
const PRIMARY_DOMAIN = 'git-cas:expiring-set:v1:index\0';
const VERIFICATION_DOMAIN = 'git-cas:expiring-set:v1:verify\0';
const INSPECTION_LIMIT = 1000;

/** RootSet-backed replay marker set with expiry-only release semantics. */
export default class ExpiringSet {
  #clock;
  #crypto;
  #index;
  #namespace;
  #rootSet;

  constructor(options) {
    ExpiringSet.#assertDependencies(options);
    this.#namespace = options.namespace;
    this.#rootSet = options.rootSet;
    this.#index = options.index;
    this.#crypto = options.crypto;
    this.#clock = options.clock ?? DEFAULT_CLOCK;
    this.ref = this.#rootSet.ref;
    Object.freeze(this);
  }

  async contains(keyValue) {
    const key = ExpiringSetKey.from(keyValue).toString();
    const digests = await this.#digests(key);
    const now = this.#now();
    const root = await this.#rootSet.read();
    const handle = this.#index.fromRootEntries(root.entries);
    const marker = await this.#index.getMarker(handle, digests.keyDigest);
    assertVerification(marker, digests);
    return marker !== null && !isExpired(marker.metadata, now);
  }

  async addIfAbsent(keyValue, options) {
    assertAddOptions(options);
    const key = ExpiringSetKey.from(keyValue).toString();
    const expiresAt = normalizeFutureExpiry(options.expiresAt, this.#now());
    const digests = await this.#digests(key);
    const attempt = { observed: null, replacement: null, lifecycle: null };
    const context = { digests, expiresAt, attempt };
    const mutation = await this.#mutateRoot(
      (entries) => this.#admitMarker(entries, context),
    );
    const record = attempt.lifecycle ? attempt.replacement : attempt.observed;
    const observedAt = this.#now();
    const marker = record
      ? this.#marker(record, mutation.commitOid, observedAt)
      : null;
    return Object.freeze({
      changed: mutation.changed,
      admitted: attempt.lifecycle !== null,
      marker,
      generation: mutation.commitOid,
      witness: marker?.evidence ?? null,
    });
  }

  async #admitMarker(entries, context) {
    const { attempt, digests, expiresAt } = context;
    const now = this.#now();
    normalizeFutureExpiry(expiresAt, now);
    attempt.observed = null;
    attempt.replacement = null;
    attempt.lifecycle = null;
    const current = this.#index.fromRootEntries(entries);
    const previous = await this.#index.getMarker(current, digests.keyDigest);
    assertVerification(previous, digests);
    attempt.observed = previous;
    if (previous && !isExpired(previous.metadata, now)) {
      return entries;
    }
    await this.#assertIndexState(current);
    attempt.replacement = await this.#index.stageMarker({
      version: 1,
      keyDigest: digests.keyDigest,
      verificationDigest: digests.verificationDigest,
      expiresAt,
      createdAt: now,
    });
    const scan = await this.#index.scan(current, {
      now,
      excludeDigest: digests.keyDigest,
      replacement: attempt.replacement,
    });
    this.#assertState(scan.state);
    const state = createExpiringSetState({
      namespace: this.#namespace,
      summary: scan.summary,
      previous: scan.state,
      now,
    });
    const handle = await this.#index.rewrite({
      handle: current,
      removeDigest: digests.keyDigest,
      replacement: attempt.replacement,
      state,
    });
    attempt.lifecycle = { handle };
    return [this.#index.toRootEntry(handle)];
  }

  async sweep() {
    let observedAt = null;
    let lifecycle = null;
    let removed = 0;
    const mutation = await this.#mutateRoot(async (entries) => {
      const now = this.#now();
      observedAt = now;
      lifecycle = null;
      removed = 0;
      const current = this.#index.fromRootEntries(entries);
      if (current === null) {
        return entries;
      }
      await this.#assertIndexState(current);
      const scan = await this.#index.scan(current, { now });
      this.#assertState(scan.state);
      if (scan.summary.expiredEntries === 0) {
        return entries;
      }
      removed = scan.summary.expiredEntries;
      const summary = Object.freeze({
        entryCount: scan.summary.liveEntries,
        liveEntries: scan.summary.liveEntries,
        expiredEntries: 0,
        nextExpiry: scan.summary.nextExpiry,
      });
      const state = createExpiringSetState({
        namespace: this.#namespace,
        summary,
        previous: scan.state,
        now,
      });
      const handle = await this.#index.rewrite({
        handle: current,
        removeExpiredAt: now,
        replacement: null,
        state,
      });
      lifecycle = { handle };
      return [this.#index.toRootEntry(handle)];
    });
    return Object.freeze({
      changed: mutation.changed,
      removed,
      generation: mutation.commitOid,
      witness: lifecycle
        ? this.#retentionWitness(lifecycle.handle, mutation.commitOid, observedAt)
        : null,
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
    const page = await this.#inspectMarkers({
      handle,
      generation: root.headOid,
      now,
      limit,
      cursor,
    });
    return Object.freeze({
      namespace: this.#namespace,
      ref: this.ref,
      generation: root.headOid,
      state: Object.freeze({ ...scan.state }),
      observed: scan.summary,
      markers: page.markers,
      nextCursor: page.nextCursor,
    });
  }

  async #inspectMarkers({ handle, generation, now, limit, cursor }) {
    const markers = [];
    for await (const marker of this.#index.markers(handle)) {
      if (cursor === null || marker.metadata.keyDigest > cursor) {
        markers.push(this.#inspectionMarker(marker, generation, now));
      }
      if (markers.length > limit) {
        break;
      }
    }
    const hasMore = markers.length > limit;
    if (hasMore) {
      markers.pop();
    }
    return Object.freeze({
      markers: Object.freeze(markers),
      nextCursor: hasMore ? markers.at(-1).keyDigest : null,
    });
  }

  async doctor() {
    const root = await this.#rootSet.doctor();
    if (!root.healthy) {
      return Object.freeze({
        healthy: false,
        root,
        issues: freezeIssues(root.issues ?? (root.error ? [root.error] : [])),
      });
    }
    try {
      return await this.#doctorHealthyRoot(root);
    } catch (error) {
      return Object.freeze({
        healthy: false,
        root,
        issues: freezeIssues([{
          code: error?.code ?? ErrorCodes.EXPIRING_SET_STATE_INVALID,
          message: error instanceof Error ? error.message : String(error),
        }]),
      });
    }
  }

  async #doctorHealthyRoot(root) {
    const current = await this.#rootSet.read();
    if (current.headOid !== root.headOid) {
      return Object.freeze({
        healthy: false,
        root,
        issues: freezeIssues([{
          code: ErrorCodes.EXPIRING_SET_CONFLICT,
          message: 'ExpiringSet changed while doctor was inspecting it',
          expectedGeneration: root.headOid,
          actualGeneration: current.headOid,
        }]),
      });
    }
    const handle = this.#index.fromRootEntries(current.entries);
    if (handle === null) {
      return Object.freeze({
        healthy: true,
        root,
        state: null,
        observed: emptySummary(),
        issues: Object.freeze([]),
      });
    }
    const persisted = await this.#index.getState(handle);
    this.#assertState(persisted);
    const historical = await this.#index.scan(handle, { now: persisted.updatedAt });
    const expected = createExpiringSetState({
      namespace: this.#namespace,
      summary: historical.summary,
      previous: persisted,
      now: persisted.updatedAt,
    });
    const consistent = JSON.stringify(expected) === JSON.stringify(persisted);
    const observed = (await this.#index.scan(handle, { now: this.#now() })).summary;
    return Object.freeze({
      healthy: consistent,
      root,
      state: Object.freeze({ ...persisted }),
      observed,
      issues: consistent
        ? Object.freeze([])
        : freezeIssues([{ code: ErrorCodes.EXPIRING_SET_STATE_INVALID }]),
    });
  }

  #marker(record, generation, observedAt) {
    const evidence = this.#retentionWitness(record.handle, generation, observedAt);
    return new ExpiringMarker({
      ...record.metadata,
      generation,
      evidence,
    });
  }

  #inspectionMarker(record, generation, observedAt) {
    return Object.freeze({
      keyDigest: record.metadata.keyDigest,
      expiresAt: record.metadata.expiresAt,
      createdAt: record.metadata.createdAt,
      status: isExpired(record.metadata, observedAt) ? 'expired' : 'live',
      evidence: this.#retentionWitness(record.handle, generation, observedAt),
    });
  }

  #retentionWitness(handle, generation, observedAt) {
    return new RetentionWitness({
      handle,
      policy: 'pinned',
      reachability: 'anchored',
      root: {
        kind: 'expiring-set',
        namespace: this.#namespace,
        ref: this.ref,
        generation,
        path: RootSetMetadataCodec.slotFor(0),
      },
      observedAt,
    });
  }

  #assertState(state) {
    if (state !== null && state.namespace !== this.#namespace) {
      throw createCasError(
        'ExpiringSet index namespace does not match its ref',
        ErrorCodes.EXPIRING_SET_STATE_INVALID,
        { expected: this.#namespace, actual: state.namespace },
      );
    }
  }

  async #assertIndexState(handle) {
    if (handle === null) {
      return;
    }
    const persisted = await this.#index.getState(handle);
    this.#assertState(persisted);
    const historical = await this.#index.scan(handle, { now: persisted.updatedAt });
    const expected = createExpiringSetState({
      namespace: this.#namespace,
      summary: historical.summary,
      previous: persisted,
      now: persisted.updatedAt,
    });
    if (JSON.stringify(expected) !== JSON.stringify(persisted)) {
      throw createCasError(
        'ExpiringSet persisted state does not match its marker edges',
        ErrorCodes.EXPIRING_SET_STATE_INVALID,
      );
    }
  }

  async #digests(key) {
    const [keyDigest, verificationDigest] = await Promise.all([
      this.#crypto.sha256(utf8Encode(`${PRIMARY_DOMAIN}${key}`)),
      this.#crypto.sha256(utf8Encode(`${VERIFICATION_DOMAIN}${key}`)),
    ]);
    for (const [name, value] of Object.entries({ keyDigest, verificationDigest })) {
      if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
        throw createCasError(
          'ExpiringSet crypto adapter returned an invalid digest',
          ErrorCodes.INVALID_OPTIONS,
          { [name]: value },
        );
      }
    }
    if (keyDigest === verificationDigest) {
      throw createCasError(
        'ExpiringSet digest domains must produce distinct values',
        ErrorCodes.INVALID_OPTIONS,
        { keyDigest },
      );
    }
    return Object.freeze({ keyDigest, verificationDigest });
  }

  async #mutateRoot(mutator) {
    try {
      return await this.#rootSet.mutate(mutator);
    } catch (error) {
      if (error?.code !== ErrorCodes.ROOT_SET_CONFLICT) {
        throw error;
      }
      throw createCasError(
        'Concurrent ExpiringSet update detected',
        ErrorCodes.EXPIRING_SET_CONFLICT,
        { ref: this.ref, originalError: error },
      );
    }
  }

  #now() {
    const value = this.#clock.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw createCasError('ExpiringSet clock returned an invalid Date', ErrorCodes.INVALID_OPTIONS);
    }
    return value.toISOString();
  }

  static #assertDependencies(options) {
    const dependencies = [
      ['rootSet', options?.rootSet?.mutate],
      ['index', options?.index?.scan],
      ['crypto', options?.crypto?.sha256],
    ];
    const missing = dependencies
      .filter(([, value]) => typeof value !== 'function')
      .map(([name]) => name);
    if (missing.length > 0) {
      throw createCasError(
        'ExpiringSet requires complete lifecycle dependencies',
        ErrorCodes.INVALID_OPTIONS,
        { missing },
      );
    }
  }
}

function assertAddOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw createCasError(
      'ExpiringSet add options must be an object',
      ErrorCodes.EXPIRING_SET_MARKER_INVALID,
    );
  }
  const unknown = Object.keys(options).filter((key) => key !== 'expiresAt');
  if (unknown.length > 0 || !Object.hasOwn(options, 'expiresAt')) {
    throw createCasError(
      'ExpiringSet add options require only expiresAt',
      ErrorCodes.EXPIRING_SET_MARKER_INVALID,
      { unknown },
    );
  }
}

function normalizeFutureExpiry(value, now) {
  const timestamp = value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString()
    : value;
  if (typeof timestamp !== 'string' ||
      Number.isNaN(Date.parse(timestamp)) ||
      new Date(timestamp).toISOString() !== timestamp ||
      timestamp <= now) {
    throw createCasError(
      'ExpiringSet expiry must be a future canonical UTC timestamp',
      ErrorCodes.EXPIRING_SET_MARKER_INVALID,
      { expiresAt: value, now },
    );
  }
  return timestamp;
}

function assertVerification(marker, digests) {
  if (marker && marker.metadata.verificationDigest !== digests.verificationDigest) {
    throw createCasError(
      'ExpiringSet key digest collision detected',
      ErrorCodes.EXPIRING_SET_MARKER_INVALID,
      { keyDigest: digests.keyDigest },
    );
  }
}

function isExpired(marker, now) {
  return marker.expiresAt <= now;
}

function assertInspectOptions(limit, cursor) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > INSPECTION_LIMIT) {
    throw createCasError(
      `ExpiringSet inspection limit must be between 1 and ${INSPECTION_LIMIT}`,
      ErrorCodes.INVALID_OPTIONS,
    );
  }
  if (cursor !== null && !/^[0-9a-f]{64}$/.test(cursor)) {
    throw createCasError('ExpiringSet inspection cursor is invalid', ErrorCodes.INVALID_OPTIONS);
  }
}

function emptyInspection(namespace, ref) {
  return Object.freeze({
    namespace,
    ref,
    generation: null,
    state: null,
    observed: emptySummary(),
    markers: Object.freeze([]),
    nextCursor: null,
  });
}

function emptySummary() {
  return Object.freeze({
    entryCount: 0,
    liveEntries: 0,
    expiredEntries: 0,
    nextExpiry: null,
  });
}

function freezeIssues(issues) {
  return Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
}
