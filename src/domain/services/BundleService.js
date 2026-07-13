import { isBytes } from '../bytes/ByteLayout.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { assertHandleObjectType } from '../helpers/handleTarget.js';
import parseApplicationHandle from '../value-objects/ApplicationHandle.js';
import BundleHandle from '../value-objects/BundleHandle.js';
import BundleLimits from '../value-objects/BundleLimits.js';
import normalizeBundlePath from '../value-objects/BundlePath.js';
import StagedBundle from '../value-objects/StagedBundle.js';
import BundleDescriptorCodec, { BUNDLE_INDEX_ENTRY } from './BundleDescriptorCodec.js';
import BundleFanoutBuilder from './BundleFanoutBuilder.js';
import StagingEvidence from './StagingEvidence.js';

const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });
const DEFAULT_MAX_NESTING_DEPTH = 32;

/**
 * Builds and traverses deterministic, targeted structured bundle trees.
 */
export default class BundleService {
  #clock;
  #codec;
  #limits;
  #maxNestingDepth;
  #openHandle;
  #pages;
  #persistence;
  #resolveHandle;

  /**
   * @param {object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/CodecPort.js').default} options.codec
   * @param {import('./PageService.js').default} options.pages
   * @param {(handle: unknown, context?: object) => Promise<object>} options.resolveHandle
   * @param {(handle: unknown) => AsyncIterable<Uint8Array>|Promise<AsyncIterable<Uint8Array>>} options.openHandle
   * @param {object} [options.limits]
   * @param {number} [options.maxNestingDepth]
   * @param {{ now(): Date }} [options.clock]
   */
  constructor({
    persistence,
    codec,
    pages,
    resolveHandle,
    openHandle,
    limits,
    maxNestingDepth = DEFAULT_MAX_NESTING_DEPTH,
    clock = DEFAULT_CLOCK,
  }) {
    BundleService.#assertDependencies({ persistence, codec, pages, resolveHandle, openHandle, clock });
    if (!Number.isSafeInteger(maxNestingDepth) || maxNestingDepth < 1) {
      throw createCasError('Bundle nesting depth must be a positive safe integer', ErrorCodes.INVALID_OPTIONS);
    }
    this.#persistence = persistence;
    this.#codec = new BundleDescriptorCodec(codec);
    this.#pages = pages;
    this.#resolveHandle = resolveHandle;
    this.#openHandle = openHandle;
    this.#limits = new BundleLimits(limits);
    this.#maxNestingDepth = maxNestingDepth;
    this.#clock = clock;
  }

  /**
   * Convenience builder for an object, Map, or array of member pairs.
   *
   * @param {{ members: object|Map<string, unknown>|Array<[string, unknown]>, limits?: object }} options
   */
  async put({ members, limits }) {
    const entries = BundleService.#sortableEntries(members);
    entries.sort((left, right) => compareText(left[0], right[0]));
    return await this.#putOrdered(entries, limits);
  }

  /**
   * Bounded builder for members already ordered by canonical path.
   *
   * @param {{ members: Iterable<[string, unknown]>|AsyncIterable<[string, unknown]>, limits?: object }} options
   */
  async putOrdered({ members, limits }) {
    if (!isIterable(members)) {
      throw createCasError('Ordered bundle members must be an iterable', ErrorCodes.BUNDLE_MEMBER_INVALID);
    }
    return await this.#putOrdered(members, limits);
  }

