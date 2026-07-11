import CasError from '../errors/CasError.js';
import { ErrorCodes } from '../errors/index.js';
import { ROOT_SET_METADATA_ENTRY } from './RootSetMetadataCodec.js';

const GIT_TREE_MODE = '040000';
const GIT_BLOB_MODE = '100644';

/**
 * Encodes and validates the Git tree that provides root-set reachability.
 */
export default class RootSetTreeCodec {
  /**
   * @param {object} metadata
   * @param {string} metadataBlobOid
   * @returns {string[]}
   */
  toTreeLines(metadata, metadataBlobOid) {
    const lines = [`${GIT_BLOB_MODE} blob ${metadataBlobOid}\t${ROOT_SET_METADATA_ENTRY}`];
    for (const entry of metadata.entries) {
      const mode = entry.type === 'tree' ? GIT_TREE_MODE : GIT_BLOB_MODE;
      lines.push(`${mode} ${entry.type} ${entry.oid}\t${entry.slot}`);
    }
    return lines;
  }

  /**
   * @param {Array<object>} rawEntries
   * @param {object} metadata
   */
  validate(rawEntries, metadata) {
    if (!Array.isArray(rawEntries)) {
      throw this.#treeError('Root-set tree entries must be an array', { rawEntries });
    }
    const { actual, metadataCount } = this.#indexTreeEntries(rawEntries);
    this.#assertEntryCounts(actual, metadataCount, metadata);
    this.#assertReachabilityEdges(actual, metadata.entries);
  }

  #indexTreeEntries(rawEntries) {
    const actual = new Map();
    let metadataCount = 0;
    for (const entry of rawEntries) {
      if (entry.name === ROOT_SET_METADATA_ENTRY) {
        metadataCount++;
        if (entry.type !== 'blob' || entry.mode !== GIT_BLOB_MODE) {
          throw this.#treeError('Root-set metadata entry must be a regular blob', { entry });
        }
        continue;
      }
      if (actual.has(entry.name)) {
        throw this.#treeError('Root-set tree contains duplicate entry slots', {
          slot: entry.name,
        });
      }
      actual.set(entry.name, entry);
    }
    return { actual, metadataCount };
  }

  #assertEntryCounts(actual, metadataCount, metadata) {
    if (metadataCount !== 1) {
      throw this.#treeError('Root-set tree must contain exactly one metadata blob', {
        metadataCount,
      });
    }
    if (actual.size !== metadata.entries.length) {
      throw this.#treeError('Root-set metadata and tree entry counts differ', {
        metadataEntryCount: metadata.entries.length,
        treeEntryCount: actual.size,
      });
    }
  }

  #assertReachabilityEdges(actual, expectedEntries) {
    for (const expected of expectedEntries) {
      const entry = actual.get(expected.slot);
      const mode = expected.type === 'tree' ? GIT_TREE_MODE : GIT_BLOB_MODE;
      if (!entry || entry.oid !== expected.oid || entry.type !== expected.type || entry.mode !== mode) {
        throw this.#treeError('Root-set metadata does not match its Git reachability edge', {
          expected,
          actual: entry ?? null,
        });
      }
    }
  }

  /**
   * @param {string} message
   * @param {object} meta
   * @returns {CasError}
   */
  #treeError(message, meta) {
    return new CasError(message, ErrorCodes.ROOT_SET_TREE_INVALID, meta);
  }
}
