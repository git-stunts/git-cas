import CasError from '../errors/CasError.js';
import { ErrorCodes } from '../errors/index.js';
import { utf8Decode, utf8Encode } from '../encoding/utf8.js';
import Oid from '../value-objects/Oid.js';
import RootSetRef from '../value-objects/RootSetRef.js';

export const ROOT_SET_METADATA_VERSION = 1;
export const ROOT_SET_METADATA_ENTRY = '.rootset.json';
export const ROOT_SET_ENTRY_TYPES = Object.freeze(['blob', 'tree']);
export const ROOT_SET_RETENTION_POLICIES = Object.freeze(['pinned', 'evictable']);
const SLOT_PATTERN = /^root-[0-9]{8}$/;

/**
 * Canonical JSON codec for `.rootset.json` snapshots.
 */
export default class RootSetMetadataCodec {
  #refType;

  constructor({ refType = RootSetRef } = {}) {
    this.#refType = refType;
  }

  /**
   * @param {{ ref: string, entries: Iterable<object> }} options
   * @returns {Uint8Array}
   */
  encode({ ref, entries }) {
    return utf8Encode(JSON.stringify(this.create({ ref, entries }), null, 2));
  }

  /**
   * @param {{ ref: string, entries: Iterable<object> }} options
   * @returns {{ version: 1, ref: string, entries: Array<object> }}
   */
  create({ ref, entries }) {
    const rootSetRef = this.#refType.from(ref).toString();
    return {
      version: ROOT_SET_METADATA_VERSION,
      ref: rootSetRef,
      entries: this.normalizeEntries(entries).map((entry, index) => ({
        slot: RootSetMetadataCodec.slotFor(index),
        ...entry,
      })),
    };
  }

  /**
   * @param {Uint8Array} bytes
   * @param {{ expectedRef?: string }} [options]
   * @returns {{ version: 1, ref: string, entries: Array<object> }}
   */
  decode(bytes, { expectedRef } = {}) {
    let metadata;
    try {
      metadata = JSON.parse(utf8Decode(bytes));
    } catch (err) {
      throw this.#metadataError('Failed to parse .rootset.json', { originalError: err });
    }
    return this.validate(metadata, { expectedRef });
  }

  /**
   * @param {unknown} metadata
   * @param {{ expectedRef?: string }} [options]
   * @returns {{ version: 1, ref: string, entries: Array<object> }}
   */
  validate(metadata, { expectedRef } = {}) {
    this.#assertMetadataEnvelope(metadata);
    const canonical = this.#canonicalizeStoredMetadata(metadata);
    this.#assertExpectedRef(canonical.ref, expectedRef);
    this.#assertCanonicalStorage(metadata, canonical);
    return canonical;
  }

  /**
   * @param {Iterable<object>} entries
   * @returns {Array<{ name: string, oid: string, type: 'blob'|'tree', retention: 'pinned'|'evictable' }>}
   */
  normalizeEntries(entries) {
    if (!entries || typeof entries[Symbol.iterator] !== 'function') {
      throw this.#entryError('Root-set entries must be iterable', { entries });
    }

    const normalized = [...entries].map((entry) => this.#normalizeEntry(entry));
    normalized.sort(RootSetMetadataCodec.#compareNames);
    for (let index = 1; index < normalized.length; index++) {
      if (normalized[index - 1].name === normalized[index].name) {
        throw this.#entryError('Root-set entry names must be unique', {
          name: normalized[index].name,
        });
      }
    }
    return normalized;
  }