  /**
   * Returns one targeted member descriptor without opening its payload.
   *
   * @param {{ handle: BundleHandle|string|object, path: string }} options
   * @returns {Promise<object|null>}
   */
  async getMember({ handle: value, path: rawPath }) {
    const handle = BundleHandle.from(value);
    const path = normalizeBundlePath(rawPath, this.#limits.maxMemberPathBytes);
    const root = await this.#readRoot(handle);
    let nodeOid = root.index.oid;
    while (true) {
      const node = await this.#readNode(nodeOid, root.descriptor.limits);
      if (node.descriptor.kind === 'leaf') {
        return await this.#memberFromLeaf({ bundleHandle: handle, nodeOid, descriptor: node.descriptor, path });
      }
      const child = findRange(node.descriptor.entries, path);
      if (!child) {
        return null;
      }
      const edge = await this.#requiredEdge(nodeOid, child.slot, 'tree');
      nodeOid = edge.oid;
    }
  }

  /**
   * Streams one byte-addressable member without hydrating unrelated members.
   *
   * @param {{ handle: BundleHandle|string|object, path: string }} options
   */
  async *openMember({ handle, path }) {
    const member = await this.getMember({ handle, path });
    if (!member) {
      throw createCasError('Bundle member was not found', ErrorCodes.BUNDLE_MEMBER_NOT_FOUND, {
        handle: BundleHandle.from(handle).toString(),
        path,
      });
    }
    if (member.handle.kind === 'bundle') {
      throw createCasError(
        'Bundle members are structured handles and cannot be opened as bytes',
        ErrorCodes.BUNDLE_MEMBER_NOT_STREAMABLE,
        { handle: BundleHandle.from(handle).toString(), path, memberHandle: member.handle.toString() }
      );
    }
    try {
      yield* await this.#openHandle(member.handle);
    } catch (error) {
      throw augmentError(error, { bundleHandle: BundleHandle.from(handle).toString(), memberPath: path });
    }
  }

  /**
   * Validates the complete bundle support graph.
   *
   * @param {BundleHandle|string|object} value
   * @param {{ nestingDepth?: number }} [context]
   */
  async resolveRoot(value, { nestingDepth = 0, validation } = {}) {
    if (nestingDepth > this.#maxNestingDepth) {
      throw createCasError('Bundle nesting exceeds its configured limit', ErrorCodes.BUNDLE_FANOUT_LIMIT, {
        nestingDepth,
        maxNestingDepth: this.#maxNestingDepth,
      });
    }
    const handle = BundleHandle.from(value);
    const root = await this.#readRoot(handle);
    const budget = { memberCount: 0, descriptorBytes: root.descriptorBytes };
    const summary = await this.#validateNode(root.index.oid, {
      nestingDepth,
      limits: root.descriptor.limits,
      budget,
      validation,
    });
    assertSummary(root.descriptor, summary);
    if (budget.memberCount !== summary.count) {
      throw corrupt('Bundle validation budget does not match its member count', {
        expectedMembers: summary.count,
        observedMembers: budget.memberCount,
      });
    }
    return Object.freeze({
      handle,
      oid: handle.oid,
      type: 'tree',
      size: null,
      memberCount: summary.count,
      indexDepth: summary.depth,
    });
  }

  async #putOrdered(members, overrides) {
    const limits = this.#limits.lower(overrides);
    const observedAt = this.#observedAt();
    const staging = new StagingEvidence();
    const builder = new BundleFanoutBuilder({
      persistence: this.#persistence,
      codec: this.#codec,
      limits,
      staging,
    });
    let previousPath = null;
    let memberCount = 0;
    const validation = { active: new Set(), cache: new Map() };
    try {
      for await (const pair of members) {
        const [rawPath, value] = BundleService.#memberPair(pair);
        const path = normalizeBundlePath(rawPath, limits.maxMemberPathBytes);
        BundleService.#assertOrder(path, previousPath);
        memberCount += 1;
        if (memberCount > limits.maxMembers) {
          throw createCasError('Bundle exceeds its member limit', ErrorCodes.BUNDLE_MEMBER_LIMIT, {
            observedMembers: memberCount,
            maxMembers: limits.maxMembers,
          });
        }
        const member = await this.#prepareMember(path, value, { staging, validation });
        await builder.add(member);
        previousPath = path;
      }
      const result = await builder.finish();
      return new StagedBundle({
        handle: new BundleHandle({ codec: this.#codec.extension, oid: result.oid }),
        memberCount: result.memberCount,
        indexDepth: result.indexDepth,
        descriptorBytes: result.descriptorBytes,
        limits,
        observedAt,
      });
    } catch (error) {
      throw augmentError(error, { staging: staging.snapshot() });
    }
  }

  async #prepareMember(path, value, { staging, validation }) {
    const inline = inlinePageOptions(value);
    if (inline) {
      const staged = await this.#pages.put(inline);
      staging.record(staged.handle.oid, 'blob');
      staging.recordHandle(staged.handle);
      return Object.freeze({
        path,
        handle: staged.handle,
        oid: staged.handle.oid,
        type: 'blob',
        size: staged.page.size,
      });
    }
    let handle;
    try {
      handle = parseApplicationHandle(value);
      const target = await this.#resolveHandle(handle, { nestingDepth: 1, validation });
      assertResolvedTarget(handle, target);
      return Object.freeze({
        path,
        handle,
        oid: target.oid,
        type: target.type,
        size: target.size ?? null,
      });
    } catch (error) {
      throw augmentError(error, { memberPath: path, memberHandle: handle?.toString() ?? null });
    }
  }

  async #readRoot(handle) {
    this.#assertCodec(handle);
    await assertHandleObjectType({
      persistence: this.#persistence,
      handle,
      oid: handle.oid,
      expectedType: 'tree',
    });
    const descriptorEntry = await this.#requiredEdge(handle.oid, this.#codec.rootEntryName, 'blob');
    const descriptorBytes = await this.#readDescriptorBlob(
      descriptorEntry.oid,
      { handle: handle.toString(), kind: 'root' },
      this.#limits.maxDescriptorBytes
    );
    const descriptor = this.#codec.decodeRoot(descriptorBytes);
    this.#assertReadableLimits(descriptor.limits);
    if (descriptorBytes.length > descriptor.limits.maxDescriptorBytes) {
      throw corrupt('Bundle root descriptor exceeds its persisted byte limit', {
        descriptorBytes: descriptorBytes.length,
        maxDescriptorBytes: descriptor.limits.maxDescriptorBytes,
      });
    }
    const index = await this.#requiredEdge(handle.oid, BUNDLE_INDEX_ENTRY, 'tree');
    return Object.freeze({ descriptor, descriptorBytes: descriptorBytes.length, index });
  }

  async #readNode(treeOid, limits) {
    const descriptorEntry = await this.#requiredEdge(treeOid, this.#codec.nodeEntryName, 'blob');
    const descriptorBytes = await this.#readDescriptorBlob(descriptorEntry.oid, {
      treeOid,
      kind: 'node',
    }, limits.maxDescriptorBytes);
    const descriptor = this.#codec.decodeNode(descriptorBytes, limits);
    if (descriptor.depth > limits.maxFanoutDepth) {
      throw corrupt('Bundle node exceeds its persisted depth limit', {
        treeOid,
        depth: descriptor.depth,
        maxFanoutDepth: limits.maxFanoutDepth,
      });
    }
    if (descriptor.count > limits.maxMembers) {
      throw corrupt('Bundle node exceeds its persisted member limit', {
        treeOid,
        memberCount: descriptor.count,
        maxMembers: limits.maxMembers,
      });
    }
    if (descriptor.entries.length + 1 > limits.maxFanoutEntries) {
      throw corrupt('Bundle node exceeds its persisted fanout limit', {
        treeOid,
        entries: descriptor.entries.length + 1,
        maxFanoutEntries: limits.maxFanoutEntries,
      });
    }
    return Object.freeze({
      descriptor,
      descriptorBytes: descriptorBytes.length,
      descriptorOid: descriptorEntry.oid,
    });
  }

  async #memberFromLeaf({ bundleHandle, nodeOid, descriptor, path }) {
    const entry = findPath(descriptor.entries, path);
    if (!entry) {
      return null;
    }
    const handle = parseApplicationHandle(entry.handle);
    const edge = await this.#requiredEdge(nodeOid, entry.slot, entry.type);
    if (edge.oid !== handle.oid) {
      throw corrupt('Bundle member edge does not match its handle', {
        bundleHandle: bundleHandle.toString(),
        memberPath: path,
        expectedOid: handle.oid,
        actualOid: edge.oid,
      });
    }
    try {
      const target = await this.#resolveHandle(handle, { nestingDepth: 1 });
      assertMemberTarget({
        member: entry,
        handle,
        target,
        meta: { treeOid: nodeOid, memberPath: path },
      });
    } catch (error) {
      throw augmentError(error, {
        bundleHandle: bundleHandle.toString(),
        memberPath: path,
        memberHandle: handle.toString(),
      });
    }
    return Object.freeze({ version: 1, path, handle, type: entry.type, size: entry.size });
  }

  async #validateNode(treeOid, context) {
    const node = await this.#readNode(treeOid, context.limits);
    context.budget.descriptorBytes += node.descriptorBytes;
    if (context.budget.descriptorBytes > context.limits.maxDescriptorBytes) {
      throw corrupt('Bundle descriptors exceed their persisted byte limit', {
        descriptorBytes: context.budget.descriptorBytes,
        maxDescriptorBytes: context.limits.maxDescriptorBytes,
      });
    }
    if (node.descriptor.kind === 'leaf') {
      context.budget.memberCount += node.descriptor.count;
      if (context.budget.memberCount > context.limits.maxMembers) {
        throw corrupt('Bundle members exceed their persisted limit', {
          memberCount: context.budget.memberCount,
          maxMembers: context.limits.maxMembers,
        });
      }
      await this.#validateLeafTargets(treeOid, node.descriptor, context);
      return summaryOf(node.descriptor, treeOid);
    }
    for (const child of node.descriptor.entries) {
      const edge = await this.#requiredEdge(treeOid, child.slot, 'tree');
      const actual = await this.#validateNode(edge.oid, context);
      assertChildSummary(child, actual, treeOid);
    }
    return summaryOf(node.descriptor, treeOid);
  }

  async #validateLeafTargets(treeOid, descriptor, context) {
    for (const member of descriptor.entries) {
      const handle = parseApplicationHandle(member.handle);
      const edge = await this.#requiredEdge(treeOid, member.slot, member.type);
      if (edge.oid !== handle.oid) {
        throw corrupt('Bundle member target edge is inconsistent', {
          treeOid,
          memberPath: member.path,
          expectedOid: handle.oid,
          actualOid: edge.oid,
        });
      }
      try {
        const target = await this.#resolveHandle(handle, {
          nestingDepth: context.nestingDepth + 1,
          validation: context.validation,
        });
        assertMemberTarget({
          member,
          handle,
          target,
          meta: { treeOid, memberPath: member.path },
        });
      } catch (error) {
        throw augmentError(error, { treeOid, memberPath: member.path, memberHandle: handle.toString() });
      }
    }
  }

  async #requiredEdge(treeOid, name, expectedType) {
    let entry;
    try {
      entry = await this.#readTreeEntry(treeOid, name);
    } catch (error) {
      throw corrupt('Bundle tree entry could not be read', { treeOid, name, originalError: error });
    }
    if (!entry || entry.type !== expectedType) {
      throw corrupt('Bundle tree entry is missing or has the wrong type', {
        treeOid,
        name,
        expectedType,
        actualType: entry?.type ?? null,
      });
    }
    return entry;
  }

  async #readTreeEntry(treeOid, name) {
    if (typeof this.#persistence.readTreeEntry === 'function') {
      return await this.#persistence.readTreeEntry(treeOid, name);
    }
    const entries = await this.#persistence.readTree(treeOid);
    return entries.find((entry) => entry.name === name) ?? null;
  }

  async #readDescriptorBlob(oid, meta, maxBytes) {
    try {
      return await this.#persistence.readBlob(oid, maxBytes);
    } catch (error) {
      throw corrupt('Bundle descriptor blob is missing or unreadable', { ...meta, oid, originalError: error });
    }
  }

  #assertCodec(handle) {
    if (handle.codec !== this.#codec.extension) {
      throw createCasError(
        'Bundle handle codec does not match this CAS instance',
        ErrorCodes.HANDLE_CODEC_MISMATCH,
        { handle: handle.toString(), expectedCodec: this.#codec.extension, actualCodec: handle.codec }
      );
    }
  }

  #assertReadableLimits(limits) {
    const codes = {
      maxMembers: ErrorCodes.BUNDLE_MEMBER_LIMIT,
      maxMemberPathBytes: ErrorCodes.BUNDLE_PATH_LIMIT,
      maxDescriptorBytes: ErrorCodes.BUNDLE_DESCRIPTOR_LIMIT,
      maxFanoutEntries: ErrorCodes.BUNDLE_FANOUT_LIMIT,
      maxFanoutDepth: ErrorCodes.BUNDLE_FANOUT_LIMIT,
    };
    for (const field of Object.keys(codes)) {
      if (limits[field] > this.#limits[field]) {
        throw createCasError(
          'Bundle admission policy exceeds this repository read limit',
          codes[field],
          { field, observed: limits[field], configured: this.#limits[field] }
        );
      }
    }
  }

  #observedAt() {
    const now = this.#clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw createCasError('BundleService clock returned an invalid Date', ErrorCodes.INVALID_OPTIONS);
    }
    return now.toISOString();
  }

  static #sortableEntries(members) {
    if (members instanceof Map || Array.isArray(members)) {
      return [...members];
    }
    if (members && typeof members === 'object' && !isIterable(members)) {
      return Object.entries(members);
    }
    throw createCasError(
      'bundles.put() requires an object, Map, or array; use putOrdered() for iterables',
      ErrorCodes.BUNDLE_MEMBER_INVALID
    );
  }

  static #memberPair(value) {
    if (!Array.isArray(value) || value.length !== 2) {
      throw createCasError('Bundle member must be a [path, value] pair', ErrorCodes.BUNDLE_MEMBER_INVALID, {
        member: value,
      });
    }
    return value;
  }

  static #assertOrder(path, previousPath) {
    if (previousPath === null || path > previousPath) {
      return;
    }
    const duplicate = path === previousPath;
    throw createCasError(
      duplicate ? 'Bundle contains a duplicate member path' : 'Ordered bundle members are out of order',
      duplicate ? ErrorCodes.BUNDLE_DUPLICATE_PATH : ErrorCodes.BUNDLE_MEMBER_ORDER,
      { path, previousPath }
    );
  }

  static #assertDependencies({ persistence, codec, pages, resolveHandle, openHandle, clock }) {
    BundleService.#assertPersistence(persistence);
    BundleService.#assertCodecDependency(codec);
    BundleService.#assertPageDependency(pages);
    BundleService.#assertHandleDependencies(resolveHandle, openHandle);
    if (!clock || typeof clock.now !== 'function') {
      throw createCasError('BundleService clock must provide now()', ErrorCodes.INVALID_OPTIONS);
    }
  }

  static #assertPersistence(persistence) {
    const methods = ['writeBlob', 'writeTree', 'readBlob', 'readTree', 'readObjectType'];
    if (!persistence || methods.some((method) => typeof persistence[method] !== 'function')) {
      throw createCasError('BundleService requires a complete persistence port', ErrorCodes.INVALID_OPTIONS);
    }
  }

  static #assertCodecDependency(codec) {
    if (!codec || typeof codec.encode !== 'function' || typeof codec.decode !== 'function') {
      throw createCasError('BundleService requires a complete codec', ErrorCodes.INVALID_OPTIONS);
    }
  }

  static #assertPageDependency(pages) {
    if (!pages || typeof pages.put !== 'function') {
      throw createCasError('BundleService requires PageService', ErrorCodes.INVALID_OPTIONS);
    }
  }

  static #assertHandleDependencies(resolveHandle, openHandle) {
    if (typeof resolveHandle !== 'function' || typeof openHandle !== 'function') {
      throw createCasError('BundleService requires handle resolution and open callbacks', ErrorCodes.INVALID_OPTIONS);
    }
  }
}

