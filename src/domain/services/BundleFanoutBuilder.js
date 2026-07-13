import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { BUNDLE_DESCRIPTOR_VERSION, BUNDLE_INDEX_ENTRY, BUNDLE_LAYOUT } from './BundleDescriptorCodec.js';

const SLOT_WIDTH = 6;
const BLOB_MODE = '100644';
const TREE_MODE = '040000';

/**
 * Streaming bulk loader for deterministic bounded bundle fanout trees.
 */
export default class BundleFanoutBuilder {
  #codec;
  #descriptorBytes = 0;
  #levels = [[]];
  #limits;
  #memberCount = 0;
  #persistence;
  #staging;

  /**
   * @param {object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('./BundleDescriptorCodec.js').default} options.codec
   * @param {import('../value-objects/BundleLimits.js').default} options.limits
   * @param {{ record(oid: string, type: string): void, snapshot(): object }} options.staging
   */
  constructor({ persistence, codec, limits, staging }) {
    this.#persistence = persistence;
    this.#codec = codec;
    this.#limits = limits;
    this.#staging = staging;
  }

  /**
   * @param {{ path: string, handle: object, oid: string, type: 'blob'|'tree', size: number|null }} member
   */
  async add(member) {
    const leaf = this.#levels[0];
    if (leaf.length === this.#capacity) {
      await this.#flushLevel(0);
    }
    this.#levels[0].push(member);
    this.#memberCount += 1;
  }

  /** @returns {Promise<object>} */
  async finish() {
    if (this.#memberCount === 0) {
      this.#levels[0].push(null);
    }
    while (true) {
      const nonEmpty = this.#nonEmptyLevels();
      if (nonEmpty.length === 1 && this.#levels[nonEmpty[0]].length === 1 && nonEmpty[0] > 0) {
        return await this.#writeRoot(this.#levels[nonEmpty[0]][0]);
      }
      await this.#flushLevel(nonEmpty[0]);
    }
  }

