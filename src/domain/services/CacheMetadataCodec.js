import { utf8Decode, utf8Encode } from '../encoding/utf8.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import assertCanonicalTimestamp from '../helpers/assertCanonicalTimestamp.js';
import parseApplicationHandle from '../value-objects/ApplicationHandle.js';
import CacheKey from '../value-objects/CacheKey.js';
import CachePolicy from '../value-objects/CachePolicy.js';
import CollectionNamespace from '../value-objects/CollectionNamespace.js';

export const CACHE_ACCOUNTING_VERSION = 1;
export const CACHE_METADATA_VERSION = 1;
const DIGEST = /^[0-9a-f]{64}$/;
const RETENTION = Object.freeze(['pinned', 'evictable']);

/** Canonical JSON codecs for immutable CacheSet pages. */
export default class CacheMetadataCodec {
  encodeEntry(value) {
    return encode(this.normalizeEntry(value));
  }

  decodeEntry(bytes) {
    return decodeCanonical(bytes, (value) => this.normalizeEntry(value), 'entry');
  }

  normalizeEntry(value) {
    assertObject(value, 'entry');
    const key = CacheKey.from(value.key).toString();
    const handle = parseApplicationHandle(value.handle).toString();
    assertDigest(value.keyDigest);
    assertRetention(value.policy);
    assertTimestamp(value.expiresAt, true, 'entry');
    assertTimestamp(value.createdAt, false, 'entry');
    assertTimestamp(value.accessedAt, false, 'entry');
    assertCount(value.logicalBytes, 'logicalBytes', 'entry');
    assertVersion(value, 'entry');
    return Object.freeze({
      version: CACHE_METADATA_VERSION,
      accountingVersion: CACHE_ACCOUNTING_VERSION,
      key,
      keyDigest: value.keyDigest,
      handle,
      policy: value.policy,
      expiresAt: value.expiresAt,
      logicalBytes: value.logicalBytes,
      createdAt: value.createdAt,
      accessedAt: value.accessedAt,
    });
  }

  encodeState(value) {
    return encode(this.normalizeState(value));
  }

  decodeState(bytes) {
    return decodeCanonical(bytes, (value) => this.normalizeState(value), 'state');
  }

  normalizeState(value) {
    assertObject(value, 'state');
    assertVersion(value, 'state');
    const state = {
      version: CACHE_METADATA_VERSION,
      accountingVersion: CACHE_ACCOUNTING_VERSION,
      namespace: CollectionNamespace.from(value.namespace).toString(),
      policy: Object.freeze(CachePolicy.from(value.policy).toJSON()),
      entryCount: count(value, 'entryCount'),
      logicalBytes: count(value, 'logicalBytes'),
      pinnedEntries: count(value, 'pinnedEntries'),
      evictableEntries: count(value, 'evictableEntries'),
      expiredEntries: count(value, 'expiredEntries'),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      oldestAccessedAt: value.oldestAccessedAt,
      nextExpiry: value.nextExpiry,
    };
    assertStateTimestamps(state);
    assertStateCounts(state);
    return Object.freeze(state);
  }
}

function encode(value) {
  return utf8Encode(JSON.stringify(value, null, 2));
}

function decodeCanonical(bytes, normalize, kind) {
  let value;
  try {
    value = JSON.parse(utf8Decode(bytes));
  } catch (error) {
    throw invalid(kind, `Cache ${kind} metadata is not valid JSON`, { originalError: error });
  }
  const canonical = normalize(value);
  if (utf8Decode(bytes) !== utf8Decode(encode(canonical))) {
    throw invalid(kind, `Cache ${kind} metadata is not canonical`, { value });
  }
  return canonical;
}

function assertObject(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(kind, `Cache ${kind} metadata must be an object`, { value });
  }
}

function assertVersion(value, kind) {
  if (value.version !== CACHE_METADATA_VERSION || value.accountingVersion !== CACHE_ACCOUNTING_VERSION) {
    throw invalid(kind, `Cache ${kind} metadata version is unsupported`, { value });
  }
}

function assertDigest(value) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw invalid('entry', 'Cache entry key digest is invalid', { keyDigest: value });
  }
}

function assertRetention(value) {
  if (!RETENTION.includes(value)) {
    throw invalid('entry', 'Cache entry policy must be pinned or evictable', { policy: value });
  }
}

function assertTimestamp(value, nullable, kind) {
  if (nullable && value === null) {
    return;
  }
  assertCanonicalTimestamp(value, {
    invalid: (message, meta) => invalid(kind, message, meta),
    message: `Cache ${kind} timestamp must be canonical UTC`,
  });
}

function assertStateTimestamps(state) {
  assertTimestamp(state.createdAt, false, 'state');
  assertTimestamp(state.updatedAt, false, 'state');
  assertTimestamp(state.oldestAccessedAt, true, 'state');
  assertTimestamp(state.nextExpiry, true, 'state');
}

function assertCount(value, name, kind) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalid(kind, `Cache ${kind} ${name} must be a non-negative safe integer`, {
      [name]: value,
    });
  }
}

function count(value, name) {
  assertCount(value[name], name, 'state');
  return value[name];
}

function assertStateCounts(state) {
  if (state.pinnedEntries + state.evictableEntries !== state.entryCount ||
      state.expiredEntries > state.entryCount) {
    throw invalid('state', 'Cache state counts are inconsistent', { state });
  }
}

function invalid(kind, message, meta) {
  const code = kind === 'entry' ? ErrorCodes.CACHE_ENTRY_INVALID : ErrorCodes.CACHE_STATE_INVALID;
  return createCasError(message, code, meta);
}