function inlinePageOptions(value) {
  if (isBytes(value) || (isIterable(value) && typeof value !== 'string')) {
    return { source: value };
  }
  if (value && typeof value === 'object' && Object.hasOwn(value, 'source')) {
    return { source: value.source, maxBytes: value.maxBytes };
  }
  return null;
}

function isIterable(value) {
  return Boolean(value?.[Symbol.asyncIterator] || value?.[Symbol.iterator]);
}

function assertResolvedTarget(handle, target) {
  const expectedType = handle.kind === 'page' ? 'blob' : 'tree';
  if (!target || target.oid !== handle.oid || target.type !== expectedType) {
    throw createCasError('Resolved bundle member does not match its handle', ErrorCodes.BUNDLE_MEMBER_INVALID, {
      handle: handle.toString(),
      expectedType,
      actualOid: target?.oid ?? null,
      actualType: target?.type ?? null,
    });
  }
}

function assertMemberTarget({ member, handle, target, meta }) {
  assertResolvedTarget(handle, target);
  if (member.size !== (target.size ?? null)) {
    throw corrupt('Bundle member size does not match its resolved target', {
      ...meta,
      memberHandle: handle.toString(),
      expectedSize: member.size,
      actualSize: target.size ?? null,
    });
  }
}

function findPath(entries, path) {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].path === path) {
      return entries[middle];
    }
    if (entries[middle].path < path) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return null;
}

