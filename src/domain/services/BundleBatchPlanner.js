import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { utf8ByteLength } from '../encoding/utf8.js';
import {
  BUNDLE_DESCRIPTOR_VERSION,
  BUNDLE_INDEX_ENTRY,
  BUNDLE_LAYOUT,
} from './BundleDescriptorCodec.js';

const BLOB_MODE = '100644';
const TREE_MODE = '040000';
const SLOT_WIDTH = 6;
const MAX_PROTOCOL_OBJECTS = 256;
const MAX_PROTOCOL_BYTES = 64 * 1024 * 1024;
const MAX_PROTOCOL_TREE_ENTRIES = 65_536;
const CONSERVATIVE_OID = '0'.repeat(64);

/** Plans bounded bundle graphs before writing descriptors and dependency layers. */
export default class BundleBatchPlanner {
  #codec;
  #maxBatchBytes;
  #maxBatchObjects;
  #persistence;
  #staging;

  constructor({ persistence, codec, staging, maxBatchObjects, maxBatchBytes }) {
    this.#persistence = persistence;
    this.#codec = codec;
    this.#staging = staging;
    this.#maxBatchObjects = maxBatchObjects;
    this.#maxBatchBytes = maxBatchBytes;
  }

  static estimateObjectCount(requests) {
    return requests.reduce(
      (total, request) => total + objectCount(request.members.length, request.limits),
      0,
    );
  }

