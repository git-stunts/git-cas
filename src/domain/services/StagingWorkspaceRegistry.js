import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import parseApplicationHandle from '../value-objects/ApplicationHandle.js';
import CollectionNamespace from '../value-objects/CollectionNamespace.js';
import PageHandle from '../value-objects/PageHandle.js';
import WorkspaceRef from '../value-objects/WorkspaceRef.js';
import RootSet from './RootSet.js';
import RootSetMetadataCodec from './RootSetMetadataCodec.js';
import RootSetPersistence from './RootSetPersistence.js';
import StagingWorkspace from './StagingWorkspace.js';
import WorkspaceDescriptorCodec, {
  WORKSPACE_DESCRIPTOR_ENTRY,
} from './WorkspaceDescriptorCodec.js';

export const DEFAULT_WORKSPACE_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_WORKSPACE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_WORKSPACE_INSPECTION_LIMIT = 100;
export const MAX_WORKSPACE_INSPECTION_LIMIT = 1000;
const NONCE_BYTES = 16;
const TARGET_ENTRY_PREFIX = 'target:';
const TARGET_ROOT_TYPES = Object.freeze({
  asset: 'tree',
  bundle: 'tree',
  page: 'blob',
});
const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });

/** Creates staging workspaces and provides bounded abandoned-workspace operations. */
export default class StagingWorkspaceRegistry {
  #assets;
  #bundles;
  #clock;
  #crypto;
  #descriptorCodec;
  #pages;
  #persistence;
  #publications;
  #ref;
  #resolveHandle;

