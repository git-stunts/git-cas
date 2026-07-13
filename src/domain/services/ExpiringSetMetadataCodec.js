import { utf8Decode, utf8Encode } from '../encoding/utf8.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import assertCanonicalTimestamp from '../helpers/assertCanonicalTimestamp.js';
import CollectionNamespace from '../value-objects/CollectionNamespace.js';

export const EXPIRING_SET_METADATA_VERSION = 1;
const DIGEST = /^[0-9a-f]{64}$/;

/** Canonical JSON codecs for immutable ExpiringSet pages. */
export default class ExpiringSetMetadataCodec {
  encodeMarker(value) {
    return encode(this.normalizeMarker(value));
  }

  decodeMarker(bytes) {
    return decodeCanonical(bytes, (value) => this.normalizeMarker(value), 'marker');
  }

  normalizeMarker(value) {
    assertObject(value, 'marker');
    assertVersion(value, 'marker');
    assertDigest(value.keyDigest, 'keyDigest');
    assertDigest(value.verificationDigest, 'verificationDigest');
    assertTimestamp(value.createdAt, false, 'marker');
    assertTimestamp(value.expiresAt, false, 'marker');
    if (value.expiresAt <= value.createdAt) {
      throw invalid('marker', 'Expiring marker expiry must follow its creation time', {
        createdAt: value.createdAt,
        expiresAt: value.expiresAt,
      });
    }
    return Object.freeze({
      version: EXPIRING_SET_METADATA_VERSION,
      keyDigest: value.keyDigest,
      verificationDigest: value.verificationDigest,
      expiresAt: value.expiresAt,
      createdAt: value.createdAt,
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
      version: EXPIRING_SET_METADATA_VERSION,
      namespace: CollectionNamespace.from(value.namespace).toString(),
      entryCount: count(value, 'entryCount'),
      liveEntries: count(value, 'liveEntries'),
      expiredEntries: count(value, 'expiredEntries'),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      nextExpiry: value.nextExpiry,
    };
    assertTimestamp(state.createdAt, false, 'state');
    assertTimestamp(state.updatedAt, false, 'state');
    assertTimestamp(state.nextExpiry, true, 'state');
    if (state.liveEntries + state.expiredEntries !== state.entryCount) {
      throw invalid('state', 'ExpiringSet state counts are inconsistent', { state });
    }
    if ((state.liveEntries === 0) !== (state.nextExpiry === null)) {
      throw invalid('state', 'ExpiringSet next expiry does not match its live count', { state });
    }
    if (state.nextExpiry !== null && state.nextExpiry <= state.updatedAt) {
      throw invalid('state', 'ExpiringSet next expiry must follow its evaluation time', { state });
    }
    return Object.freeze(state);
  }
}

export function createExpiringSetState({ namespace, summary, previous, now }) {
  return Object.freeze({
    version: EXPIRING_SET_METADATA_VERSION,
    namespace: CollectionNamespace.from(namespace).toString(),
    entryCount: summary.entryCount,
    liveEntries: summary.liveEntries,
    expiredEntries: summary.expiredEntries,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    nextExpiry: summary.nextExpiry,
  });
}

function encode(value) {
  return utf8Encode(JSON.stringify(value, null, 2));
}

function decodeCanonical(bytes, normalize, kind) {
  let value;
  try {
    value = JSON.parse(utf8Decode(bytes));
  } catch (error) {
    throw invalid(kind, `ExpiringSet ${kind} metadata is not valid JSON`, {
      originalError: error,
    });
  }
  const canonical = normalize(value);
  if (utf8Decode(bytes) !== utf8Decode(encode(canonical))) {
    throw invalid(kind, `ExpiringSet ${kind} metadata is not canonical`, { value });
  }
  return canonical;
}

function assertObject(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(kind, `ExpiringSet ${kind} metadata must be an object`, { value });
  }
}

function assertVersion(value, kind) {
  if (value.version !== EXPIRING_SET_METADATA_VERSION) {
    throw invalid(kind, `ExpiringSet ${kind} metadata version is unsupported`, { value });
  }
}

function assertDigest(value, name) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw invalid('marker', `Expiring marker ${name} is invalid`, { [name]: value });
  }
}

function assertTimestamp(value, nullable, kind) {
  if (nullable && value === null) {
    return;
  }
  assertCanonicalTimestamp(value, {
    invalid: (message, meta) => invalid(kind, message, meta),
    message: `ExpiringSet ${kind} timestamp must be canonical UTC`,
  });
}

function count(value, name) {
  const result = value[name];
  if (!Number.isSafeInteger(result) || result < 0) {
    throw invalid('state', `ExpiringSet state ${name} must be a non-negative safe integer`, {
      [name]: result,
    });
  }
  return result;
}

function invalid(kind, message, meta) {
  const code = kind === 'marker'
    ? ErrorCodes.EXPIRING_SET_MARKER_INVALID
    : ErrorCodes.EXPIRING_SET_STATE_INVALID;
  return createCasError(message, code, meta);
}