  create({ members, limits, observedAt }) {
    const levels = [leafNodes(members, limits)];
    while (levels.at(-1).length > 1) {
      levels.push(branchNodes(levels.at(-1), limits));
    }
    const index = levels.at(-1)[0];
    const root = rootNode({ index, memberCount: members.length, limits, codec: this.#codec });
    const descriptors = [...levels.flat(), root];
    let descriptorBytes = 0;
    for (const record of descriptors) {
      record.bytes = record.root
        ? this.#codec.encodeRoot(record.descriptor)
        : this.#codec.encodeNode(record.descriptor);
      descriptorBytes += record.bytes.length;
      if (descriptorBytes > limits.maxDescriptorBytes) {
        throw createCasError(
          'Bundle descriptors exceed their configured byte limit',
          ErrorCodes.BUNDLE_DESCRIPTOR_LIMIT,
          { descriptorBytes, maxDescriptorBytes: limits.maxDescriptorBytes },
        );
      }
    }
    return { levels, root, descriptors, descriptorBytes, limits, observedAt };
  }

  async write(plans) {
    this.#assertBounds(plans);
    await this.#writeDescriptors(plans.flatMap((plan) => plan.descriptors));
    const maximumDepth = Math.max(...plans.map((plan) => plan.levels.length));
    for (let depth = 0; depth < maximumDepth; depth += 1) {
      await this.#writeTreeLayer(plans.flatMap((plan) => plan.levels[depth] ?? []));
    }
    await this.#writeTreeLayer(plans.map((plan) => plan.root));
    return plans.map((plan) => ({
      oid: plan.root.oid,
      memberCount: plan.root.descriptor.memberCount,
      indexDepth: plan.root.descriptor.index.depth,
      descriptorBytes: plan.descriptorBytes,
      limits: plan.limits,
      observedAt: plan.observedAt,
    }));
  }

  #assertBounds(plans) {
    const objects = plans.reduce((total, plan) => total + plan.descriptors.length * 2, 0);
    const bytes = plans.reduce((total, plan) => total + plannedBytes(plan, this.#codec), 0);
    if (objects > this.#maxBatchObjects) {
      throw batchLimit('objects', objects, this.#maxBatchObjects);
    }
    if (bytes > this.#maxBatchBytes) {
      throw batchLimit('bytes', bytes, this.#maxBatchBytes);
    }
  }

  async #writeDescriptors(records) {
    for (const batch of windows(records, descriptorWeight, {
      maxObjects: Math.min(this.#maxBatchObjects, MAX_PROTOCOL_OBJECTS),
      maxBytes: Math.min(this.#maxBatchBytes, MAX_PROTOCOL_BYTES),
    })) {
      const contents = batch.map((record) => record.bytes);
      const oids = typeof this.#persistence.writeBlobs === 'function'
        ? await this.#persistence.writeBlobs(contents)
        : await writeIndividually(contents, (content) => this.#persistence.writeBlob(content));
      assertCardinality('descriptor', batch, oids);
      for (let index = 0; index < batch.length; index += 1) {
        batch[index].descriptorOid = oids[index];
        this.#staging.record(oids[index], 'blob');
      }
    }
  }

  async #writeTreeLayer(records) {
    const prepared = records.map((record) => ({ record, lines: treeLines(record, this.#codec) }));
    for (const batch of treeWindows(prepared, this.#maxBatchObjects, this.#maxBatchBytes)) {
      const trees = batch.map((item) => item.lines);
      const oids = typeof this.#persistence.writeTrees === 'function'
        ? await this.#persistence.writeTrees(trees)
        : await writeIndividually(trees, (entries) => this.#persistence.writeTree(entries));
      assertCardinality('tree', batch, oids);
      for (let index = 0; index < batch.length; index += 1) {
        batch[index].record.oid = oids[index];
        this.#staging.record(oids[index], 'tree');
      }
    }
  }
}

function leafNodes(members, limits) {
  const groups = members.length === 0 ? [[]] : chunks(members, limits.maxFanoutEntries - 1);
  return groups.map((group) => node('leaf', 1, group));
}

function branchNodes(children, limits) {
  const depth = children[0].descriptor.depth + 1;
  if (depth > limits.maxFanoutDepth) {
    throw createCasError('Bundle fanout exceeds its configured depth', ErrorCodes.BUNDLE_FANOUT_LIMIT, {
      attemptedDepth: depth,
      maxFanoutDepth: limits.maxFanoutDepth,
    });
  }
  return chunks(children, limits.maxFanoutEntries - 1).map((group) =>
    node('branch', depth, group)
  );
}

function node(kind, depth, targets) {
  const entries = kind === 'leaf' ? leafEntries(targets) : branchEntries(targets);
  const descriptor = {
    version: BUNDLE_DESCRIPTOR_VERSION,
    kind,
    depth,
    count: kind === 'leaf'
      ? entries.length
      : targets.reduce((total, child) => total + child.descriptor.count, 0),
    firstPath: rangePath(entries, kind, false),
    lastPath: rangePath(entries, kind, true),
    entries,
  };
  return { root: false, descriptor, targets };
}

function rootNode({ index, memberCount, limits, codec }) {
  return {
    root: true,
    descriptor: {
      version: BUNDLE_DESCRIPTOR_VERSION,
      kind: 'bundle',
      layout: BUNDLE_LAYOUT,
      codec: codec.extension,
      memberCount,
      index: {
        entry: BUNDLE_INDEX_ENTRY,
        depth: index.descriptor.depth,
        firstPath: index.descriptor.firstPath,
        lastPath: index.descriptor.lastPath,
      },
      limits: limits.toJSON(),
    },
    targets: [index],
  };
}

function leafEntries(members) {
  return members.map((member, index) => ({
    path: member.path,
    slot: slotFor(index),
    handle: member.handle.toString(),
    type: member.type,
    size: member.size,
  }));
}

function branchEntries(children) {
  return children.map((child, index) => ({
    firstPath: child.descriptor.firstPath,
    lastPath: child.descriptor.lastPath,
    slot: slotFor(index),
    count: child.descriptor.count,
    depth: child.descriptor.depth,
  }));
}

function rangePath(entries, kind, last) {
  const entry = last ? entries.at(-1) : entries[0];
  if (entry === undefined) {
    return null;
  }
  if (kind === 'leaf') {
    return entry.path;
  }
  return last ? entry.lastPath : entry.firstPath;
}

function treeLines(record, codec, oid = undefined) {
  const descriptorName = record.root ? codec.rootEntryName : codec.nodeEntryName;
  const lines = [blobEntry(record.descriptorOid ?? oid, descriptorName)];
  if (record.root) {
    lines.push(objectEntry(record.targets[0].oid ?? oid, BUNDLE_INDEX_ENTRY, 'tree'));
  } else {
    lines.push(...record.targets.map((target, index) => {
      const targetOid = target.oid ?? oid;
      const type = record.descriptor.kind === 'leaf' ? target.type : 'tree';
      return objectEntry(targetOid, slotFor(index), type);
    }));
  }
  lines.sort((left, right) => compareText(entryName(left), entryName(right)));
  return lines;
}

function plannedBytes(plan, codec) {
  const descriptorBytes = plan.descriptors.reduce((total, record) => total + record.bytes.length, 0);
  const treeBytes = plan.descriptors.reduce(
    (total, record) => total + linesWeight(treeLines(record, codec, CONSERVATIVE_OID)),
    0,
  );
  return descriptorBytes + treeBytes;
}

function treeWindows(records, configuredObjects, configuredBytes) {
  return windows(records, treeWeight, {
    maxObjects: Math.min(configuredObjects, MAX_PROTOCOL_OBJECTS),
    maxBytes: Math.min(configuredBytes, MAX_PROTOCOL_BYTES),
    maxEntries: MAX_PROTOCOL_TREE_ENTRIES,
  });
}

function windows(records, weightOf, limits) {
  const batches = [];
  let batch = [];
  let bytes = 0;
  let entries = 0;
  for (const record of records) {
    const weight = weightOf(record);
    const full = batch.length > 0 && (
      batch.length + 1 > limits.maxObjects ||
      bytes + weight.bytes > limits.maxBytes ||
      entries + weight.entries > (limits.maxEntries ?? Number.POSITIVE_INFINITY)
    );
    if (full) {
      batches.push(batch);
      batch = [];
      bytes = 0;
      entries = 0;
    }
    batch.push(record);
    bytes += weight.bytes;
    entries += weight.entries;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

function descriptorWeight(record) {
  return { bytes: record.bytes.length, entries: 0 };
}

function treeWeight(item) {
  return { bytes: linesWeight(item.lines), entries: item.lines.length };
}

function linesWeight(lines) {
  return lines.reduce((total, line) => total + utf8ByteLength(line) + 1, 0);
}

function objectCount(memberCount, limits) {
  let nodes = memberCount === 0 ? 1 : Math.ceil(memberCount / (limits.maxFanoutEntries - 1));
  let level = nodes;
  while (level > 1) {
    level = Math.ceil(level / (limits.maxFanoutEntries - 1));
    nodes += level;
  }
  return (nodes + 1) * 2;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function assertCardinality(kind, input, output) {
  if (output.length !== input.length) {
    throw createCasError(
      `Persistence returned the wrong number of ${kind} object identifiers`,
      ErrorCodes.GIT_ERROR,
      { expected: input.length, actual: output.length },
    );
  }
}

async function writeIndividually(values, write) {
  const oids = [];
  for (const value of values) {
    oids.push(await write(value));
  }
  return oids;
}

function batchLimit(kind, observed, maximum) {
  return createCasError(
    `Bundle batch exceeds its configured ${kind} limit`,
    ErrorCodes.INVALID_OPTIONS,
    { kind, observed, maximum },
  );
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