  get #capacity() {
    return this.#limits.maxFanoutEntries - 1;
  }

  #nonEmptyLevels() {
    const result = [];
    for (let index = 0; index < this.#levels.length; index++) {
      if (this.#levels[index].length > 0) {
        result.push(index);
      }
    }
    return result;
  }

  async #flushLevel(level) {
    const entries = this.#levels[level];
    this.#levels[level] = [];
    const summary = level === 0
      ? await this.#writeLeaf(entries[0] === null ? [] : entries)
      : await this.#writeBranch(entries);
    await this.#pushSummary(level + 1, summary);
  }

  async #pushSummary(level, summary) {
    this.#levels[level] ??= [];
    if (this.#levels[level].length === this.#capacity) {
      await this.#flushLevel(level);
    }
    this.#levels[level].push(summary);
  }

  async #writeLeaf(members) {
    const entries = members.map((member, index) => ({
      path: member.path,
      slot: slotFor(index),
      handle: member.handle.toString(),
      type: member.type,
      size: member.size,
    }));
    return await this.#writeNode({
      kind: 'leaf',
      depth: 1,
      count: entries.length,
      firstPath: entries[0]?.path ?? null,
      lastPath: entries.at(-1)?.path ?? null,
      entries,
      targets: members.map((member, index) => ({
        slot: slotFor(index),
        oid: member.oid,
        type: member.type,
      })),
    });
  }

  async #writeBranch(children) {
    const depth = children[0].depth + 1;
    if (depth > this.#limits.maxFanoutDepth) {
      throw this.#error('Bundle fanout exceeds its configured depth', ErrorCodes.BUNDLE_FANOUT_LIMIT, {
        attemptedDepth: depth,
        maxFanoutDepth: this.#limits.maxFanoutDepth,
      });
    }
    const entries = children.map((child, index) => ({
      firstPath: child.firstPath,
      lastPath: child.lastPath,
      slot: slotFor(index),
      count: child.count,
      depth: child.depth,
    }));
    return await this.#writeNode({
      kind: 'branch',
      depth,
      count: children.reduce((total, child) => total + child.count, 0),
      firstPath: children[0].firstPath,
      lastPath: children.at(-1).lastPath,
      entries,
      targets: children.map((child, index) => ({
        slot: slotFor(index),
        oid: child.oid,
        type: 'tree',
      })),
    });
  }

  async #writeNode({ kind, depth, count, firstPath, lastPath, entries, targets }) {
    const descriptor = {
      version: BUNDLE_DESCRIPTOR_VERSION,
      kind,
      depth,
      count,
      firstPath,
      lastPath,
      entries,
    };
    const descriptorOid = await this.#writeDescriptor(this.#codec.encodeNode(descriptor));
    const treeEntries = [blobEntry(descriptorOid, this.#codec.nodeEntryName)];
    treeEntries.push(...targets.map((target) => objectEntry(target.oid, target.slot, target.type)));
    this.#assertFanout(treeEntries.length);
    const oid = await this.#writeTree(treeEntries);
    return Object.freeze({ oid, depth, count, firstPath, lastPath });
  }

  async #writeRoot(index) {
    const descriptor = {
      version: BUNDLE_DESCRIPTOR_VERSION,
      kind: 'bundle',
      layout: BUNDLE_LAYOUT,
      codec: this.#codec.extension,
      memberCount: this.#memberCount,
      index: {
        entry: BUNDLE_INDEX_ENTRY,
        depth: index.depth,
        firstPath: index.firstPath,
        lastPath: index.lastPath,
      },
      limits: this.#limits.toJSON(),
    };
    const descriptorOid = await this.#writeDescriptor(this.#codec.encodeRoot(descriptor));
    const entries = [
      blobEntry(descriptorOid, this.#codec.rootEntryName),
      objectEntry(index.oid, BUNDLE_INDEX_ENTRY, 'tree'),
    ];
    this.#assertFanout(entries.length);
    const oid = await this.#writeTree(entries);
    return Object.freeze({
      oid,
      memberCount: this.#memberCount,
      indexDepth: index.depth,
      descriptorBytes: this.#descriptorBytes,
    });
  }

  async #writeDescriptor(bytes) {
    const next = this.#descriptorBytes + bytes.length;
    if (next > this.#limits.maxDescriptorBytes) {
      throw this.#error(
        'Bundle descriptors exceed their configured byte limit',
        ErrorCodes.BUNDLE_DESCRIPTOR_LIMIT,
        { descriptorBytes: next, maxDescriptorBytes: this.#limits.maxDescriptorBytes }
      );
    }
    this.#descriptorBytes = next;
    const oid = await this.#persistence.writeBlob(bytes);
    this.#staging.record(oid, 'blob');
    return oid;
  }

  async #writeTree(entries) {
    entries.sort((left, right) => compareText(entryName(left), entryName(right)));
    const oid = await this.#persistence.writeTree(entries);
    this.#staging.record(oid, 'tree');
    return oid;
  }

  #assertFanout(entries) {
    if (entries > this.#limits.maxFanoutEntries) {
      throw this.#error('Bundle tree node exceeds its fanout limit', ErrorCodes.BUNDLE_FANOUT_LIMIT, {
        entries,
        maxFanoutEntries: this.#limits.maxFanoutEntries,
      });
    }
  }

  #error(message, code, meta) {
    return createCasError(message, code, { ...meta, staging: this.#staging.snapshot() });
  }
}

function slotFor(index) {
  return `slot-${String(index).padStart(SLOT_WIDTH, '0')}`;
}

function blobEntry(oid, name) {
  return `${BLOB_MODE} blob ${oid}\t${name}`;
}

function objectEntry(oid, name, type) {
  return `${type === 'tree' ? TREE_MODE : BLOB_MODE} ${type} ${oid}\t${name}`;
}

function entryName(value) {
  return value.slice(value.indexOf('\t') + 1);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
