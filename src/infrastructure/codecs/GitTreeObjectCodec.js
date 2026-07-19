import { utf8ByteLength, utf8Decode } from '../../domain/encoding/utf8.js';

const TREE_ENTRY_OVERHEAD_BYTES = 128;
const TYPE_BY_MODE = new Map([
  ['040000', 'tree'],
  ['100644', 'blob'],
  ['100755', 'blob'],
  ['120000', 'blob'],
  ['160000', 'commit'],
]);

/**
 * Decodes Git's canonical tree-object bytes at the persistence boundary.
 */
export default class GitTreeObjectCodec {
  /**
   * @param {Uint8Array} content
   * @param {string} treeOid
   * @returns {{ entries: ReadonlyArray<Readonly<{mode: string, type: string, oid: string, name: string}>>, weight: number }}
   */
  static decode(content, treeOid) {
    const bytes = GitTreeObjectCodec.#bytes(content);
    const oidBytes = GitTreeObjectCodec.#oidBytes(treeOid);
    const entries = [];
    let cursor = 0;

    while (cursor < bytes.length) {
      const modeEnd = GitTreeObjectCodec.#find(bytes, 0x20, cursor);
      const nameEnd = GitTreeObjectCodec.#find(bytes, 0x00, modeEnd + 1);
      const oidEnd = nameEnd + 1 + oidBytes;
      if (oidEnd > bytes.length) {
        throw new TypeError('Git tree entry has a truncated object identifier');
      }

      const rawMode = utf8Decode(bytes.subarray(cursor, modeEnd));
      const mode = rawMode.padStart(6, '0');
      const type = TYPE_BY_MODE.get(mode);
      const name = utf8Decode(bytes.subarray(modeEnd + 1, nameEnd));
      if (type === undefined || name.length === 0 || name.includes('/')) {
        throw new TypeError('Git tree entry has an invalid mode or name');
      }

      entries.push(
        Object.freeze({
          mode,
          type,
          oid: GitTreeObjectCodec.#hex(bytes.subarray(nameEnd + 1, oidEnd)),
          name,
        })
      );
      cursor = oidEnd;
    }

    const weight =
      bytes.length +
      entries.reduce(
        (total, entry) => total + TREE_ENTRY_OVERHEAD_BYTES + utf8ByteLength(entry.name),
        0
      );
    return Object.freeze({ entries: Object.freeze(entries), weight });
  }

  /**
   * Converts the existing `git mktree` line contract into typed session input.
   * @param {string[]} lines
   * @returns {Array<{mode: string, type: string, oid: string, name: string}>}
   */
  static parseMktreeLines(lines) {
    if (!Array.isArray(lines)) {
      throw new TypeError('Git tree entries must be an array');
    }
    return lines.map((line) => {
      if (typeof line !== 'string') {
        throw new TypeError('Git tree entry must be a string');
      }
      const tab = line.indexOf('\t');
      const fields = tab === -1 ? [] : line.slice(0, tab).split(' ');
      const name = tab === -1 ? '' : line.slice(tab + 1);
      const [mode, type, oid] = fields;
      if (
        fields.length !== 3 ||
        TYPE_BY_MODE.get(mode) !== type ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid) ||
        name.length === 0 ||
        name.includes('\0') ||
        name.includes('/')
      ) {
        throw new TypeError('Git tree entry line is invalid');
      }
      return { mode, type, oid, name };
    });
  }

  static #bytes(content) {
    if (!(content instanceof Uint8Array)) {
      throw new TypeError('Git tree content must be a Uint8Array');
    }
    return content;
  }

  static #oidBytes(treeOid) {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(treeOid)) {
      throw new TypeError('Git tree object identifier is invalid');
    }
    return treeOid.length / 2;
  }

  static #find(bytes, needle, start) {
    for (let index = start; index < bytes.length; index += 1) {
      if (bytes[index] === needle) {
        return index;
      }
    }
    throw new TypeError('Git tree entry is missing a delimiter');
  }

  static #hex(bytes) {
    let result = '';
    for (const byte of bytes) {
      result += byte.toString(16).padStart(2, '0');
    }
    return result;
  }
}
