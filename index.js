/* @ts-self-types="./index.d.ts" */
/**
 * @fileoverview Content Addressable Store - Managed blob storage in Git.
 */

// ---------------------------------------------------------------------------
// Imports used in the class body
// ---------------------------------------------------------------------------
import CasService from './src/domain/services/CasService.js';
import VaultService from './src/domain/services/VaultService.js';
import RootSet from './src/domain/services/RootSet.js';
import RootSetRegistry from './src/domain/services/RootSetRegistry.js';
import AssetService from './src/domain/services/AssetService.js';
import BundleService from './src/domain/services/BundleService.js';
import CacheSet from './src/domain/services/CacheSet.js';
import CacheSetRegistry from './src/domain/services/CacheSetRegistry.js';
import ExpiringSet from './src/domain/services/ExpiringSet.js';
import ExpiringSetRegistry from './src/domain/services/ExpiringSetRegistry.js';
import StagingWorkspace from './src/domain/services/StagingWorkspace.js';
import StagingWorkspaceRegistry from './src/domain/services/StagingWorkspaceRegistry.js';
import RepositoryDoctor from './src/domain/services/RepositoryDoctor.js';
import PageService from './src/domain/services/PageService.js';
import PublicationService from './src/domain/services/PublicationService.js';
import RetentionService from './src/domain/services/RetentionService.js';
import rotateVaultPassphrase from './src/domain/services/rotateVaultPassphrase.js';
import GitPersistenceAdapter from './src/infrastructure/adapters/GitPersistenceAdapter.js';
import GitRefAdapter from './src/infrastructure/adapters/GitRefAdapter.js';
import GitRepositoryInspectionAdapter from './src/infrastructure/adapters/GitRepositoryInspectionAdapter.js';
import createCryptoAdapter from './src/infrastructure/adapters/createCryptoAdapter.js';
import { createGitPlumbing } from './src/infrastructure/createGitPlumbing.js';
import { storeFile, restoreFile } from './src/infrastructure/adapters/FileIOHelper.js';
import JsonCodec from './src/infrastructure/codecs/JsonCodec.js';
import CborCodec from './src/infrastructure/codecs/CborCodec.js';
import SilentObserver from './src/infrastructure/adapters/SilentObserver.js';
import resolveChunker from './src/infrastructure/chunkers/resolveChunker.js';
import { CasError, createCasError, ErrorCodes } from './src/domain/errors/index.js';
import FixedChunker from './src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from './src/infrastructure/adapters/NodeCompressionAdapter.js';
import { PACKAGE_VERSION } from './src/package-version.js';
import parseApplicationHandle from './src/domain/value-objects/ApplicationHandle.js';

/** @typedef {import('./src/domain/value-objects/Manifest.js').default} Manifest */

const PKG_VERSION = PACKAGE_VERSION;
const FIXED_CHUNKING_STRATEGY = 'fixed';
const MAX_VALIDATION_CACHE_ENTRIES = 1024;
const RESTORE_FILE_DOCS_URL = `https://github.com/git-stunts/git-cas/blob/v${PKG_VERSION}/docs/API.md#restorefile`;

function withOperationChunker(options) {
  const { chunking, ...rest } = options;
  if (!chunking) {
    return rest;
  }
  const chunker = resolveChunker({ chunking });
  if (chunker) {
    return { ...rest, chunker };
  }
  if (chunking.strategy === FIXED_CHUNKING_STRATEGY && chunking.chunkSize === undefined) {
    return { ...rest, chunker: new FixedChunker() };
  }
  return rest;
}

// ---------------------------------------------------------------------------
// Re-exports — modules used in the class body
// ---------------------------------------------------------------------------
export {
  CasService,
  VaultService,
  RootSet,
  RootSetRegistry,
  CacheSet,
  ExpiringSet,
  StagingWorkspace,
  RepositoryDoctor,
  GitPersistenceAdapter,
  GitRefAdapter,
  GitRepositoryInspectionAdapter,
  JsonCodec,
  CborCodec,
  SilentObserver,
  CasError,
};

// ---------------------------------------------------------------------------
// Re-exports — barrel-only (no local binding needed)
// ---------------------------------------------------------------------------
export { default as NodeCryptoAdapter } from './src/infrastructure/adapters/NodeCryptoAdapter.js';
export { default as CryptoPort } from './src/ports/CryptoPort.js';
export { default as ChunkingPort } from './src/ports/ChunkingPort.js';
export { default as ObservabilityPort } from './src/ports/ObservabilityPort.js';
export { default as Manifest } from './src/domain/value-objects/Manifest.js';
export { default as Chunk } from './src/domain/value-objects/Chunk.js';
export { default as AssetHandle } from './src/domain/value-objects/AssetHandle.js';
export { default as BundleHandle } from './src/domain/value-objects/BundleHandle.js';
export { default as PageHandle } from './src/domain/value-objects/PageHandle.js';
export { default as StagedAsset } from './src/domain/value-objects/StagedAsset.js';
export { default as StagedBundle } from './src/domain/value-objects/StagedBundle.js';
export { default as StagedPage } from './src/domain/value-objects/StagedPage.js';
export { default as RetentionWitness } from './src/domain/value-objects/RetentionWitness.js';
export { default as CacheHit } from './src/domain/value-objects/CacheHit.js';
export { default as CachePolicy } from './src/domain/value-objects/CachePolicy.js';
export { default as ExpiringMarker } from './src/domain/value-objects/ExpiringMarker.js';
export { default as EventEmitterObserver } from './src/infrastructure/adapters/EventEmitterObserver.js';
export { default as StatsCollector } from './src/infrastructure/adapters/StatsCollector.js';
export { default as FixedChunker } from './src/infrastructure/chunkers/FixedChunker.js';
export { default as CdcChunker } from './src/infrastructure/chunkers/CdcChunker.js';
export { default as CompressionPort } from './src/ports/CompressionPort.js';
export { default as RepositoryInspectionPort } from './src/ports/RepositoryInspectionPort.js';
export { default as NodeCompressionAdapter } from './src/infrastructure/adapters/NodeCompressionAdapter.js';
export { default as diffManifests } from './src/domain/services/ManifestDiff.js';
export { SCHEME_WHOLE, SCHEME_FRAMED, SCHEME_CONVERGENT } from './src/domain/encryption/schemes.js';

