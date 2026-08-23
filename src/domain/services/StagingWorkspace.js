import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import parseApplicationHandle from '../value-objects/ApplicationHandle.js';
import RetentionWitness from '../value-objects/RetentionWitness.js';
import WorkspaceRef from '../value-objects/WorkspaceRef.js';
import RootSetMetadataCodec from './RootSetMetadataCodec.js';
import {
  MAX_WORKSPACE_TARGETS,
  WORKSPACE_DESCRIPTOR_ENTRY,
} from './WorkspaceDescriptorCodec.js';

const TARGET_ENTRY_PREFIX = 'target:';
const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });

/** Resource scope that retains every returned staged handle until promotion or release. */
export default class StagingWorkspace {
  #assets;
  #bundles;
  #clock;
  #descriptorCodec;
  #expiresAt = null;
  #generation = null;
  #pages;
  #publications;
  #refs;
  #released = false;
  #resolveHandle;
  #rootSet;
  #tail = Promise.resolve();
  #targets = new Map();
  #ttlMs;
  #workspaceRef;

  constructor({ workspaceRef, ttlMs, rootSet, refs, assets, pages, bundles, publications,
    resolveHandle, descriptorCodec, clock = DEFAULT_CLOCK }) {
    StagingWorkspace.#assertDependencies({
      rootSet,
      refs,
      assets,
      pages,
      bundles,
      resolveHandle,
      descriptorCodec,
      clock,
    });
    this.#workspaceRef = WorkspaceRef.from(workspaceRef);
    this.#ttlMs = ttlMs;
    this.#rootSet = rootSet;
    this.#refs = refs;
    this.#assets = assets;
    this.#pages = pages;
    this.#bundles = bundles;
    this.#publications = publications;
    this.#resolveHandle = resolveHandle;
    this.#descriptorCodec = descriptorCodec;
    this.#clock = clock;

    this.assets = Object.freeze({
      put: (options) => this.#enqueue(() => this.#stage(this.#assets, 'put', options)),
      adopt: (options) => this.#enqueue(() => this.#stage(this.#assets, 'adopt', options)),
    });
    this.pages = Object.freeze({
      put: (options) => this.#enqueue(() => this.#stage(this.#pages, 'put', options)),
      putBatch: (options) => this.#stagePageBatch(options),
    });
    this.bundles = Object.freeze({
      put: (options) => this.#enqueue(() => this.#stage(this.#bundles, 'put', options)),
      putOrdered: (options) => (
        this.#enqueue(() => this.#stage(this.#bundles, 'putOrdered', options))
      ),
    });
    Object.freeze(this);
  }

  get id() {
    return this.#workspaceRef.id;
  }

  get namespace() {
    return this.#workspaceRef.namespace;
  }

  get createdAt() {
    return this.#workspaceRef.createdAt;
  }

  get expiresAt() {
    return this.#expiresAt;
  }

  checkpoint({ handles }) {
    return this.#enqueue(async () => {
      this.#assertActive();
      const targets = await this.#resolveTargets(handles);
      return await this.#install(targets);
    });
  }

  renew() {
    return this.#enqueue(async () => {
      this.#assertActive();
      return await this.#install([...this.#targets.values()]);
    });
  }

  promoteToCache({ cache, key, handle, options = {} }) {
    return this.#enqueue(async () => {
      this.#assertActive();
      if (!cache || typeof cache.put !== 'function' || typeof cache.ref !== 'string') {
        throw createCasError(
          'Workspace cache promotion requires a CacheSet with ref and put()',
          ErrorCodes.INVALID_OPTIONS,
        );
      }
      const target = this.#retainedTarget(handle);
      await this.#install([...this.#targets.values()]);
      const destination = await cache.put(key, target.handle, options);
      this.#assertPromotionDestination({
        destination,
        target,
        operation: 'cache',
        rootKind: 'cache-set',
        ref: cache.ref,
        generation: destination?.generation,
        confirmed: destination?.accepted === true,
      });
      return await this.#finishPromotion(destination);
    });
  }

  promoteToPublication({ handle, commit, ref }) {
    return this.#enqueue(async () => {
      this.#assertActive();
      if (!this.#publications || typeof this.#publications.commit !== 'function') {
        throw createCasError(
          'Workspace publication promotion is unavailable',
          ErrorCodes.INVALID_OPTIONS,
        );
      }
      const target = this.#retainedTarget(handle);
      await this.#install([...this.#targets.values()]);
      const destination = await this.#publications.commit({
        root: target.handle,
        commit,
        ref,
      });
      this.#assertPromotionDestination({
        destination,
        target,
        operation: 'publication',
        rootKind: 'publication',
        ref: ref.name,
        generation: destination?.commitId,
        confirmed: destination?.operation === 'publication',
      });
      return await this.#finishPromotion(destination);
    });
  }

  release() {
    return this.#enqueue(() => this.#releaseExact());
  }

  async #stage(service, method, options) {
    this.#assertActive();
    const staged = await service[method](options);
    if (!staged?.handle) {
      throw createCasError(
        `Workspace ${method}() did not return a staged handle`,
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { method },
      );
    }
    try {
      const target = await this.#resolveTarget(staged.handle);
      const targets = new Map(this.#targets);
      targets.set(target.handle.toString(), target);
      const installation = await this.#install([...targets.values()]);
      const witness = installation.witnesses.find(
        (candidate) => candidate.handle.toString() === target.handle.toString(),
      );
      if (!witness) {
        throw createCasError(
          'Workspace generation omitted the newly staged handle',
          ErrorCodes.WORKSPACE_STATE_INVALID,
          { handle: target.handle.toString(), generation: installation.generation },
        );
      }
      return StagingWorkspace.#retainedStage(staged, witness);
    } catch (error) {
      if (error?.code === ErrorCodes.WORKSPACE_TTL_INVALID) {
        throw error;
      }
      throw createCasError(
        'Workspace staged an object but could not establish retention',
        ErrorCodes.WORKSPACE_RETENTION_FAILED,
        {
          method,
          workspaceId: this.id,
          staged: typeof staged.toJSON === 'function'
            ? staged.toJSON()
            : { handle: staged.handle.toString() },
          originalError: error,
        },
      );
    }
  }

  async #stageBatch(service, method, options) {
    this.#assertActive();
    const staged = await service[method](options);
    if (!Array.isArray(staged) || staged.some((page) => !page?.handle)) {
      throw createCasError(
        `Workspace ${method}() did not return staged handles`,
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { method },
      );
    }
    if (staged.length === 0) {
      return Object.freeze([]);
    }
    try {
      return await this.#retainBatch(staged);
    } catch (error) {
      if (error?.code === ErrorCodes.WORKSPACE_TTL_INVALID) {
        throw error;
      }
      throw createCasError(
        'Workspace staged a batch but could not establish retention',
        ErrorCodes.WORKSPACE_RETENTION_FAILED,
        {
          method,
          workspaceId: this.id,
          stagedCount: staged.length,
          originalError: error,
        },
      );
    }
  }

  #stagePageBatch(options) {
    return this.#enqueue(() => this.#stageBatch(this.#pages, 'putBatch', options));
  }

  async #retainBatch(staged) {
    const resolved = [];
    const targets = new Map(this.#targets);
    for (const page of staged) {
      const target = await this.#resolveTarget(page.handle);
      resolved.push(target);
      targets.set(target.handle.toString(), target);
    }
    const installation = await this.#install([...targets.values()]);
    const witnesses = new Map(
      installation.witnesses.map((witness) => [witness.handle.toString(), witness]),
    );
    return Object.freeze(staged.map((page, index) => {
      const handle = resolved[index].handle.toString();
      const witness = witnesses.get(handle);
      if (!witness) {
        throw createCasError(
          'Workspace generation omitted a newly staged batch handle',
          ErrorCodes.WORKSPACE_STATE_INVALID,
          { handle, generation: installation.generation },
        );
      }
      return StagingWorkspace.#retainedStage(page, witness);
    }));
  }

  async #install(targets) {
    if (targets.length > MAX_WORKSPACE_TARGETS) {
      throw createCasError(
        'Workspace target count exceeds the supported maximum',
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { targetCount: targets.length, maxTargetCount: MAX_WORKSPACE_TARGETS },
      );
    }
    const observedAt = this.#observedAt();
    const expiresAt = this.#expiryFrom(observedAt);
    const descriptor = await this.#pages.put({
      source: this.#descriptorCodec.encode({
        ref: this.#workspaceRef.toString(),
        createdAt: this.#workspaceRef.createdAt,
        expiresAt,
        targetCount: targets.length,
      }),
    });
    const entries = [
      {
        name: WORKSPACE_DESCRIPTOR_ENTRY,
        oid: descriptor.handle.oid,
        type: 'blob',
        retention: 'evictable',
      },
      ...targets.map(StagingWorkspace.#targetEntry),
    ];
    const mutation = await this.#rootSet.replaceExact({
      entries,
      expectedHeadOid: this.#generation,
    });
    this.#generation = mutation.commitOid;
    this.#expiresAt = expiresAt;
    this.#targets = new Map(targets.map((target) => [target.handle.toString(), target]));
    const witnesses = targets.map((target) => this.#witness({
      target,
      entries: mutation.entries,
      observedAt,
    }));
    return Object.freeze({
      changed: mutation.changed,
      ref: this.#workspaceRef.toString(),
      generation: mutation.commitOid,
      expiresAt,
      handles: Object.freeze(targets.map((target) => target.handle)),
      witnesses: Object.freeze(witnesses),
    });
  }

  #witness({ target, entries, observedAt }) {
    const name = StagingWorkspace.#targetName(target.handle);
    const index = entries.findIndex((entry) => entry.name === name);
    if (index === -1) {
      throw createCasError(
        'Workspace target is absent from its committed generation',
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { handle: target.handle.toString(), generation: this.#generation },
      );
    }
    return new RetentionWitness({
      handle: target.handle,
      policy: 'evictable',
      reachability: 'anchored',
      root: {
        kind: 'root-set',
        namespace: this.#workspaceRef.namespace,
        ref: this.#workspaceRef.toString(),
        generation: this.#generation,
        path: RootSetMetadataCodec.slotFor(index),
      },
      observedAt,
    });
  }

  async #resolveTargets(handles) {
    if (!handles || typeof handles[Symbol.iterator] !== 'function') {
      throw createCasError(
        'Workspace checkpoint handles must be iterable',
        ErrorCodes.INVALID_OPTIONS,
        { handles },
      );
    }
    const targets = new Map();
    let handleCount = 0;
    for (const value of handles) {
      handleCount += 1;
      if (handleCount > MAX_WORKSPACE_TARGETS) {
        throw createCasError(
          'Workspace checkpoint handle count exceeds the supported maximum',
          ErrorCodes.INVALID_OPTIONS,
          { handleCount, maxHandleCount: MAX_WORKSPACE_TARGETS },
        );
      }
      const handle = parseApplicationHandle(value);
      if (targets.has(handle.toString())) {
        continue;
      }
      const target = await this.#resolveTarget(handle);
      targets.set(target.handle.toString(), target);
    }
    return [...targets.values()].sort(StagingWorkspace.#compareTargets);
  }

  async #resolveTarget(value) {
    const handle = parseApplicationHandle(value);
    const resolved = await this.#resolveHandle(handle);
    const resolvedHandle = parseApplicationHandle(resolved?.handle ?? handle);
    if (resolvedHandle.toString() !== handle.toString()) {
      throw createCasError(
        'Workspace handle resolver changed the requested handle',
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { requested: handle.toString(), resolved: resolvedHandle.toString() },
      );
    }
    if (!resolved || resolved.oid !== handle.oid || !['blob', 'tree'].includes(resolved.type)) {
      throw createCasError(
        'Workspace handle resolver returned an invalid Git root',
        ErrorCodes.WORKSPACE_STATE_INVALID,
        { handle: handle.toString(), resolved },
      );
    }
    return Object.freeze({ handle, oid: resolved.oid, type: resolved.type });
  }

  #retainedTarget(value) {
    const handle = parseApplicationHandle(value);
    const target = this.#targets.get(handle.toString());
    if (!target) {
      throw createCasError(
        'Workspace can promote only a handle retained by its active generation',
        ErrorCodes.WORKSPACE_HANDLE_NOT_RETAINED,
        { handle: handle.toString(), workspaceId: this.id },
      );
    }
    return target;
  }

  #assertPromotionDestination({
    destination,
    target,
    operation,
    rootKind,
    ref,
    generation,
    confirmed,
  }) {
    let witness = null;
    let originalError = null;
    try {
      witness = new RetentionWitness(destination?.witness);
    } catch (error) {
      originalError = error;
    }
    const retained = confirmed
      && witness?.handle.toString() === target.handle.toString()
      && witness.reachability === 'anchored'
      && witness.root.kind === rootKind
      && witness.root.ref === ref
      && witness.root.generation === generation;
    if (!retained) {
      throw createCasError(
        'Workspace promotion destination did not prove retention of the requested handle',
        ErrorCodes.WORKSPACE_PROMOTION_NOT_RETAINED,
        {
          operation,
          workspaceId: this.id,
          handle: target.handle.toString(),
          destinationRef: ref,
          destinationGeneration: generation,
          originalError,
        },
      );
    }
  }

  async #finishPromotion(destination) {
    try {
      const release = await this.#releaseExact();
      return Object.freeze({ destination, release });
    } catch (error) {
      throw createCasError(
        'Workspace destination was retained but temporary cleanup remains pending',
        ErrorCodes.WORKSPACE_PROMOTION_CLEANUP_PENDING,
        { destination, workspaceId: this.id, originalError: error },
      );
    }
  }

  async #releaseExact() {
    if (this.#released) {
      return Object.freeze({
        changed: false,
        ref: this.#workspaceRef.toString(),
        generation: null,
      });
    }
    if (this.#generation === null) {
      this.#released = true;
      return Object.freeze({
        changed: false,
        ref: this.#workspaceRef.toString(),
        generation: null,
      });
    }
    const generation = this.#generation;
    const changed = await this.#refs.deleteRef({
      ref: this.#workspaceRef.toString(),
      expectedOldOid: generation,
    });
    this.#released = true;
    this.#generation = null;
    this.#targets = new Map();
    this.#expiresAt = null;
    return Object.freeze({
      changed,
      ref: this.#workspaceRef.toString(),
      generation,
    });
  }

  #assertActive() {
    if (this.#released) {
      throw createCasError(
        'Workspace has already been released',
        ErrorCodes.WORKSPACE_RELEASED,
        { workspaceId: this.id },
      );
    }
  }

  #observedAt() {
    const now = this.#clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw createCasError(
        'Workspace clock returned an invalid Date',
        ErrorCodes.INVALID_OPTIONS,
      );
    }
    return now.toISOString();
  }

  #expiryFrom(observedAt) {
    const expiresAt = new Date(Date.parse(observedAt) + this.#ttlMs);
    if (Number.isNaN(expiresAt.getTime())) {
      throw createCasError(
        'Workspace expiry is outside the supported timestamp range',
        ErrorCodes.WORKSPACE_TTL_INVALID,
        { observedAt, ttlMs: this.#ttlMs },
      );
    }
    return expiresAt.toISOString();
  }

  #enqueue(operation) {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  static #targetName(handle) {
    return `${TARGET_ENTRY_PREFIX}${handle.toString()}`;
  }

  static #targetEntry(target) {
    return {
      name: StagingWorkspace.#targetName(target.handle),
      oid: target.oid,
      type: target.type,
      retention: 'evictable',
    };
  }

  static #compareTargets(left, right) {
    return left.handle.toString().localeCompare(right.handle.toString());
  }

  static #retainedStage(staged, witness) {
    const retention = Object.freeze({
      policy: 'evictable',
      reachability: 'anchored',
      protection: 'workspace',
    });
    return Object.freeze({
      ...staged,
      state: 'retained',
      retention,
      witness,
      toJSON() {
        return {
          ...staged.toJSON(),
          state: 'retained',
          retention: { ...retention },
          witness: witness.toJSON(),
        };
      },
    });
  }

  static #assertDependencies({ rootSet, refs, assets, pages, bundles, resolveHandle,
    descriptorCodec, clock }) {
    const missing = [
      ['rootSet', StagingWorkspace.#hasMethods(rootSet, ['replaceExact'])],
      ['refs', StagingWorkspace.#hasMethods(refs, ['deleteRef'])],
      ['assets', StagingWorkspace.#hasMethods(assets, ['put', 'adopt'])],
      ['pages', StagingWorkspace.#hasMethods(pages, ['put', 'putBatch'])],
      ['bundles', StagingWorkspace.#hasMethods(bundles, ['put', 'putOrdered'])],
      ['resolveHandle', typeof resolveHandle === 'function'],
      ['descriptorCodec', StagingWorkspace.#hasMethods(descriptorCodec, ['encode'])],
      ['clock', StagingWorkspace.#hasMethods(clock, ['now'])],
    ].filter(([, valid]) => !valid).map(([name]) => name);
    if (missing.length > 0) {
      throw createCasError(
        'StagingWorkspace requires complete dependencies',
        ErrorCodes.INVALID_OPTIONS,
        { missing },
      );
    }
  }

  static #hasMethods(value, methods) {
    return value && methods.every((method) => typeof value[method] === 'function');
  }
}
