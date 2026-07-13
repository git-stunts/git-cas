import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { normalizeCodecBytes } from '../helpers/codecBytes.js';
import parseApplicationHandle from '../value-objects/ApplicationHandle.js';
import BundleLimits from '../value-objects/BundleLimits.js';
import normalizeBundlePath from '../value-objects/BundlePath.js';

export const BUNDLE_LAYOUT = 'fanout-v1';
export const BUNDLE_DESCRIPTOR_VERSION = 1;
export const BUNDLE_INDEX_ENTRY = 'index';
const SLOT_PATTERN = /^slot-[0-9]{6}$/u;

/**
 * Deterministic codec and schema guard for bundle root/node descriptors.
 */
export default class BundleDescriptorCodec {
  #codec;

  /** @param {import('../../ports/CodecPort.js').default} codec */
  constructor(codec) {
    if (!codec || typeof codec.encode !== 'function' || typeof codec.decode !== 'function') {
      throw createCasError('Bundle descriptor codec is incomplete', ErrorCodes.INVALID_OPTIONS);
    }
    this.#codec = codec;
  }

  /** @returns {string} */
  get extension() {
    return this.#codec.extension;
  }

  /** @returns {string} */
  get rootEntryName() {
    return `bundle.${this.extension}`;
  }

  /** @returns {string} */
  get nodeEntryName() {
    return `node.${this.extension}`;
  }

  /** @param {object} descriptor */
  encodeRoot(descriptor) {
    return this.#encode(descriptor);
  }

  /** @param {object} descriptor */
  encodeNode(descriptor) {
    return this.#encode(descriptor);
  }

  /** @param {Uint8Array} bytes */
  decodeRoot(bytes) {
    const value = this.#decode(bytes, 'root');
    assertRoot(value, this.extension);
    return value;
  }

  /** @param {Uint8Array} bytes */
  decodeNode(bytes, limits) {
    const value = this.#decode(bytes, 'node');
    assertNode(value, limits);
    return value;
  }

  #encode(value) {
    try {
      return normalizeCodecBytes(this.#codec.encode(value));
    } catch (error) {
      throw corrupt('Bundle descriptor encoding failed', { originalError: error });
    }
  }

  #decode(bytes, descriptorKind) {
    let value;
    try {
      value = this.#codec.decode(bytes);
    } catch (error) {
      throw corrupt('Bundle descriptor decoding failed', { descriptorKind, originalError: error });
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw corrupt('Bundle descriptor must decode to an object', { descriptorKind });
    }
    return value;
  }
}

function assertRoot(value, extension) {
  assertRootEnvelope(value, extension);
  assertSafeCount(value.memberCount, 'memberCount');
  if (!value.index || typeof value.index !== 'object' || Array.isArray(value.index)) {
    throw corrupt('Bundle root index descriptor is invalid', { descriptor: value });
  }
  assertSafeCount(value.index.depth, 'index.depth', 1);
  assertRange(value.index.firstPath, value.index.lastPath, value.memberCount);
  if (value.index.entry !== BUNDLE_INDEX_ENTRY) {
    throw corrupt('Bundle root index entry name is invalid', { descriptor: value });
  }
  assertPersistedLimits(value.limits);
  if (value.memberCount > value.limits.maxMembers) {
    throw corrupt('Bundle root member count exceeds its persisted limit', { descriptor: value });
  }
  if (value.index.depth > value.limits.maxFanoutDepth) {
    throw corrupt('Bundle root depth exceeds its persisted fanout limit', { descriptor: value });
  }
  assertCanonicalRange(value.index, value.limits.maxMemberPathBytes);
}

function assertRootEnvelope(value, extension) {
  if (
    value.version !== BUNDLE_DESCRIPTOR_VERSION ||
    value.kind !== 'bundle' ||
    value.layout !== BUNDLE_LAYOUT ||
    value.codec !== extension
  ) {
    throw corrupt('Bundle root descriptor envelope is invalid', { descriptor: value });
  }
}

function assertNode(value, limits) {
  if (
    value.version !== BUNDLE_DESCRIPTOR_VERSION ||
    !['leaf', 'branch'].includes(value.kind) ||
    !Array.isArray(value.entries)
  ) {
    throw corrupt('Bundle node descriptor envelope is invalid', { descriptor: value });
  }
  assertSafeCount(value.depth, 'depth', 1);
  assertSafeCount(value.count, 'count');
  assertRange(value.firstPath, value.lastPath, value.count);
  if (value.kind === 'leaf') {
    assertLeafEntries(value, limits);
  } else {
    assertBranchEntries(value, limits);
  }
}

function assertLeafEntries(value, limits) {
  if (value.depth !== 1 || value.entries.length !== value.count) {
    throw corrupt('Bundle leaf count or depth is invalid', { descriptor: value });
  }
  let previous = null;
  for (const entry of value.entries) {
    assertCanonicalPath(entry?.path, limits.maxMemberPathBytes);
    previous = assertLeafEntry(entry, previous, value);
  }
  assertDescriptorRange(value);
}