function findRange(entries, path) {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const entry = entries[middle];
    if (path < entry.firstPath) {
      high = middle - 1;
    } else if (path > entry.lastPath) {
      low = middle + 1;
    } else {
      return entry;
    }
  }
  return null;
}

function summaryOf(descriptor, oid) {
  return Object.freeze({
    oid,
    depth: descriptor.depth,
    count: descriptor.count,
    firstPath: descriptor.firstPath,
    lastPath: descriptor.lastPath,
  });
}

function assertChildSummary(expected, actual, parentTreeOid) {
  for (const field of ['depth', 'count', 'firstPath', 'lastPath']) {
    if (expected[field] !== actual[field]) {
      throw corrupt('Bundle branch summary does not match its child', {
        parentTreeOid,
        childTreeOid: actual.oid,
        field,
        expected: expected[field],
        actual: actual[field],
      });
    }
  }
}

function assertSummary(root, actual) {
  const expected = {
    depth: root.index.depth,
    count: root.memberCount,
    firstPath: root.index.firstPath,
    lastPath: root.index.lastPath,
  };
  assertChildSummary(expected, actual, root.index.entry);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function augmentError(error, meta) {
  if (error && typeof error === 'object') {
    error.meta = { ...error.meta, ...meta };
  }
  return error;
}

function corrupt(message, meta) {
  return createCasError(message, ErrorCodes.BUNDLE_CORRUPT, meta);
}