  /**
   * @param {number} index
   * @returns {string}
   */
  static slotFor(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 99_999_999) {
      throw new CasError(
        'Root-set entry count exceeds the supported slot range',
        ErrorCodes.ROOT_SET_ENTRY_INVALID,
        { index },
      );
    }
    return `root-${String(index).padStart(8, '0')}`;
  }

  /**
   * @param {object} entry
   * @returns {{ name: string, oid: string, type: 'blob'|'tree', retention: 'pinned'|'evictable' }}
   */
  #normalizeEntry(entry) {
    this.#assertEntryObject(entry);
    this.#assertEntryName(entry);
    this.#assertEntryType(entry);
    const retention = entry.retention ?? 'pinned';
    if (!ROOT_SET_RETENTION_POLICIES.includes(retention)) {
      throw this.#entryError('Root-set retention must be pinned or evictable', { entry });
    }
    return {
      name: entry.name,
      oid: this.#normalizeOid(entry),
      type: entry.type,
      retention,
    };
  }

  #assertMetadataEnvelope(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw this.#metadataError('Root-set metadata must be an object', { metadata });
    }
    if (metadata.version !== ROOT_SET_METADATA_VERSION) {
      throw this.#metadataError(`Unsupported root-set metadata version: ${metadata.version}`, {
        metadata,
      });
    }
  }

  #canonicalizeStoredMetadata(metadata) {
    try {
      return this.create({ ref: metadata.ref, entries: metadata.entries });
    } catch (err) {
      if (err instanceof CasError && err.code === ErrorCodes.ROOT_SET_ENTRY_INVALID) {
        throw err;
      }
      throw this.#metadataError('Root-set metadata fields are invalid', {
        metadata,
        originalError: err,
      });
    }
  }

  #assertExpectedRef(actualRef, expectedRef) {
    if (expectedRef === undefined || actualRef === this.#refType.from(expectedRef).toString()) {
      return;
    }
    throw this.#metadataError('Root-set metadata ref does not match the requested ref', {
      expectedRef,
      actualRef,
    });
  }

  #assertCanonicalStorage(metadata, canonical) {
    if (!RootSetMetadataCodec.#isCanonicalStoredMetadata(metadata, canonical)) {
      throw this.#metadataError('Root-set metadata is not canonical', { metadata });
    }
  }

  #assertEntryObject(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw this.#entryError('Root-set entry must be an object', { entry });
    }
  }

  #assertEntryName(entry) {
    if (
      typeof entry.name !== 'string' ||
      entry.name.length === 0 ||
      RootSetMetadataCodec.#hasControlCharacters(entry.name)
    ) {
      throw this.#entryError('Root-set entry name must be a non-empty string without control characters', {
        entry,
      });
    }
  }

  #assertEntryType(entry) {
    if (!ROOT_SET_ENTRY_TYPES.includes(entry.type)) {
      throw this.#entryError('Root-set entry type must be blob or tree', { entry });
    }
  }

  #normalizeOid(entry) {
    try {
      return Oid.from(entry.oid).toString();
    } catch (err) {
      throw this.#entryError('Root-set entry OID is invalid', { entry, originalError: err });
    }
  }

  static #hasControlCharacters(value) {
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint < 0x20 || codePoint === 0x7f) {
        return true;
      }
    }
    return false;
  }

  static #compareNames(left, right) {
    if (left.name < right.name) {
      return -1;
    }
    return left.name > right.name ? 1 : 0;
  }

  /**
   * @param {unknown} stored
   * @param {object} canonical
   * @returns {boolean}
   */
  static #isCanonicalStoredMetadata(stored, canonical) {
    if (Object.keys(stored).sort().join(',') !== 'entries,ref,version') {
      return false;
    }
    if (!Array.isArray(stored.entries) || stored.entries.length !== canonical.entries.length) {
      return false;
    }
    return stored.entries.every((entry, index) => (
      entry &&
      typeof entry === 'object' &&
      Object.keys(entry).sort().join(',') === 'name,oid,retention,slot,type' &&
      SLOT_PATTERN.test(entry.slot) &&
      JSON.stringify(entry) === JSON.stringify(canonical.entries[index])
    ));
  }

  /**
   * @param {string} message
   * @param {object} meta
   * @returns {CasError}
   */
  #metadataError(message, meta) {
    return new CasError(message, ErrorCodes.ROOT_SET_METADATA_INVALID, meta);
  }

  /**
   * @param {string} message
   * @param {object} meta
   * @returns {CasError}
   */
  #entryError(message, meta) {
    return new CasError(message, ErrorCodes.ROOT_SET_ENTRY_INVALID, meta);
  }
}