/**
 * High-level facade for the Content Addressable Store library.
 *
 * Wraps {@link CasService} and {@link VaultService} with lazy initialization,
 * runtime-adaptive crypto selection, and convenience helpers for file I/O.
 */
export default class ContentAddressableStore {
  /**
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance for Git operations.
   * @param {number} [options.chunkSize] - Chunk size in bytes (default 256 KiB).
   * @param {import('./src/ports/CodecPort.js').default} [options.codec] - Manifest codec (default JsonCodec).
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto] - Crypto adapter (auto-detected if omitted).
   * @param {import('./src/ports/ObservabilityPort.js').default} [options.observability] - Observability adapter (SilentObserver if omitted).
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy for Git I/O.
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number, normalized?: boolean }} [options.chunking] - Chunking strategy config.
   * @param {import('./src/ports/ChunkingPort.js').default} [options.chunker] - Pre-built ChunkingPort instance (advanced).
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max buffered restore size in bytes for encrypted/compressed restores (default 512 MiB).
   * @param {number} [options.maxBlobSize=10485760] - Safety limit for readBlob metadata in bytes (default 10 MiB).
   * @param {number} [options.maxPageSize=16777216] - Maximum immutable page size in bytes (default 16 MiB).
   * @param {number} [options.pageCacheEntries=128] - Maximum immutable page payloads retained in memory.
   * @param {number} [options.pageCacheBytes=8388608] - Maximum immutable page payload bytes retained in memory.
   * @param {object} [options.bundleLimits] - Repository-wide maximum bundle admission limits.
   * @param {number} [options.maxBundleNestingDepth=32] - Maximum nested bundle depth.
   * @param {import('./src/ports/CompressionPort.js').default} [options.compressionAdapter] - Compression adapter (default NodeCompressionAdapter).
   * @param {string[]} [options.applicationRefPrefixes] - Explicit application ref namespaces allowed for generic publication.
   * @param {{ now(): Date }} [options.clock] - Injectable clock for deterministic evidence.
   */
  constructor({
    plumbing,
    chunkSize,
    codec,
    policy,
    crypto,
    observability,
    merkleThreshold,
    concurrency,
    chunking,
    chunker,
    maxRestoreBufferSize,
    maxBlobSize,
    maxPageSize,
    pageCacheEntries,
    pageCacheBytes,
    bundleLimits,
    maxBundleNestingDepth,
    compressionAdapter,
    applicationRefPrefixes,
    clock,
  }) {
    this.#config = {
      plumbing,
      chunkSize,
      codec,
      policy,
      crypto,
      observability,
      merkleThreshold,
      concurrency,
      chunking,
      chunker,
      maxRestoreBufferSize,
      maxBlobSize,
      maxPageSize,
      pageCacheEntries,
      pageCacheBytes,
      bundleLimits,
      maxBundleNestingDepth,
      compressionAdapter,
      applicationRefPrefixes,
      clock,
    };
    this.service = null;
    this.#servicePromise = null;
    this.#installCapabilities();
  }

  #installCapabilities() {
    this.rootSets = Object.freeze({
      open: async (options) => (await this.#getRootSetRegistry()).open(options),
    });
    this.caches = Object.freeze({
      open: async (options) => (await this.#getCacheSetRegistry()).open(options),
    });
    this.expiringSets = Object.freeze({
      open: async (options) => (await this.#getExpiringSetRegistry()).open(options),
    });
    this.workspaces = Object.freeze({
      open: async (options) => (await this.#getStagingWorkspaceRegistry()).open(options),
      inspect: async (options) => (await this.#getStagingWorkspaceRegistry()).inspect(options),
      sweep: async (options) => (await this.#getStagingWorkspaceRegistry()).sweep(options),
    });
    this.diagnostics = Object.freeze({
      doctor: async (options) => (await this.#getRepositoryDoctor()).doctor(options),
    });
    this.assets = Object.freeze({
      put: async (options) => (await this.#getAssetService()).put(options),
      adopt: async (options) => (await this.#getAssetService()).adopt(options),
      open: (options) => this.#openAsset(options),
    });
    this.pages = Object.freeze({
      put: async (options) => (await this.#getPageService()).put(options),
      putBatch: async (options) => (await this.#getPageService()).putBatch(options),
      get: async (options) => (await this.#getPageService()).get(options),
      open: (options) => this.#openPage(options),
    });
    this.bundles = Object.freeze({
      put: async (options) => (await this.#getBundleService()).put(options),
      putOrdered: async (options) => (await this.#getBundleService()).putOrdered(options),
      getMember: async (options) => (await this.#getBundleService()).getMember(options),
      getMemberReference: async (options) => (
        await this.#getBundleService()
      ).getMemberReference(options),
      iterateMembers: (options) => this.#iterateBundleMembers(options),
      iterateMemberReferences: (options) => this.#iterateBundleMemberReferences(options),
      openMember: (options) => this.#openBundleMember(options),
    });
    this.retention = Object.freeze({
      retain: async (options) => (await this.#getRetentionService()).retain(options),
    });
    this.publications = Object.freeze({
      commit: async (options) => (await this.#getPublicationService()).commit(options),
    });
  }

  /** @type {{ plumbing: *, chunkSize?: number, codec?: *, policy?: *, crypto?: *, observability?: *, merkleThreshold?: number, concurrency?: number, chunking?: *, chunker?: *, maxRestoreBufferSize?: number, maxBlobSize?: number, maxPageSize?: number, pageCacheEntries?: number, pageCacheBytes?: number, bundleLimits?: object, maxBundleNestingDepth?: number, compressionAdapter?: *, applicationRefPrefixes?: string[], clock?: { now(): Date } }} */
  #config;
  /** @type {AssetService|null} */
  #assetService = null;
  /** @type {BundleService|null} */
  #bundleService = null;
  /** @type {PageService|null} */
  #pageService = null;
  /** @type {PublicationService|null} */
  #publicationService = null;
  /** @type {RetentionService|null} */
  #retentionService = null;
  /** @type {VaultService|null} */
  #vault = null;
  /** @type {RootSetRegistry|null} */
  #rootSetRegistry = null;
  /** @type {CacheSetRegistry|null} */
  #cacheSetRegistry = null;
  /** @type {ExpiringSetRegistry|null} */
  #expiringSetRegistry = null;
  /** @type {StagingWorkspaceRegistry|null} */
  #stagingWorkspaceRegistry = null;
  /** @type {RepositoryDoctor|null} */
  #repositoryDoctor = null;
  #closePromise = null;
  #closed = false;
  #servicePromise = null;

  /**
   * Lazily initializes the service, handling async adapter discovery.
   * @private
   * @returns {Promise<CasService>}
   */
  async #getService() {
    this.#assertOpen();
    if (!this.#servicePromise) {
      this.#servicePromise = this.#initService();
    }
    return await this.#servicePromise;
  }

  /**
   * Constructs adapters, resolves crypto, and creates CasService + VaultService.
   * @private
   * @returns {Promise<CasService>}
   */
  async #initService() {
    const cfg = this.#config;
    const persistence = new GitPersistenceAdapter({
      plumbing: cfg.plumbing,
      policy: cfg.policy,
    });
    const crypto = cfg.crypto || (await createCryptoAdapter());
    const chunkSize = cfg.chunkSize || 256 * 1024;
    const chunker =
      resolveChunker({ chunker: cfg.chunker, chunking: cfg.chunking }) ||
      new FixedChunker({ chunkSize });
    this.service = new CasService({
      persistence,
      chunkSize,
      codec: cfg.codec || new JsonCodec(),
      crypto,
      observability: cfg.observability || new SilentObserver(),
      merkleThreshold: cfg.merkleThreshold,
      concurrency: cfg.concurrency,
      chunker,
      maxRestoreBufferSize: cfg.maxRestoreBufferSize,
      maxBlobSize: cfg.maxBlobSize,
      compressionAdapter: cfg.compressionAdapter || new NodeCompressionAdapter(),
      formatVersion: PKG_VERSION,
    });

    const ref = new GitRefAdapter({
      plumbing: cfg.plumbing,
      policy: cfg.policy,
    });
    this.#vault = new VaultService({
      persistence,
      ref,
      crypto,
      observability: this.service.observability,
    });
    this.#rootSetRegistry = new RootSetRegistry({ persistence, ref });
    this.#initApplicationServices({ ref, cfg });
    this.#initCollectionServices({ persistence, ref, crypto, cfg });

    return this.service;
  }

  #initRepositoryDoctor() {
    const cfg = this.#config;
    this.#repositoryDoctor = new RepositoryDoctor({
      repository: new GitRepositoryInspectionAdapter({
        plumbing: cfg.plumbing,
        policy: cfg.policy,
      }),
      rootSets: this.#rootSetRegistry,
      caches: this.#cacheSetRegistry,
      expiringSets: this.#expiringSetRegistry,
      workspaces: this.#stagingWorkspaceRegistry,
      vault: this.#vault,
      clock: cfg.clock,
    });
  }

  #initCollectionServices({ persistence, ref, crypto, cfg }) {
    this.#cacheSetRegistry = new CacheSetRegistry({
      persistence,
      ref,
      bundles: this.#bundleService,
      pages: this.#pageService,
      resolveHandle: (handle) => this.#resolveApplicationRoot(handle),
      crypto,
      clock: cfg.clock,
    });
    this.#expiringSetRegistry = new ExpiringSetRegistry({
      persistence,
      ref,
      bundles: this.#bundleService,
      pages: this.#pageService,
      crypto,
      clock: cfg.clock,
    });
    this.#stagingWorkspaceRegistry = new StagingWorkspaceRegistry({
      persistence,
      ref,
      assets: this.#assetService,
      pages: this.#pageService,
      bundles: this.#bundleService,
      publications: this.#publicationService,
      resolveHandle: (handle) => this.#resolveApplicationRoot(handle),
      crypto,
      clock: cfg.clock,
    });
  }

  #initApplicationServices({ ref, cfg }) {
    this.#assetService = new AssetService({ cas: this.service, clock: cfg.clock });
    this.#pageService = new PageService({
      persistence: this.service.persistence,
      maxPageSize: cfg.maxPageSize,
      pageCacheEntries: cfg.pageCacheEntries,
      pageCacheBytes: cfg.pageCacheBytes,
      clock: cfg.clock,
    });
    this.#bundleService = new BundleService({
      persistence: this.service.persistence,
      codec: this.service.codec,
      pages: this.#pageService,
      resolveHandle: (handle, context) => this.#resolveApplicationRoot(handle, context),
      openHandle: (handle) => this.#openApplicationHandle(handle),
      limits: cfg.bundleLimits,
      maxNestingDepth: cfg.maxBundleNestingDepth,
      clock: cfg.clock,
    });
    const resolveRoot = (handle) => this.#resolveApplicationRoot(handle);
    this.#retentionService = new RetentionService({
      rootSets: this.#rootSetRegistry,
      resolveRoot,
      clock: cfg.clock,
    });
    this.#publicationService = new PublicationService({
      ref,
      resolveRoot: (handle) => this.#resolvePublicationRoot(handle),
      applicationRefPrefixes: cfg.applicationRefPrefixes,
      clock: cfg.clock,
    });
  }

  /**
   * Lazily initializes and returns the underlying {@link VaultService}.
   * @private
   * @returns {Promise<VaultService>}
   */
  async #getVault() {
    await this.#getService();
    return this.#vault;
  }

  /**
   * Lazily initializes and returns the root-set registry.
   * @private
   * @returns {Promise<RootSetRegistry>}
   */
  async #getRootSetRegistry() {
    await this.#getService();
    return this.#rootSetRegistry;
  }

  /** @returns {Promise<CacheSetRegistry>} */
  async #getCacheSetRegistry() {
    await this.#getService();
    return this.#cacheSetRegistry;
  }

  /** @returns {Promise<ExpiringSetRegistry>} */
  async #getExpiringSetRegistry() {
    await this.#getService();
    return this.#expiringSetRegistry;
  }

  /** @returns {Promise<StagingWorkspaceRegistry>} */
  async #getStagingWorkspaceRegistry() {
    await this.#getService();
    return this.#stagingWorkspaceRegistry;
  }

  /** @returns {Promise<RepositoryDoctor>} */
  async #getRepositoryDoctor() {
    await this.#getService();
    if (this.#repositoryDoctor === null) {
      this.#initRepositoryDoctor();
    }
    return this.#repositoryDoctor;
  }

  /** @returns {Promise<AssetService>} */
  async #getAssetService() {
    await this.#getService();
    return this.#assetService;
  }

  /** @returns {Promise<PageService>} */
  async #getPageService() {
    await this.#getService();
    return this.#pageService;
  }

  /** @returns {Promise<BundleService>} */
  async #getBundleService() {
    await this.#getService();
    return this.#bundleService;
  }

  /** @returns {Promise<RetentionService>} */
  async #getRetentionService() {
    await this.#getService();
    return this.#retentionService;
  }

  /** @returns {Promise<PublicationService>} */
  async #getPublicationService() {
    await this.#getService();
    return this.#publicationService;
  }

  /** @returns {AsyncIterable<Uint8Array>} */
  async *#openAsset(options) {
    const assets = await this.#getAssetService();
    yield* assets.open(options);
  }

  /** @returns {AsyncIterable<Uint8Array>} */
  async *#openPage(options) {
    const pages = await this.#getPageService();
    yield* pages.open(options);
  }

  /** @returns {AsyncIterable<Uint8Array>} */
  async *#openBundleMember(options) {
    const bundles = await this.#getBundleService();
    yield* bundles.openMember(options);
  }

  /** @returns {AsyncIterable<object>} */
  async *#iterateBundleMemberReferences(options) {
    const bundles = await this.#getBundleService();
    yield* bundles.iterateMemberReferences(options);
  }

  /** @returns {AsyncIterable<object>} */
  async *#iterateBundleMembers(options) {
    const bundles = await this.#getBundleService();
    yield* bundles.iterateMembers(options);
  }

  async #resolveApplicationRoot(value, context = {}) {
    const handle = parseApplicationHandle(value);
    const validation = context.validation ?? { active: new Set(), cache: new Map() };
    const nestingDepth = context.nestingDepth ?? 0;
    const cacheKey = handle.kind === 'bundle'
      ? `${nestingDepth}:${handle.toString()}`
      : handle.toString();
    if (validation.cache.has(cacheKey)) {
      const cached = validation.cache.get(cacheKey);
      validation.cache.delete(cacheKey);
      validation.cache.set(cacheKey, cached);
      return cached;
    }
    if (validation.active.has(cacheKey)) {
      throw createCasError('Application handle graph contains a cycle', ErrorCodes.BUNDLE_CORRUPT, {
        handle: handle.toString(),
        nestingDepth,
      });
    }
    validation.active.add(cacheKey);
    try {
      let target;
      switch (handle.kind) {
        case 'asset':
          target = await this.#assetService.resolveRoot(handle);
          break;
        case 'page':
          target = await this.#pageService.resolveRoot(handle);
          break;
        case 'bundle':
          target = await this.#bundleService.resolveRoot(handle, { nestingDepth, validation });
          break;
        default:
          throw createCasError(
            'Unsupported application handle kind',
            ErrorCodes.HANDLE_KIND_MISMATCH,
            { kind: handle.kind }
          );
      }
      cacheApplicationTarget(validation.cache, cacheKey, target);
      return target;
    } finally {
      validation.active.delete(cacheKey);
    }
  }

  async *#openApplicationHandle(value) {
    const handle = parseApplicationHandle(value);
    if (handle.kind === 'asset') {
      yield* this.#assetService.open({ handle });
      return;
    }
    if (handle.kind === 'page') {
      yield* this.#pageService.open({ handle });
      return;
    }
    throw createCasError(
      'Structured bundle handles cannot be opened as byte streams',
      ErrorCodes.BUNDLE_MEMBER_NOT_STREAMABLE,
      { handle: handle.toString() }
    );
  }

  async #resolvePublicationRoot(value) {
    const target = await this.#resolveApplicationRoot(value);
    if (target.type === 'tree') {
      return target;
    }
    const oid = await this.service.persistence.writeTree([
      `100644 blob ${target.oid}\tpage`,
    ]);
    return Object.freeze({ ...target, oid, type: 'tree', publicationTargetOid: target.oid });
  }

  /**
   * Lazily initializes and returns the underlying {@link CasService}.
   * @returns {Promise<CasService>}
   */
  async getService() {
    return await this.#getService();
  }

  /**
   * Lazily initializes and returns the underlying {@link VaultService}.
   * @returns {Promise<VaultService>}
   */
  async getVaultService() {
    return await this.#getVault();
  }

  /**
   * Lazily initializes and returns the root-set registry.
   * @returns {Promise<RootSetRegistry>}
   */
  async getRootSetRegistry() {
    return await this.#getRootSetRegistry();
  }

  /**
   * Releases local adapter resources. This does not mutate stored objects,
   * refs, retention, or publication state.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#closePromise !== null) {
      return await this.#closePromise;
    }
    this.#closed = true;
    this.#closePromise = (async () => {
      if (this.#servicePromise === null) {
        return;
      }
      const service = await this.#servicePromise;
      await service.persistence.close();
    })();
    return await this.#closePromise;
  }

  /** @returns {Promise<void>} */
  async [Symbol.asyncDispose]() {
    await this.close();
  }

  #assertOpen() {
    if (this.#closed) {
      throw createCasError('Content-addressable store is closed', ErrorCodes.RESOURCE_CLOSED);
    }
  }

  /**
   * Factory to create a default JSON CAS from a Git working directory.
   *
   * This is the shortest path for normal callers: the facade constructs the
   * runtime-aware Git plumbing adapter and keeps all other options available.
   *
   * @param {Object} [options]
   * @param {string} [options.cwd='.'] - Git working directory.
   * @param {string} [options.env] - Shell runner environment override.
   * @param {number} [options.chunkSize] - Chunk size in bytes.
   * @param {import('./src/ports/CodecPort.js').default} [options.codec] - Manifest codec.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto] - Crypto adapter.
   * @param {import('./src/ports/ObservabilityPort.js').default} [options.observability] - Observability adapter.
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number, normalized?: boolean }} [options.chunking] - Chunking strategy config.
   * @param {import('./src/ports/ChunkingPort.js').default} [options.chunker] - Pre-built ChunkingPort instance.
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max buffered restore size in bytes.
   * @param {number} [options.maxBlobSize=10485760] - Safety limit for readBlob metadata in bytes.
   * @param {number} [options.maxPageSize=16777216] - Maximum immutable page size in bytes.
   * @param {number} [options.pageCacheEntries=128] - Maximum immutable page payloads retained in memory.
   * @param {number} [options.pageCacheBytes=8388608] - Maximum immutable page payload bytes retained in memory.
   * @param {import('./src/ports/CompressionPort.js').default} [options.compressionAdapter] - Compression adapter.
   * @returns {Promise<ContentAddressableStore>}
   */
  static async open({ cwd = '.', env, ...options } = {}) {
    return new ContentAddressableStore({
      ...options,
      plumbing: await createGitPlumbing({ cwd, env }),
    });
  }

  /**
   * Factory to create a CAS with JSON codec.
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {number} [options.chunkSize] - Chunk size in bytes.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto] - Crypto adapter.
   * @param {import('./src/ports/ObservabilityPort.js').default} [options.observability] - Observability adapter.
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number, normalized?: boolean }} [options.chunking] - Chunking strategy config.
   * @param {import('./src/ports/ChunkingPort.js').default} [options.chunker] - Pre-built ChunkingPort instance.
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max buffered restore size in bytes.
   * @param {number} [options.maxBlobSize=10485760] - Safety limit for readBlob metadata in bytes.
   * @param {number} [options.maxPageSize=16777216] - Maximum immutable page size in bytes.
   * @param {number} [options.pageCacheEntries=128] - Maximum immutable page payloads retained in memory.
   * @param {number} [options.pageCacheBytes=8388608] - Maximum immutable page payload bytes retained in memory.
   * @param {import('./src/ports/CompressionPort.js').default} [options.compressionAdapter] - Compression adapter.
   * @returns {ContentAddressableStore}
   */
  static createJson({ plumbing, ...options }) {
    return new ContentAddressableStore({ ...options, plumbing, codec: new JsonCodec() });
  }

  /**
   * Factory to create a CAS with CBOR codec.
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {number} [options.chunkSize] - Chunk size in bytes.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   * @param {import('./src/ports/CryptoPort.js').default} [options.crypto] - Crypto adapter.
   * @param {import('./src/ports/ObservabilityPort.js').default} [options.observability] - Observability adapter.
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number, normalized?: boolean }} [options.chunking] - Chunking strategy config.
   * @param {import('./src/ports/ChunkingPort.js').default} [options.chunker] - Pre-built ChunkingPort instance.
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max buffered restore size in bytes.
   * @param {number} [options.maxBlobSize=10485760] - Safety limit for readBlob metadata in bytes.
   * @param {number} [options.maxPageSize=16777216] - Maximum immutable page size in bytes.
   * @param {number} [options.pageCacheEntries=128] - Maximum immutable page payloads retained in memory.
   * @param {number} [options.pageCacheBytes=8388608] - Maximum immutable page payload bytes retained in memory.
   * @param {import('./src/ports/CompressionPort.js').default} [options.compressionAdapter] - Compression adapter.
   * @returns {ContentAddressableStore}
   */
  static createCbor({ plumbing, ...options }) {
    return new ContentAddressableStore({ ...options, plumbing, codec: new CborCodec() });
  }

  /**
   * Returns the configured chunk size in bytes.
   * @returns {number}
   */
  get chunkSize() {
    return this.service?.chunkSize || this.#config.chunkSize || 256 * 1024;
  }

  /**
   * Encrypts bytes using AES-256-GCM.
   * @param {Object} options
   * @param {Uint8Array} options.buffer - Plaintext data to encrypt.
   * @param {Uint8Array} options.key - 32-byte encryption key.
   * @returns {Promise<{ buf: Uint8Array, meta: { algorithm: string, nonce: string, tag: string, encrypted: boolean } }>}
   */
  async encrypt(options) {
    const service = await this.#getService();
    return await service.encrypt(options);
  }

  /**
   * Decrypts bytes. Returns them unchanged if `meta.encrypted` is falsy.
   * @param {Object} options
   * @param {Uint8Array} options.buffer - Ciphertext to decrypt.
   * @param {Uint8Array} options.key - 32-byte encryption key.
   * @param {{ encrypted: boolean, algorithm: string, nonce: string, tag: string }} options.meta - Encryption metadata.
   * @returns {Promise<Uint8Array>}
   */
  async decrypt(options) {
    const service = await this.#getService();
    return await service.decrypt(options);
  }

  /**
   * Reads a file from disk and stores it in Git as chunked blobs.
   * @param {Object} options
   * @param {string} options.filePath - Absolute or relative path to the file.
   * @param {string} options.slug - Logical identifier for the stored asset.
   * @param {string} [options.filename] - Override filename (defaults to basename of filePath).
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key for AES-256-GCM encryption.
   * @param {string} [options.passphrase] - Derive encryption key from passphrase.
   * @param {{ scheme?: 'whole'|'framed'|'convergent', frameBytes?: number, convergent?: boolean }} [options.encryption] - Explicit encryption scheme selection.
   * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
   * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
   * @param {Array<{label: string, key: Uint8Array}>} [options.recipients] - Envelope recipients (mutually exclusive with encryptionKey/passphrase).
   * @param {number} [options.merkleThreshold] - Per-operation chunk count threshold for Merkle tree publication.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number, normalized?: boolean }} [options.chunking] - Per-operation chunking strategy config.
   * @returns {Promise<Manifest>} The resulting manifest.
   */
  async storeFile(options) {
    const service = await this.#getService();
    return await storeFile(service, withOperationChunker(options));
  }

  /**
   * Stores an async iterable source in Git as chunked blobs.
   * @param {Object} options
   * @param {AsyncIterable<Uint8Array>} options.source - Data to store.
   * @param {string} options.slug - Logical identifier for the stored asset.
   * @param {string} options.filename - Filename for the manifest.
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key for AES-256-GCM encryption.
   * @param {string} [options.passphrase] - Derive encryption key from passphrase.
   * @param {{ scheme?: 'whole'|'framed'|'convergent', frameBytes?: number, convergent?: boolean }} [options.encryption] - Explicit encryption scheme selection.
   * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
   * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
   * @param {Array<{label: string, key: Uint8Array}>} [options.recipients] - Envelope recipients (mutually exclusive with encryptionKey/passphrase).
   * @param {number} [options.merkleThreshold] - Per-operation chunk count threshold for Merkle tree publication.
   * @param {{ strategy: string, chunkSize?: number, targetChunkSize?: number, minChunkSize?: number, maxChunkSize?: number, normalized?: boolean }} [options.chunking] - Per-operation chunking strategy config.
   * @returns {Promise<Manifest>} The resulting manifest.
   */
  async store(options) {
    const service = await this.#getService();
    return await service.store(withOperationChunker(options));
  }

  /**
   * Restores a file from its manifest and writes it to disk.
   * @param {Object} options
   * @param {Manifest} options.manifest - The file manifest.
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @param {string} options.outputPath - Destination file path.
   * @param {string} options.baseDirectory - Directory boundary that outputPath must stay inside.
   * @returns {Promise<{ bytesWritten: number }>}
   */
  async restoreFile(options) {
    if (!options?.baseDirectory) {
      throw createCasError({
        message:
          'baseDirectory is required for safe restoration. If you are restoring in a trusted local environment, pass baseDirectory: process.cwd().',
        code: ErrorCodes.INVALID_OPTIONS,
        meta: { option: 'baseDirectory' },
        documentationUrl: RESTORE_FILE_DOCS_URL,
      });
    }
    const service = await this.#getService();
    return await restoreFile(service, options);
  }

  /**
   * Restores a file from its manifest, returning the bytes directly.
   * @param {Object} options
   * @param {Manifest} options.manifest - The file manifest.
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @returns {Promise<{ buffer: Uint8Array, bytesWritten: number }>}
   */
  async restore(options) {
    const service = await this.#getService();
    return await service.restore(options);
  }

  /**
   * Restores a file from its manifest as an async iterable of byte chunks.
   * @param {Object} options
   * @param {Manifest} options.manifest - The file manifest.
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *restoreStream(options) {
    const service = await this.#getService();
    yield* service.restoreStream(options);
  }

  /**
   * Creates a Git tree object from a manifest.
   * @param {Object} options
   * @param {Manifest} options.manifest - The file manifest.
   * @param {number} [options.merkleThreshold] - Override chunk count threshold for this tree publication.
   * @returns {Promise<string>} Git OID of the created tree.
   */
  async createTree(options) {
    const service = await this.#getService();
    return await service.createTree(options);
  }

  /**
   * Verifies the integrity of a stored file by re-hashing its chunks.
   * @param {Manifest} manifest - The file manifest.
   * @param {{ encryptionKey?: Uint8Array, passphrase?: string }} [options] - Optional decryption credentials for encrypted manifests.
   * @returns {Promise<boolean>} `true` if all chunks pass verification.
   */
  async verifyIntegrity(manifest, options) {
    const service = await this.#getService();
    return await service.verifyIntegrity(manifest, options);
  }

  /**
   * Reads a manifest from a Git tree OID.
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID to read the manifest from.
   * @returns {Promise<Manifest>}
   */
  async readManifest(options) {
    const service = await this.#getService();
    return await service.readManifest(options);
  }

  /**
   * Compares two manifests by chunk digest.
   * Pure function — no I/O needed. Does not require initialization.
   * @param {Manifest} oldManifest
   * @param {Manifest} newManifest
   * @returns {import('./src/domain/services/ManifestDiff.js').ManifestDiffResult}
   */
  static diffManifests(oldManifest, newManifest) {
    return CasService.diffManifests(oldManifest, newManifest);
  }

  /**
   * Reads a manifest from a Git tree and returns inspection metadata.
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID of the asset.
   * @returns {Promise<{ slug: string, chunksOrphaned: number }>}
   */
  async inspectAsset(options) {
    const service = await this.#getService();
    return await service.inspectAsset(options);
  }

  /**
   * @deprecated Use {@link inspectAsset} instead.
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID of the asset.
   * @returns {Promise<{ slug: string, chunksOrphaned: number }>}
   */
  async deleteAsset(options) {
    const service = await this.#getService();
    return await service.deleteAsset(options);
  }

  /**
   * Aggregates referenced chunk blob OIDs across multiple stored assets.
   * @param {Object} options
   * @param {string[]} options.treeOids - Git tree OIDs to analyze.
   * @returns {Promise<{ referenced: Set<string>, total: number }>}
   */
  async collectReferencedChunks(options) {
    const service = await this.#getService();
    return await service.collectReferencedChunks(options);
  }

  /**
   * @deprecated Use {@link collectReferencedChunks} instead.
   * @param {Object} options
   * @param {string[]} options.treeOids - Git tree OIDs to analyze.
   * @returns {Promise<{ referenced: Set<string>, total: number }>}
   */
  async findOrphanedChunks(options) {
    const service = await this.#getService();
    return await service.findOrphanedChunks(options);
  }

  /**
   * Derives an encryption key from a passphrase using PBKDF2 or scrypt.
   * @param {Object} options
   * @param {string} options.passphrase - The passphrase.
   * @param {Uint8Array} [options.salt] - Salt (random if omitted).
   * @param {'pbkdf2'|'scrypt'} [options.algorithm='pbkdf2'] - KDF algorithm.
   * @param {number} [options.iterations] - PBKDF2 iterations.
   * @param {number} [options.cost] - scrypt cost (N).
   * @param {number} [options.blockSize] - scrypt block size (r).
   * @param {number} [options.parallelization] - scrypt parallelization (p).
   * @param {number} [options.keyLength=32] - Derived key length.
   * @returns {Promise<{ key: Uint8Array, salt: Uint8Array, params: Object }>}
   */
  async deriveKey(options) {
    const service = await this.#getService();
    return await service.deriveKey(options);
  }

  // ---------------------------------------------------------------------------
  // Recipient management — delegates to CasService
  // ---------------------------------------------------------------------------

  /**
   * Adds a recipient to an envelope-encrypted manifest.
   * @param {Object} options
   * @param {Manifest} options.manifest
   * @param {Uint8Array} options.existingKey - KEK of an existing recipient.
   * @param {Uint8Array} options.newRecipientKey - KEK for the new recipient.
   * @param {string} options.label - Label for the new recipient.
   * @returns {Promise<Manifest>}
   */
  async addRecipient(options) {
    const service = await this.#getService();
    return await service.addRecipient(options);
  }

  /**
   * Removes a recipient from an envelope-encrypted manifest.
   * @param {Object} options
   * @param {Manifest} options.manifest
   * @param {string} options.label - Label to remove.
   * @returns {Promise<Manifest>}
   */
  async removeRecipient(options) {
    const service = await this.#getService();
    return await service.removeRecipient(options);
  }

  /**
   * Lists recipient labels from an envelope-encrypted manifest.
   * @param {Manifest} manifest
   * @returns {Promise<string[]>}
   */
  async listRecipients(manifest) {
    const service = await this.#getService();
    return service.listRecipients(manifest);
  }

  /**
   * Rotates a recipient's key without re-encrypting data blobs.
   * @param {Object} options
   * @param {Manifest} options.manifest
   * @param {Uint8Array} options.oldKey - Current KEK of the recipient to rotate.
   * @param {Uint8Array} options.newKey - New KEK to wrap the DEK with.
   * @param {string} [options.label] - If provided, only rotate the named recipient.
   * @returns {Promise<Manifest>}
   */
  async rotateKey(options) {
    const service = await this.#getService();
    return await service.rotateKey(options);
  }

  // ---------------------------------------------------------------------------
  // Vault — delegates to VaultService
  // ---------------------------------------------------------------------------

  static VAULT_REF = VaultService.VAULT_REF;

  /** @see VaultService#initVault */
  async initVault(options) {
    const vault = await this.#getVault();
    return vault.initVault(options);
  }

  /** @see VaultService#addToVault */
  async addToVault(options) {
    const vault = await this.#getVault();
    return vault.addToVault(options);
  }

  /** @see VaultService#listVault */
  async listVault(options) {
    const vault = await this.#getVault();
    return vault.listVault(options);
  }

  /** @see VaultService#iterateVault */
  async *iterateVault(options) {
    const vault = await this.#getVault();
    yield* vault.iterateVault(options);
  }

  /** @see VaultService#removeFromVault */
  async removeFromVault(options) {
    const vault = await this.#getVault();
    return vault.removeFromVault(options);
  }

  /** @see VaultService#resolveVaultEntry */
  async resolveVaultEntry(options) {
    const vault = await this.#getVault();
    return vault.resolveVaultEntry(options);
  }

  /** @see VaultService#verifyVaultKey */
  async verifyVaultKey(options) {
    const vault = await this.#getVault();
    return vault.verifyVaultKey(options);
  }

  /** @see VaultService#getVaultMetadata */
  async getVaultMetadata() {
    const vault = await this.#getVault();
    return vault.getVaultMetadata();
  }

  // ---------------------------------------------------------------------------
  // Key rotation — orchestrates CasService + VaultService
  // ---------------------------------------------------------------------------

  /**
   * Rotates the vault-level passphrase. Re-wraps every envelope-encrypted
   * entry's DEK with a new KEK derived from `newPassphrase`. Entries using
   * direct-key encryption are skipped.
   *
   * @param {Object} options
   * @param {string} options.oldPassphrase - Current vault passphrase.
   * @param {string} options.newPassphrase - New vault passphrase.
   * @param {Object} [options.kdfOptions] - KDF options for new passphrase.
   * @param {number} [options.maxRetries=3] - Maximum optimistic-concurrency retries on VAULT_CONFLICT.
   * @param {number} [options.retryBaseMs=50] - Base delay in ms for exponential backoff between retries.
   * @returns {Promise<{ commitOid: string, rotatedSlugs: string[], skippedSlugs: string[] }>}
   */
  async rotateVaultPassphrase(options) {
    const service = await this.#getService();
    const vault = await this.#getVault();
    return await rotateVaultPassphrase({ service, vault }, options);
  }
}

function cacheApplicationTarget(cache, key, target) {
  if (cache.size >= MAX_VALIDATION_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, Object.freeze({
    handle: target.handle,
    oid: target.oid,
    type: target.type,
    size: target.size ?? null,
    logicalBytes: target.logicalBytes ?? target.size ?? null,
  }));
}