function assertBranchEntries(value, limits) {
  if (value.depth < 2 || value.entries.length === 0) {
    throw corrupt('Bundle branch depth or entries are invalid', { descriptor: value });
  }
  let previousLast = null;
  let count = 0;
  for (const entry of value.entries) {
    assertCanonicalRange(entry, limits.maxMemberPathBytes);
    previousLast = assertBranchEntry(entry, previousLast, value);
    count += entry.count;
  }
  if (count !== value.count) {
    throw corrupt('Bundle branch member count is invalid', { descriptor: value });
  }
  assertDescriptorRange(value);
}

function assertLeafEntry(entry, previous, descriptor) {
  assertSlot(entry?.slot);
  if (typeof entry.path !== 'string' || (previous !== null && entry.path <= previous)) {
    throw corrupt('Bundle leaf paths are not strictly ordered', { descriptor });
  }
  const handle = parseDescriptorHandle(entry.handle);
  const expectedType = handle.kind === 'page' ? 'blob' : 'tree';
  if (entry.type !== expectedType || !isOptionalSize(entry.size)) {
    throw corrupt('Bundle leaf member metadata is inconsistent', { entry });
  }
  return entry.path;
}

function assertBranchEntry(entry, previousLast, descriptor) {
  assertSlot(entry?.slot);
  assertSafeCount(entry.count, 'entry.count', 1);
  assertSafeCount(entry.depth, 'entry.depth', 1);
  if (!isValidBranchRange(entry, previousLast, descriptor.depth)) {
    throw corrupt('Bundle branch ranges are invalid', { descriptor });
  }
  return entry.lastPath;
}

function isValidBranchRange(entry, previousLast, parentDepth) {
  return (
    typeof entry.firstPath === 'string' &&
    typeof entry.lastPath === 'string' &&
    entry.firstPath <= entry.lastPath &&
    (previousLast === null || entry.firstPath > previousLast) &&
    entry.depth === parentDepth - 1
  );
}

function assertDescriptorRange(value) {
  if (value.entries.length === 0) {
    return;
  }
  const first = value.entries[0];
  const last = value.entries.at(-1);
  const firstPath = value.kind === 'leaf' ? first.path : first.firstPath;
  const lastPath = value.kind === 'leaf' ? last.path : last.lastPath;
  if (value.firstPath !== firstPath || value.lastPath !== lastPath) {
    throw corrupt('Bundle node range does not match its entries', { descriptor: value });
  }
}

function assertPersistedLimits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw corrupt('Bundle persisted fanout limits are invalid', { limits: value });
  }
  const expected = Object.keys(new BundleLimits().toJSON());
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((field) => !Object.hasOwn(value, field))
  ) {
    throw corrupt('Bundle persisted limits are incomplete', { limits: value });
  }
  try {
    new BundleLimits(value);
  } catch (error) {
    throw corrupt('Bundle persisted limits are invalid', { limits: value, originalError: error });
  }
}

function assertCanonicalRange(value, maxBytes) {
  if (value.firstPath !== null) {
    assertCanonicalPath(value.firstPath, maxBytes);
    assertCanonicalPath(value.lastPath, maxBytes);
  }
}

function assertCanonicalPath(value, maxBytes) {
  let normalizedPath;
  try {
    normalizedPath = normalizeBundlePath(value, maxBytes);
  } catch (error) {
    throw corrupt('Bundle descriptor path is invalid', { path: value, originalError: error });
  }
  if (normalizedPath !== value) {
    throw corrupt('Bundle descriptor path is not canonical', { path: value, normalizedPath });
  }
}

function assertRange(firstPath, lastPath, count) {
  const empty = count === 0;
  if (
    (empty && (firstPath !== null || lastPath !== null)) ||
    (!empty && (typeof firstPath !== 'string' || typeof lastPath !== 'string' || firstPath > lastPath))
  ) {
    throw corrupt('Bundle descriptor range is invalid', { firstPath, lastPath, count });
  }
}

function assertSafeCount(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw corrupt('Bundle descriptor count is invalid', { field, value, minimum });
  }
}

function assertSlot(value) {
  if (typeof value !== 'string' || !SLOT_PATTERN.test(value)) {
    throw corrupt('Bundle descriptor slot is invalid', { slot: value });
  }
}

function parseDescriptorHandle(value) {
  try {
    return parseApplicationHandle(value);
  } catch (error) {
    throw corrupt('Bundle member handle is invalid', { handle: value, originalError: error });
  }
}

function isOptionalSize(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function corrupt(message, meta) {
  return createCasError(message, ErrorCodes.BUNDLE_CORRUPT, meta);
}