  constructor({ persistence, ref, assets, pages, bundles, publications, resolveHandle, crypto,
    clock = DEFAULT_CLOCK, descriptorCodec = new WorkspaceDescriptorCodec() }) {
    StagingWorkspaceRegistry.#assertDependencies({
      persistence,
      ref,
      assets,
      pages,
      bundles,
      resolveHandle,
      crypto,
      clock,
      descriptorCodec,
    });
    this.#persistence = persistence;
    this.#ref = ref;
    this.#assets = assets;
    this.#pages = pages;
    this.#bundles = bundles;
    this.#publications = publications;
    this.#resolveHandle = resolveHandle;
    this.#crypto = crypto;
    this.#clock = clock;
    this.#descriptorCodec = descriptorCodec;
    Object.freeze(this);
  }

  async open({ namespace: value, ttlMs = DEFAULT_WORKSPACE_TTL_MS } = {}) {
    const namespace = CollectionNamespace.from(value).toString();
    StagingWorkspaceRegistry.#assertTtl(ttlMs);
    const createdAt = this.#observedAt();
    const nonce = await this.#crypto.randomBytes(NONCE_BYTES);
    const workspaceRef = WorkspaceRef.create({ namespace, createdAt, nonce });
    return new StagingWorkspace({
      workspaceRef,
      ttlMs,
      rootSet: this.#rootSet(workspaceRef),
      refs: this.#ref,
      assets: this.#assets,
      pages: this.#pages,
      bundles: this.#bundles,
      publications: this.#publications,
      resolveHandle: this.#resolveHandle,
      descriptorCodec: this.#descriptorCodec,
      clock: this.#clock,
    });
  }

  async inspect({
    namespace: value,
    limit = DEFAULT_WORKSPACE_INSPECTION_LIMIT,
    cursor: cursorValue = null,
  } = {}) {
    const namespace = CollectionNamespace.from(value).toString();
    StagingWorkspaceRegistry.#assertLimit(limit);
    const cursor = StagingWorkspaceRegistry.#cursor(cursorValue, namespace);
    const records = [];
    for await (const record of this.#ref.iterateRefs({
      prefix: WorkspaceRef.prefixForNamespace(namespace),
      after: cursor,
      limit: limit + 1,
    })) {
      records.push(record);
    }
    const truncated = records.length > limit;
    const selected = truncated ? records.slice(0, limit) : records;
    const workspaces = [];
    for (const record of selected) {
      workspaces.push(await this.inspectRecord(record));
    }
    return Object.freeze({
      namespace,
      returned: workspaces.length,
      truncated,
      nextCursor: truncated ? selected.at(-1).ref : null,
      workspaces: Object.freeze(workspaces),
    });
  }

  async sweep(options = {}) {
    const inspection = await this.inspect(options);
    const totals = { changed: 0, conflicted: 0, missing: 0 };
    const results = [];
    for (const workspace of inspection.workspaces) {
      const outcome = await this.#sweepWorkspace(workspace);
      if (outcome === null) {
        continue;
      }
      totals.changed += outcome.changed ? 1 : 0;
      totals.conflicted += outcome.conflict ? 1 : 0;
      totals.missing += outcome.missing ? 1 : 0;
      results.push(outcome.result);
    }
    return Object.freeze({
      namespace: inspection.namespace,
      inspected: inspection.returned,
      ...totals,
      truncated: inspection.truncated,
      nextCursor: inspection.nextCursor,
      results: Object.freeze(results),
    });
  }

  async #sweepWorkspace(workspace) {
    const inspectionOutcome = StagingWorkspaceRegistry.#inspectionSweepOutcome(workspace);
    if (inspectionOutcome !== undefined) {
      return inspectionOutcome;
    }
    if (workspace.posture !== 'expired' || workspace.symref !== null) {
      return null;
    }
    try {
      const changed = await this.#ref.deleteRef({
        ref: workspace.ref,
        expectedOldOid: workspace.generation,
      });
      return StagingWorkspaceRegistry.#sweepOutcome(workspace, {
        changed,
        missing: !changed,
      });
    } catch (error) {
      if (![ErrorCodes.GIT_REF_CONFLICT, ErrorCodes.WORKSPACE_CONFLICT].includes(error?.code)) {
        throw error;
      }
      return StagingWorkspaceRegistry.#sweepOutcome(workspace, { conflict: true });
    }
  }

  async inspectRecord(record) {
    let workspaceRef;
    try {
      workspaceRef = WorkspaceRef.from(record.ref);
      return await this.#readRecord(record, workspaceRef);
    } catch (error) {
      return StagingWorkspaceRegistry.#invalidRecord(record, workspaceRef, error);
    }
  }

  async #readRecord(record, workspaceRef) {
    StagingWorkspaceRegistry.#assertDirectRef(record);
    const state = await this.#rootSet(workspaceRef).read();
    StagingWorkspaceRegistry.#assertObservedGeneration(record, state);
    const descriptor = await this.#readDescriptor(record, state.entries);
    const targets = state.entries.filter((entry) => entry.name !== WORKSPACE_DESCRIPTOR_ENTRY);
    StagingWorkspaceRegistry.#assertTargetCount(record, descriptor, targets);
    const usage = await this.#usage(record, targets);
    const now = Date.parse(this.#observedAt());
    return Object.freeze({
      id: workspaceRef.id,
      namespace: workspaceRef.namespace,
      ref: record.ref,
      generation: record.oid,
      symref: record.symref,
      rootCount: targets.length,
      logicalBytes: usage.logicalBytes,
      rootObjectBytes: usage.rootObjectBytes,
      createdAt: descriptor.createdAt,
      ageMs: Math.max(0, now - Date.parse(descriptor.createdAt)),
      expiresAt: descriptor.expiresAt,
      posture: now >= Date.parse(descriptor.expiresAt) ? 'expired' : 'active',
      issue: null,
    });
  }

  async #readDescriptor(record, entries) {
    const descriptorEntry = entries.find((entry) => entry.name === WORKSPACE_DESCRIPTOR_ENTRY);
    if (!descriptorEntry || descriptorEntry.type !== 'blob') {
      throw createCasError(
        'Workspace generation is missing its lease descriptor',
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { ref: record.ref },
      );
    }
    const bytes = await this.#pages.get({ handle: new PageHandle({ oid: descriptorEntry.oid }) });
    return this.#descriptorCodec.decode(bytes, { expectedRef: record.ref });
  }

  async #usage(record, targets) {
    let logicalBytes = 0;
    const rootOids = new Set();
    for (const target of targets) {
      const targetLogicalBytes = await this.#targetLogicalBytes(record, target);
      logicalBytes = StagingWorkspaceRegistry.#addBytes({
        total: logicalBytes,
        value: targetLogicalBytes,
        label: 'logical bytes',
        ref: record.ref,
      });
      rootOids.add(target.oid);
    }
    let rootObjectBytes = 0;
    for (const oid of rootOids) {
      rootObjectBytes = StagingWorkspaceRegistry.#addBytes({
        total: rootObjectBytes,
        value: await this.#persistence.readObjectSize(oid),
        label: 'root-object bytes',
        ref: record.ref,
      });
    }
    return Object.freeze({ logicalBytes, rootObjectBytes });
  }

  async #targetLogicalBytes(record, target) {
    const handle = StagingWorkspaceRegistry.#targetHandle(record, target);
    const resolved = await this.#resolveHandle(handle);
    const resolvedHandle = StagingWorkspaceRegistry.#resolvedHandle({
      record,
      target,
      handle,
      resolved,
    });
    StagingWorkspaceRegistry.#assertResolvedTarget({
      record,
      target,
      handle,
      resolved,
      resolvedHandle,
    });
    const logicalBytes = resolved.logicalBytes ?? resolved.size;
    StagingWorkspaceRegistry.#assertByteCount(
      logicalBytes,
      'Workspace target logical byte count is invalid',
      { ref: record.ref, handle: handle.toString(), logicalBytes },
    );
    return logicalBytes;
  }

  #rootSet(workspaceRef) {
    const ref = WorkspaceRef.from(workspaceRef).toString();
    const metadataCodec = new RootSetMetadataCodec({ refType: WorkspaceRef });
    const persistence = new RootSetPersistence({
      rootSetRef: ref,
      persistence: this.#persistence,
      ref: this.#ref,
      refType: WorkspaceRef,
      metadataCodec,
    });
    return new RootSet({
      ref,
      persistence,
      refType: WorkspaceRef,
      metadataCodec,
    });
  }

  #observedAt() {
    const now = this.#clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw createCasError(
        'Workspace registry clock returned an invalid Date',
        ErrorCodes.INVALID_OPTIONS,
      );
    }
    return now.toISOString();
  }

  static #assertTtl(ttlMs) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_WORKSPACE_TTL_MS) {
      throw createCasError(
        'Workspace ttlMs must be a positive safe integer within the supported maximum',
        ErrorCodes.WORKSPACE_TTL_INVALID,
        { ttlMs, maxTtlMs: MAX_WORKSPACE_TTL_MS },
      );
    }
  }

  static #assertLimit(limit) {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_WORKSPACE_INSPECTION_LIMIT) {
      throw createCasError(
        'Workspace inspection limit is outside supported bounds',
        ErrorCodes.INVALID_OPTIONS,
        { limit, maxLimit: MAX_WORKSPACE_INSPECTION_LIMIT },
      );
    }
  }

  static #cursor(value, namespace) {
    if (value === null) {
      return null;
    }
    let cursor;
    try {
      cursor = WorkspaceRef.from(value);
    } catch (error) {
      throw createCasError(
        'Workspace cursor must be a cursor returned for the requested namespace',
        ErrorCodes.INVALID_OPTIONS,
        { cursor: value, namespace, originalError: error },
      );
    }
    if (cursor.namespace !== namespace) {
      throw createCasError(
        'Workspace cursor belongs to a different namespace',
        ErrorCodes.INVALID_OPTIONS,
        { cursor: cursor.toString(), namespace, cursorNamespace: cursor.namespace },
      );
    }
    return cursor.toString();
  }

  static #inspectionSweepOutcome(workspace) {
    if (workspace.issue?.code === ErrorCodes.WORKSPACE_CONFLICT) {
      return StagingWorkspaceRegistry.#sweepOutcome(workspace, { conflict: true });
    }
    if (workspace.issue?.code === ErrorCodes.GIT_REF_NOT_FOUND) {
      return StagingWorkspaceRegistry.#sweepOutcome(workspace, { missing: true });
    }
    return undefined;
  }

  static #sweepOutcome(workspace, { changed = false, conflict = false, missing = false }) {
    return Object.freeze({
      changed,
      conflict,
      missing,
      result: Object.freeze({
        id: workspace.id,
        ref: workspace.ref,
        generation: workspace.generation,
        changed,
        conflict,
      }),
    });
  }

  static #assertDependencies({ persistence, ref, assets, pages, bundles, resolveHandle, crypto,
    clock, descriptorCodec }) {
    const dependencies = [
      ['persistence', StagingWorkspaceRegistry.#hasMethods(persistence, [
        'writeBlob', 'writeTree', 'readBlob', 'readTree', 'readObjectType', 'readObjectSize',
      ])],
      ['ref', StagingWorkspaceRegistry.#hasMethods(ref, [
        'resolveRef', 'resolveTree', 'resolveParents', 'createCommit', 'updateRef', 'deleteRef',
        'iterateRefs',
      ])],
      ['assets', StagingWorkspaceRegistry.#hasMethods(assets, ['put', 'adopt'])],
      ['pages', StagingWorkspaceRegistry.#hasMethods(pages, ['put', 'get'])],
      ['bundles', StagingWorkspaceRegistry.#hasMethods(bundles, ['put', 'putOrdered'])],
      ['resolveHandle', typeof resolveHandle === 'function'],
      ['crypto', StagingWorkspaceRegistry.#hasMethods(crypto, ['randomBytes'])],
      ['clock', StagingWorkspaceRegistry.#hasMethods(clock, ['now'])],
      ['descriptorCodec', StagingWorkspaceRegistry.#hasMethods(descriptorCodec, ['encode', 'decode'])],
    ];
    const missing = dependencies.filter(([, valid]) => !valid).map(([name]) => name);
    if (missing.length > 0) {
      throw createCasError(
        'StagingWorkspaceRegistry requires complete dependencies',
        ErrorCodes.INVALID_OPTIONS,
        { missing },
      );
    }
  }

  static #hasMethods(value, methods) {
    return value && methods.every((method) => typeof value[method] === 'function');
  }

  static #assertDirectRef(record) {
    if (record.symref !== null) {
      throw createCasError(
        'Workspace ref must be direct',
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { ref: record.ref, symref: record.symref },
      );
    }
  }

  static #assertObservedGeneration(record, state) {
    if (state.headOid !== record.oid) {
      throw createCasError(
        'Workspace ref changed during inspection',
        ErrorCodes.WORKSPACE_CONFLICT,
        { ref: record.ref, expectedHeadOid: record.oid, actualHeadOid: state.headOid },
      );
    }
  }

  static #assertTargetCount(record, descriptor, targets) {
    if (targets.length !== descriptor.targetCount) {
      throw createCasError(
        'Workspace descriptor target count does not match its generation',
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { ref: record.ref, expected: descriptor.targetCount, actual: targets.length },
      );
    }
  }

  static #targetHandle(record, target) {
    if (typeof target.name !== 'string' || !target.name.startsWith(TARGET_ENTRY_PREFIX)) {
      throw StagingWorkspaceRegistry.#invalidTarget({
        record,
        target,
        message: 'Workspace target entry is missing its canonical name prefix',
      });
    }
    let handle;
    try {
      handle = parseApplicationHandle(target.name.slice(TARGET_ENTRY_PREFIX.length));
    } catch (error) {
      throw StagingWorkspaceRegistry.#invalidTarget({
        record,
        target,
        message: 'Workspace target entry contains an invalid application handle',
        meta: { originalError: error },
      });
    }
    if (`${TARGET_ENTRY_PREFIX}${handle.toString()}` !== target.name) {
      throw StagingWorkspaceRegistry.#invalidTarget({
        record,
        target,
        message: 'Workspace target entry name is not canonical',
        meta: { handle: handle.toString() },
      });
    }
    return handle;
  }

  static #resolvedHandle({ record, target, handle, resolved }) {
    try {
      return parseApplicationHandle(resolved?.handle ?? handle);
    } catch (error) {
      throw StagingWorkspaceRegistry.#invalidTarget({
        record,
        target,
        message: 'Workspace handle resolver returned an invalid handle',
        meta: { originalError: error },
      });
    }
  }

  static #assertResolvedTarget({ record, target, handle, resolved, resolvedHandle }) {
    const expectedType = TARGET_ROOT_TYPES[handle.kind];
    const mismatch = [
      !resolved,
      resolvedHandle.toString() !== handle.toString(),
      resolved?.oid !== handle.oid,
      target.oid !== handle.oid,
      resolved?.type !== expectedType,
      target.type !== expectedType,
    ].some(Boolean);
    if (mismatch) {
      throw StagingWorkspaceRegistry.#invalidTarget({
        record,
        target,
        message: 'Workspace target does not match its typed application handle',
        meta: {
          handle: handle.toString(),
          expectedType,
          resolvedHandle: resolvedHandle.toString(),
          resolvedOid: resolved?.oid,
          resolvedType: resolved?.type,
        },
      });
    }
  }

  static #addBytes({ total, value, label, ref }) {
    StagingWorkspaceRegistry.#assertByteCount(
      value,
      `Workspace ${label} value is invalid`,
      { ref, value },
    );
    const result = total + value;
    StagingWorkspaceRegistry.#assertByteCount(
      result,
      `Workspace ${label} total exceeds supported bounds`,
      { ref, total, value },
    );
    return result;
  }

  static #assertByteCount(value, message, meta) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw createCasError(message, ErrorCodes.WORKSPACE_STATE_INVALID, meta);
    }
  }

  static #invalidTarget({ record, target, message, meta = {} }) {
    return createCasError(message, ErrorCodes.WORKSPACE_STATE_INVALID, {
      ref: record.ref,
      target,
      ...meta,
    });
  }

  static #invalidRecord(record, workspaceRef, error) {
    return Object.freeze({
      id: workspaceRef?.id ?? null,
      namespace: workspaceRef?.namespace ?? null,
      ref: record.ref,
      generation: record.oid,
      symref: record.symref,
      rootCount: null,
      logicalBytes: null,
      rootObjectBytes: null,
      createdAt: workspaceRef?.createdAt ?? null,
      ageMs: null,
      expiresAt: null,
      posture: 'invalid',
      issue: Object.freeze({
        code: error?.code ?? ErrorCodes.WORKSPACE_STATE_INVALID,
        message: error instanceof Error ? error.message : String(error),
      }),
    });
  }
}
