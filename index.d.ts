/**
 * @module
 * Content Addressable Store — Managed blob storage in Git.
 */

import Manifest from './src/domain/value-objects/Manifest.js';
import type {
  EncryptionMeta,
  ManifestData,
  CompressionMeta,
  KdfParams,
  SubManifestRef,
  RecipientEntry,
  EncryptionScheme,
} from './src/domain/value-objects/Manifest.js';
import Chunk from './src/domain/value-objects/Chunk.js';
import CasService from './src/domain/services/CasService.js';
import CasError from './src/domain/errors/CasError.js';
import type {
  CryptoPort,
  CodecPort,
  GitPersistencePort,
  ObservabilityPort,
  CasServiceOptions,
  DeriveKeyOptions,
  DeriveKeyResult,
  StoreEncryptionOptions,
  VerifyIntegrityOptions,
} from './src/domain/services/CasService.js';

export { CasService, CasError, Manifest, Chunk };
/** Type alias mapping the runtime `CompressionPort` export to its base class declaration. */
export type CompressionPort = CompressionPortBase;

export type {
  EncryptionMeta,
  ManifestData,
  CompressionMeta,
  KdfParams,
  SubManifestRef,
  RecipientEntry,
  EncryptionScheme,
};

export interface AssetHandleData {
  version: 1;
  kind: 'asset';
  format: 'manifest-tree';
  codec: string;
  hashAlgorithm: 'sha1' | 'sha256';
  oid: string;
}

export interface AssetHandleInit {
  version?: 1;
  kind?: 'asset';
  format?: 'manifest-tree';
  codec: string;
  hashAlgorithm?: 'sha1' | 'sha256';
  oid: string;
}

export type AssetHandleInput = AssetHandle | AssetHandleData | AssetHandleInit | string;

/** Repository-independent locator for one validated git-cas asset graph. */
export declare class AssetHandle implements AssetHandleData {
  readonly version: 1;
  readonly kind: 'asset';
  readonly format: 'manifest-tree';
  readonly codec: string;
  readonly hashAlgorithm: 'sha1' | 'sha256';
  readonly oid: string;
  constructor(value: AssetHandleInit);
  static from(value: AssetHandleInput): AssetHandle;
  static parse(token: string): AssetHandle;
  toString(): string;
  toJSON(): AssetHandleData;
}

export interface PageHandleData {
  version: 1;
  kind: 'page';
  format: 'blob';
  codec: 'raw';
  hashAlgorithm: 'sha1' | 'sha256';
  oid: string;
}

export interface PageHandleInit {
  version?: 1;
  kind?: 'page';
  format?: 'blob';
  codec?: 'raw';
  hashAlgorithm?: 'sha1' | 'sha256';
  oid: string;
}

export type PageHandleInput = PageHandle | PageHandleData | PageHandleInit | string;

/** Repository-independent locator for one immutable raw page blob. */
export declare class PageHandle implements PageHandleData {
  readonly version: 1;
  readonly kind: 'page';
  readonly format: 'blob';
  readonly codec: 'raw';
  readonly hashAlgorithm: 'sha1' | 'sha256';
  readonly oid: string;
  constructor(value: PageHandleInit);
  static from(value: PageHandleInput): PageHandle;
  static parse(token: string): PageHandle;
  toString(): string;
  toJSON(): PageHandleData;
}

export interface BundleHandleData {
  version: 1;
  kind: 'bundle';
  format: 'fanout-tree';
  codec: string;
  hashAlgorithm: 'sha1' | 'sha256';
  oid: string;
}

export interface BundleHandleInit {
  version?: 1;
  kind?: 'bundle';
  format?: 'fanout-tree';
  codec: string;
  hashAlgorithm?: 'sha1' | 'sha256';
  oid: string;
}

export type BundleHandleInput = BundleHandle | BundleHandleData | BundleHandleInit | string;

/** Repository-independent locator for one structured fanout bundle tree. */
export declare class BundleHandle implements BundleHandleData {
  readonly version: 1;
  readonly kind: 'bundle';
  readonly format: 'fanout-tree';
  readonly codec: string;
  readonly hashAlgorithm: 'sha1' | 'sha256';
  readonly oid: string;
  constructor(value: BundleHandleInit);
  static from(value: BundleHandleInput): BundleHandle;
  static parse(token: string): BundleHandle;
  toString(): string;
  toJSON(): BundleHandleData;
}

export type ApplicationHandle = AssetHandle | BundleHandle | PageHandle;
export type ApplicationHandleInput = AssetHandleInput | BundleHandleInput | PageHandleInput;

export interface StagedAssetData {
  version: 1;
  state: 'staged';
  handle: string;
  asset: { slug: string; filename: string; size: number };
  retention: {
    policy: null;
    reachability: 'unanchored';
    protection: 'not-established';
  };
  observedAt: string;
}

/** Result for an asset graph written without a reachability root. */
export declare class StagedAsset {
  readonly version: 1;
  readonly state: 'staged';
  readonly handle: AssetHandle;
  readonly asset: Readonly<{ slug: string; filename: string; size: number }>;
  readonly retention: Readonly<{
    policy: null;
    reachability: 'unanchored';
    protection: 'not-established';
  }>;
  readonly observedAt: string;
  constructor(value: {
    handle: AssetHandleInput;
    slug: string;
    filename: string;
    size: number;
    observedAt: string;
  });
  toJSON(): StagedAssetData;
}

export interface StagedPageData {
  version: 1;
  state: 'staged';
  handle: string;
  page: { size: number };
  retention: {
    policy: null;
    reachability: 'unanchored';
    protection: 'not-established';
  };
  observedAt: string;
}

/** Result for a page blob written without a reachability root. */
export declare class StagedPage {
  readonly version: 1;
  readonly state: 'staged';
  readonly handle: PageHandle;
  readonly page: Readonly<{ size: number }>;
  readonly retention: Readonly<{
    policy: null;
    reachability: 'unanchored';
    protection: 'not-established';
  }>;
  readonly observedAt: string;
  constructor(value: { handle: PageHandleInput; size: number; observedAt: string });
  toJSON(): StagedPageData;
}

export interface BundleLimits {
  maxMembers: number;
  maxMemberPathBytes: number;
  maxDescriptorBytes: number;
  maxFanoutEntries: number;
  maxFanoutDepth: number;
}

export interface StagedBundleData {
  version: 1;
  state: 'staged';
  handle: string;
  bundle: { memberCount: number; indexDepth: number; descriptorBytes: number };
  limits: BundleLimits;
  retention: {
    policy: null;
    reachability: 'unanchored';
    protection: 'not-established';
  };
  observedAt: string;
}

/** Result for a structured bundle written without a reachability root. */
export declare class StagedBundle {
  readonly version: 1;
  readonly state: 'staged';
  readonly handle: BundleHandle;
  readonly bundle: Readonly<{
    memberCount: number;
    indexDepth: number;
    descriptorBytes: number;
  }>;
  readonly limits: Readonly<BundleLimits>;
  readonly retention: Readonly<{
    policy: null;
    reachability: 'unanchored';
    protection: 'not-established';
  }>;
  readonly observedAt: string;
  constructor(value: {
    handle: BundleHandleInput;
    memberCount: number;
    indexDepth: number;
    descriptorBytes: number;
    limits: BundleLimits;
    observedAt: string;
  });
  toJSON(): StagedBundleData;
}

export type RetentionPolicy = 'pinned' | 'evictable';
export type RetentionReachability = 'anchored' | 'orphaned' | 'volatile';
export type RetentionRootKind =
  | 'root-set'
  | 'publication'
  | 'cache-set'
  | 'cache-acquisition'
  | 'expiring-set';

export interface RetentionRoot {
  kind: RetentionRootKind;
  namespace: string;
  ref: string;
  generation: string;
  path: string;
}

export interface RetentionWitnessData {
  version: 1;
  handle: string;
  policy: RetentionPolicy;
  reachability: RetentionReachability;
  root: RetentionRoot;
  observedAt: string;
}

/** Immutable evidence for one observed retaining Git generation. */
export declare class RetentionWitness {
  readonly version: 1;
  readonly handle: ApplicationHandle;
  readonly policy: RetentionPolicy;
  readonly reachability: RetentionReachability;
  readonly root: Readonly<RetentionRoot>;
  readonly observedAt: string;
  constructor(value: {
    handle: ApplicationHandleInput;
    policy: RetentionPolicy;
    reachability: RetentionReachability;
    root: RetentionRoot;
    observedAt: string;
  });
  toJSON(): RetentionWitnessData;
}

export interface CachePolicyData {
  maxEntries: number;
  maxBytes: number | null;
  accessResolutionMs: number;
}

export type CachePolicyOptions = Partial<CachePolicyData>;

/** Immutable admission and eviction policy for one CacheSet. */
export declare class CachePolicy implements CachePolicyData {
  readonly maxEntries: number;
  readonly maxBytes: number | null;
  readonly accessResolutionMs: number;
  constructor(value?: CachePolicyOptions);
  static from(value?: CachePolicy | CachePolicyOptions): CachePolicy;
  toJSON(): CachePolicyData;
}

export interface CacheHitData {
  key: string;
  handle: string;
  policy: RetentionPolicy;
  expiresAt: string | null;
  logicalBytes: number;
  createdAt: string;
  accessedAt: string;
  generation: string;
  evidence: RetentionWitnessData;
}

/** Immutable result for one live cache entry. */
export declare class CacheHit {
  readonly key: string;
  readonly handle: ApplicationHandle;
  readonly policy: RetentionPolicy;
  readonly expiresAt: string | null;
  readonly logicalBytes: number;
  readonly createdAt: string;
  readonly accessedAt: string;
  readonly generation: string;
  readonly evidence: RetentionWitness;
  constructor(value: {
    key: string;
    handle: ApplicationHandleInput;
    policy: RetentionPolicy;
    expiresAt: string | null;
    logicalBytes: number;
    createdAt: string;
    accessedAt: string;
    generation: string;
    evidence: RetentionWitness | ConstructorParameters<typeof RetentionWitness>[0];
  });
  toJSON(): CacheHitData;
}

export interface CacheAcquisitionRelease {
  readonly id: string;
  readonly generation: string;
  readonly changed: boolean;
  readonly releasedAt: string;
}

/** Active, explicitly releasable retention scope for one cache hit. */
export interface CacheAcquisition {
  readonly id: string;
  readonly hit: CacheHit;
  readonly evidence: RetentionWitness;
  readonly acquiredAt: string;
  release(): Promise<CacheAcquisitionRelease>;
}

export interface CacheAcquisitionInspectionEntry {
  readonly id: string;
  readonly generation: string;
  readonly acquiredAt: string;
  readonly keyDigest: string;
}

export interface CacheAcquisitionInspection {
  readonly namespace: string;
  readonly entries: ReadonlyArray<CacheAcquisitionInspectionEntry>;
  readonly truncated: boolean;
}

export interface ExpiringMarkerData {
  version: 1;
  keyDigest: string;
  expiresAt: string;
  createdAt: string;
  generation: string;
  evidence: RetentionWitnessData;
}

/** Immutable evidence for one live replay marker. */
export declare class ExpiringMarker {
  readonly version: 1;
  readonly keyDigest: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly generation: string;
  readonly evidence: RetentionWitness;
  constructor(value: {
    keyDigest: string;
    expiresAt: string;
    createdAt: string;
    generation: string;
    evidence: RetentionWitness | ConstructorParameters<typeof RetentionWitness>[0];
  });
  toJSON(): ExpiringMarkerData;
}
export type {
  CryptoPort,
  CodecPort,
  GitPersistencePort,
  ObservabilityPort,
  CasServiceOptions,
  DeriveKeyOptions,
  DeriveKeyResult,
  StoreEncryptionOptions,
  VerifyIntegrityOptions,
};

/** Abstract port for compression and decompression of buffers and streams. */
export declare class CompressionPortBase {
  compressBuffer(buffer: Uint8Array): Promise<Uint8Array>;
  decompressBuffer(buffer: Uint8Array): Promise<Uint8Array>;
  compressStream(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
  decompressStream(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
}

/** Node.js compression adapter using gzip/gunzip. */
export declare class NodeCompressionAdapter extends CompressionPortBase {}

/** Abstract port for splitting a byte stream into chunks. */
export declare class ChunkingPort {
  get strategy(): string;
  get params(): Record<string, unknown>;
  chunk(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
}

/** Fixed-size chunking adapter. */
export declare class FixedChunker extends ChunkingPort {
  constructor(options?: { chunkSize?: number });
  get strategy(): 'fixed';
  get params(): { chunkSize: number };
}

/** Content-defined chunking adapter using buzhash rolling hash. */
export declare class CdcChunker extends ChunkingPort {
  constructor(options?: {
    minChunkSize?: number;
    maxChunkSize?: number;
    targetChunkSize?: number;
    normalized?: boolean;
  });
  get strategy(): 'cdc';
  get params(): { target: number; min: number; max: number; normalized: boolean };
}

/** Abstract port for cryptographic operations. */
export declare class CryptoPortBase {
  sha256(buf: Uint8Array): Promise<string>;
  randomBytes(n: number): Uint8Array;
  encryptBuffer(
    buffer: Uint8Array,
    key: Uint8Array,
    aad?: Uint8Array
  ): { buf: Uint8Array; meta: EncryptionMeta } | Promise<{ buf: Uint8Array; meta: EncryptionMeta }>;
  decryptBuffer(
    buffer: Uint8Array,
    key: Uint8Array,
    meta: EncryptionMeta,
    aad?: Uint8Array
  ): Uint8Array | Promise<Uint8Array>;
  createEncryptionStream(
    key: Uint8Array,
    aad?: Uint8Array
  ): {
    encrypt: (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>;
    finalize: () => EncryptionMeta;
  };
  createDecryptionStream(
    key: Uint8Array,
    meta: EncryptionMeta,
    aad?: Uint8Array
  ): {
    decrypt: (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>;
  };
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  encryptBufferWithNonce(
    buffer: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array
  ): { buf: Uint8Array; tag: Uint8Array } | Promise<{ buf: Uint8Array; tag: Uint8Array }>;
  decryptBufferWithNonceTag(
    buffer: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array,
    tag: Uint8Array
  ): Uint8Array | Promise<Uint8Array>;
  deriveKey(options: DeriveKeyOptions): Promise<DeriveKeyResult>;
}

/** Abstract port for persisting data to Git's object database. */
export declare class GitPersistencePortBase {
  writeBlob(content: Uint8Array): Promise<string>;
  writeTree(entries: string[]): Promise<string>;
  readBlob(oid: string, maxBytes?: number): Promise<Uint8Array>;
  readBlobStream(oid: string): Promise<AsyncIterable<Uint8Array>>;
  readTree(
    treeOid: string
  ): Promise<Array<{ mode: string; type: string; oid: string; name: string }>>;
  readTreeEntry(
    treeOid: string,
    treePath: string
  ): Promise<{ mode: string; type: string; oid: string; name: string } | null>;
  iterateTree(
    treeOid: string
  ): AsyncIterable<{ mode: string; type: string; oid: string; name: string }>;
  readObjectType(oid: string): Promise<string>;
  readObjectSize(oid: string): Promise<number>;
  setMaxBlobSize?(maxBlobSize: number): void;
}

/** Abstract port for Git ref and commit operations. */
export declare class GitRefPortBase {
  resolveRef(ref: string): Promise<string>;
  resolveTree(commitOid: string): Promise<string>;
  resolveParents(commitOid: string): Promise<string[]>;
  createCommit(options: {
    treeOid: string;
    parentOid?: string | null;
    parentOids?: string[];
    message: string;
  }): Promise<string>;
  updateRef(options: {
    ref: string;
    newOid: string;
    /** Expected current OID for CAS; null means the ref must not exist. */
    expectedOldOid?: string | null;
  }): Promise<void>;
  anchorRef?(options: {
    sourceRef: string;
    expectedSourceOid: string;
    targetRef: string;
  }): Promise<boolean>;
  deleteRef?(options: { ref: string; expectedOldOid: string }): Promise<boolean>;
  iterateRefs?(options: {
    prefix?: string;
    limit: number;
  }): AsyncIterable<{ ref: string; oid: string; symref: string | null }>;
}

/** Git-backed implementation of the persistence port. */
export declare class GitPersistenceAdapter extends GitPersistencePortBase {
  constructor(options: { plumbing: unknown; policy?: unknown });
  setMaxBlobSize(maxBlobSize: number): void;
}

/** Git-backed implementation of the ref port. */
export declare class GitRefAdapter extends GitRefPortBase {
  constructor(options: { plumbing: unknown; policy?: unknown });
  anchorRef(options: {
    sourceRef: string;
    expectedSourceOid: string;
    targetRef: string;
  }): Promise<boolean>;
  deleteRef(options: { ref: string; expectedOldOid: string }): Promise<boolean>;
  iterateRefs(options: {
    prefix?: string;
    limit: number;
  }): AsyncIterable<{ ref: string; oid: string; symref: string | null }>;
}

export type RepositoryObjectType = 'blob' | 'tree' | 'commit' | 'tag';

export interface RepositoryObjectRecord {
  readonly oid: string;
  readonly type: RepositoryObjectType;
  readonly logicalBytes: number;
  readonly physicalBytes: number;
}

export interface RepositoryRefRecord {
  readonly ref: string;
  readonly oid: string;
  /** Present when the inspection adapter can distinguish symbolic refs. */
  readonly symref?: string | null;
}

/** Abstract non-mutating repository inspection port. */
export declare class RepositoryInspectionPort {
  iterateObjects(): AsyncIterable<RepositoryObjectRecord>;
  iterateReachableObjectIds(): AsyncIterable<string>;
  iteratePrunableObjects(options: {
    expiresBefore: string;
  }): AsyncIterable<Pick<RepositoryObjectRecord, 'oid' | 'type'>>;
  iterateRefs(options?: {
    prefix?: string;
  }): AsyncIterable<RepositoryRefRecord>;
  reachablePhysicalBytes(): Promise<number>;
}

/** Git-backed implementation of repository inspection. */
export declare class GitRepositoryInspectionAdapter extends RepositoryInspectionPort {
  constructor(options: { plumbing: unknown; policy?: unknown });
}

/** Node.js crypto implementation of CryptoPort. */
export declare class NodeCryptoAdapter extends CryptoPortBase {
  constructor();
}

/** Abstract codec interface for manifest serialization. */
export declare class CodecPortBase {
  encode(data: object): Uint8Array;
  decode(buffer: Uint8Array): object;
  get extension(): string;
}

/** JSON codec for manifest serialization. */
export declare class JsonCodec extends CodecPortBase {
  constructor();
}

/** CBOR codec for manifest serialization. */
export declare class CborCodec extends CodecPortBase {
  constructor();
}

/** No-op observability adapter. */
export declare class SilentObserver {
  metric(channel: string, data: Record<string, unknown>): void;
  log(level: string, msg: string, meta?: Record<string, unknown>): void;
  span(name: string): { end(meta?: Record<string, unknown>): void };
}

/** EventEmitter-based observability adapter for backward compatibility. */
export declare class EventEmitterObserver {
  metric(channel: string, data: Record<string, unknown>): void;
  log(level: string, msg: string, meta?: Record<string, unknown>): void;
  span(name: string): { end(meta?: Record<string, unknown>): void };
  on(event: string, listener: (...args: unknown[]) => void): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
  listenerCount(event: string): number;
}

/** Stats-collecting observability adapter. */
export declare class StatsCollector {
  metric(channel: string, data: Record<string, unknown>): void;
  log(level: string, msg: string, meta?: Record<string, unknown>): void;
  span(name: string): { end(meta?: Record<string, unknown>): void };
  summary(): {
    chunksProcessed: number;
    bytesTotal: number;
    elapsed: number;
    throughput: number;
    errors: number;
  };
}

/** Declarative chunking strategy configuration. */
export interface ChunkingConfig {
  strategy: 'fixed' | 'cdc';
  chunkSize?: number;
  targetChunkSize?: number;
  minChunkSize?: number;
  maxChunkSize?: number;
  normalized?: boolean;
}

/** Constructor options for {@link ContentAddressableStore}. */
export interface ContentAddressableStoreOptions {
  plumbing: unknown;
  chunkSize?: number;
  codec?: CodecPort;
  crypto?: CryptoPort;
  observability?: ObservabilityPort;
  policy?: unknown;
  merkleThreshold?: number;
  concurrency?: number;
  chunking?: ChunkingConfig;
  chunker?: ChunkingPort;
  /** Compression adapter (default NodeCompressionAdapter). */
  compressionAdapter?: CompressionPortBase;
  /** Maximum bytes to buffer during encrypted/compressed restore. @default 536870912 (512 MiB) */
  maxRestoreBufferSize?: number;
  /** Safety limit for readBlob metadata in bytes. @default 10485760 (10 MiB) */
  maxBlobSize?: number;
  /** Maximum immutable page size in bytes. @default 16777216 (16 MiB) */
  maxPageSize?: number;
  /** Repository-wide maximum bundle admission limits. */
  bundleLimits?: Partial<BundleLimits>;
  /** Maximum nested bundle depth. @default 32 */
  maxBundleNestingDepth?: number;
  /** Application-owned ref prefixes permitted for generic publication. */
  applicationRefPrefixes?: string[];
  /** Injectable clock used for deterministic lifecycle evidence. */
  clock?: { now(): Date };
}

/** Options for {@link ContentAddressableStore.open}. */
export interface ContentAddressableStoreOpenOptions extends Omit<
  ContentAddressableStoreOptions,
  'plumbing'
> {
  /** Git working directory used to construct the default Git plumbing adapter. @default "." */
  cwd?: string;
  /** Optional shell-runner environment override for Git plumbing. */
  env?: string;
}

/** Options for codec-specific facade factories. */
export type ContentAddressableStoreCodecFactoryOptions = Omit<
  ContentAddressableStoreOptions,
  'codec'
>;

/** A single vault entry. */
export interface VaultEntry {
  slug: string;
  treeOid: string;
}

export type RootSetEntryType = 'blob' | 'tree';
export type RootSetRetention = RetentionPolicy;

/** One Git object retained by a root set while the entry is present. */
export interface RootSetEntry {
  name: string;
  oid: string;
  type: RootSetEntryType;
  retention: RootSetRetention;
}

export interface RootSetState {
  ref: string;
  headOid: string | null;
  treeOid: string | null;
  entries: RootSetEntry[];
}

export interface RootSetMutationResult {
  changed: boolean;
  commitOid: string | null;
  treeOid: string | null;
  entries: RootSetEntry[];
}

export interface RootSetDoctorResult {
  healthy: boolean;
  ref: string;
  headOid?: string | null;
  treeOid?: string | null;
  entryCount?: number;
  entries?: RootSetEntry[];
  policyCounts?: { pinned: number; evictable: number };
  reachabilityCounts?: {
    anchored: number;
    missing: number;
    unknown: number;
    orphaned: number;
    volatile: number;
  };
  targets?: Array<RootSetEntry & {
    exists: boolean | null;
    actualType: string | null;
    reachability: 'anchored' | 'missing' | 'unknown';
  }>;
  issues?: Array<Record<string, unknown>>;
  error?: { code: string; message: string };
}

export declare class RootSet {
  readonly ref: string;
  read(): Promise<RootSetState>;
  list(): Promise<RootSetEntry[]>;
  contains(name: string): Promise<boolean>;
  put(entry: Omit<RootSetEntry, 'retention'> & { retention?: RootSetRetention }): Promise<
    RootSetMutationResult & { entry: RootSetEntry; previous: RootSetEntry | null }
  >;
  remove(options: { name: string }): Promise<
    RootSetMutationResult & { removed: RootSetEntry | null }
  >;
  replace(options: {
    entries: Iterable<RootSetEntry>;
    expectedHeadOid?: string | null;
  }): Promise<RootSetMutationResult>;
  mutate(
    mutator: (
      entries: ReadonlyArray<Readonly<RootSetEntry>>,
      state: Readonly<Omit<RootSetState, 'entries'>>,
    ) => Iterable<RootSetEntry> | Promise<Iterable<RootSetEntry>>,
    options?: { expectedHeadOid?: string | null },
  ): Promise<RootSetMutationResult>;
  doctor(): Promise<RootSetDoctorResult>;
  repair(options: { entries: Iterable<RootSetEntry> }): Promise<{
    repaired: true;
    commitOid: string;
    treeOid: string;
    entries: RootSetEntry[];
  }>;
}

export declare class RootSetRegistry {
  open(options: {
    ref: string;
    retry?: { maxAttempts?: number; baseDelayMs?: number };
  }): RootSet;
}

export interface CacheEntryOptions {
  retention?: RetentionPolicy;
  expiresAt?: Date | string | null;
  expectedHandle?: ApplicationHandleInput;
}

export interface CachePolicyReport {
  readonly satisfied: boolean;
  readonly entryCount: number;
  readonly logicalBytes: number;
  readonly pinnedEntries: number;
  readonly evictableEntries: number;
  readonly expiredEntries: number;
  readonly limits: Readonly<CachePolicyData>;
}

export interface CacheStoreResult {
  readonly changed: boolean;
  readonly accepted: boolean;
  readonly hit: CacheHit | null;
  readonly previous: CacheHit | null;
  readonly generation: string | null;
  readonly policy: CachePolicyReport | null;
  readonly witness: RetentionWitness | null;
}

export interface CacheMutationResult {
  readonly changed: boolean;
  readonly generation: string | null;
  readonly policy: CachePolicyReport | null;
  readonly witness: RetentionWitness | null;
}

export interface CacheEntryMetadata {
  readonly version: 1;
  readonly accountingVersion: 1;
  readonly key: string;
  readonly keyDigest: string;
  readonly handle: string;
  readonly policy: RetentionPolicy;
  readonly expiresAt: string | null;
  readonly logicalBytes: number;
  readonly createdAt: string;
  readonly accessedAt: string;
}

export interface CacheState {
  readonly version: 1;
  readonly accountingVersion: 1;
  readonly namespace: string;
  readonly policy: CachePolicyData;
  readonly entryCount: number;
  readonly logicalBytes: number;
  readonly pinnedEntries: number;
  readonly evictableEntries: number;
  readonly expiredEntries: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly oldestAccessedAt: string | null;
  readonly nextExpiry: string | null;
}

export interface CacheInspection {
  readonly namespace: string;
  readonly ref: string;
  readonly generation: string | null;
  readonly state: Readonly<CacheState> | null;
  readonly observed: Readonly<Omit<CacheState, 'version' | 'accountingVersion' | 'namespace' | 'policy' | 'createdAt' | 'updatedAt'>> | null;
  readonly policy: CachePolicyReport | null;
  readonly entries: ReadonlyArray<Readonly<CacheEntryMetadata>>;
  readonly nextCursor: string | null;
}

/** RootSet-backed lifecycle manager for application cache handles. */
export declare class CacheSet {
  private constructor();
  readonly ref: string;
  get(key: string): Promise<CacheHit | null>;
  acquire(key: string): Promise<CacheAcquisition | null>;
  inspectAcquisitions(options?: {
    limit?: number;
  }): Promise<CacheAcquisitionInspection>;
  releaseAcquisition(options: {
    id: string;
    expectedGeneration: string;
  }): Promise<CacheAcquisitionRelease>;
  put(key: string, handle: ApplicationHandleInput, options?: CacheEntryOptions): Promise<CacheStoreResult>;
  replace(key: string, handle: ApplicationHandleInput, options?: CacheEntryOptions): Promise<CacheStoreResult>;
  remove(key: string): Promise<CacheMutationResult & { readonly removed: CacheHit | null }>;
  touch(key: string): Promise<CacheMutationResult & { readonly hit: CacheHit | null }>;
  sweep(): Promise<CacheMutationResult & { readonly removed: number }>;
  inspect(options?: { limit?: number; cursor?: string | null }): Promise<CacheInspection>;
  doctor(): Promise<Readonly<{
    healthy: boolean;
    root: RootSetDoctorResult;
    state?: Readonly<CacheState>;
    observed?: CacheInspection['observed'];
    policy?: CachePolicyReport;
    issues: ReadonlyArray<Record<string, unknown>>;
  }>>;
  repair(options: {
    entries: Iterable<{
      key: string;
      handle: ApplicationHandleInput;
      retention?: RetentionPolicy;
      expiresAt?: Date | string | null;
      createdAt?: Date | string;
      accessedAt?: Date | string;
    }> | AsyncIterable<{
      key: string;
      handle: ApplicationHandleInput;
      retention?: RetentionPolicy;
      expiresAt?: Date | string | null;
      createdAt?: Date | string;
      accessedAt?: Date | string;
    }>;
    policy?: CachePolicyOptions;
  }): Promise<Readonly<{
    repaired: true;
    generation: string;
    policy: CachePolicyReport;
    witness: RetentionWitness;
  }>>;
}

export interface ExpiringSetSummary {
  readonly entryCount: number;
  readonly liveEntries: number;
  readonly expiredEntries: number;
  readonly nextExpiry: string | null;
}

export interface ExpiringSetState extends ExpiringSetSummary {
  readonly version: 1;
  readonly namespace: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExpiringMarkerInspection {
  readonly keyDigest: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly status: 'live' | 'expired';
  readonly evidence: RetentionWitness;
}

export interface ExpiringSetInspection {
  readonly namespace: string;
  readonly ref: string;
  readonly generation: string | null;
  readonly state: Readonly<ExpiringSetState> | null;
  readonly observed: Readonly<ExpiringSetSummary>;
  readonly markers: ReadonlyArray<Readonly<ExpiringMarkerInspection>>;
  readonly nextCursor: string | null;
}

export interface ExpiringSetAddResult {
  readonly changed: boolean;
  readonly admitted: boolean;
  readonly marker: ExpiringMarker | null;
  readonly generation: string | null;
  readonly witness: RetentionWitness | null;
}

export interface ExpiringSetSweepResult {
  readonly changed: boolean;
  readonly removed: number;
  readonly generation: string | null;
  readonly witness: RetentionWitness | null;
}

/** RootSet-backed replay marker set with expiry-only release semantics. */
export declare class ExpiringSet {
  private constructor();
  readonly ref: string;
  contains(key: string): Promise<boolean>;
  addIfAbsent(key: string, options: { expiresAt: Date | string }): Promise<ExpiringSetAddResult>;
  sweep(): Promise<ExpiringSetSweepResult>;
  inspect(options?: { limit?: number; cursor?: string | null }): Promise<ExpiringSetInspection>;
  doctor(): Promise<Readonly<{
    healthy: boolean;
    root: RootSetDoctorResult;
    state?: Readonly<ExpiringSetState> | null;
    observed?: Readonly<ExpiringSetSummary>;
    issues: ReadonlyArray<Record<string, unknown>>;
  }>>;
}

/** Encrypted vault key verifier stored in .vault.json. */
export interface VaultEncryptionVerifier {
  version: 1;
  ciphertext: string;
  meta: EncryptionMeta;
}

/** Vault metadata stored in .vault.json. */
export interface VaultMetadata {
  version: number;
  /** Number of encrypted store operations performed with this vault key. */
  encryptionCount?: number;
  encryption?: {
    cipher: string;
    kdf: {
      algorithm: string;
      salt: string;
      iterations?: number;
      cost?: number;
      blockSize?: number;
      parallelization?: number;
      keyLength: number;
    };
    /** Encrypted verifier used to authenticate an empty encrypted vault. */
    verifier?: VaultEncryptionVerifier;
  };
  /** Privacy mode configuration. When enabled, vault slugs are HMAC-masked in the Git tree. */
  privacy?: {
    enabled: boolean;
    /** Encryption metadata for the privacy index blob. */
    indexMeta?: { nonce: string; tag: string };
  };
}

/** Internal vault state returned by VaultService.readState(). */
export interface VaultState {
  entries: Map<string, string>;
  parentCommitOid: string | null;
  metadata: VaultMetadata | null;
}

/**
 * Domain service for vault (GC-safe ref-based asset index) operations.
 */
export declare class VaultService {
  static VAULT_REF: string;

  constructor(options: {
    persistence: GitPersistencePortBase;
    ref: GitRefPortBase;
    crypto: CryptoPortBase;
    observability?: ObservabilityPort;
  });

  /** Validates a vault slug. Throws CasError with code INVALID_SLUG on failure. */
  validateSlug(slug: string): void;

  /** Reads the current vault state from refs/cas/vault. */
  readState(options?: {
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<VaultState>;

  /** Writes a new vault commit and updates the ref atomically. */
  writeCommit(options: {
    entries: Map<string, string>;
    metadata: VaultMetadata;
    parentCommitOid: string | null;
    message: string;
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<{ commitOid: string }>;

  /** Initializes the vault, optionally with encryption and privacy mode. */
  initVault(options?: {
    passphrase?: string;
    kdfOptions?: Omit<DeriveKeyOptions, 'passphrase'>;
    /** Enable privacy mode (requires passphrase/encryption). */
    privacy?: boolean;
  }): Promise<{ commitOid: string }>;

  /** Adds or updates an entry in the vault. */
  addToVault(options: {
    slug: string;
    treeOid: string;
    force?: boolean;
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<{ commitOid: string }>;

  /** Lists all vault entries sorted by slug. */
  listVault(options?: {
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<VaultEntry[]>;

  /** Streams vault entries without forcing a slug map allocation. */
  iterateVault(options?: {
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): AsyncIterable<VaultEntry>;

  /** Removes an entry from the vault. */
  removeFromVault(options: {
    slug: string;
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<{ commitOid: string; removedTreeOid: string }>;

  /** Resolves a vault entry slug to its tree OID. */
  resolveVaultEntry(options: {
    slug: string;
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<string>;

  /** Verifies a vault encryption key when verifier metadata exists. */
  verifyVaultKey(options: {
    encryptionKey: Uint8Array;
  }): Promise<{ verified: boolean; requiresMigration: boolean }>;

  /** Returns the vault metadata, or null if no vault exists. */
  getVaultMetadata(): Promise<VaultMetadata | null>;
}

export interface RepositoryDoctorOptions {
  /** Canonical UTC cutoff passed to safe prune inspection. Mutually exclusive with gracePeriodMs. */
  expiresBefore?: string;
  /** Relative grace period. Defaults to 14 days. Mutually exclusive with expiresBefore. */
  gracePeriodMs?: number;
  /** Maximum detailed CacheSet, RootSet, and ExpiringSet reports per kind. @default 100 */
  maxCollectionsPerKind?: number;
}

export interface RepositoryObjectMetric {
  readonly objectCount: number | null;
  readonly physicalBytes: number | null;
}

export interface RepositoryObjectInventory {
  readonly total: RepositoryObjectMetric & { readonly logicalBytes: number };
  readonly anchored: RepositoryObjectMetric;
  readonly orphaned: RepositoryObjectMetric;
  readonly volatile: RepositoryObjectMetric;
  readonly unreachable: RepositoryObjectMetric;
}

export interface RepositoryCollectionCoverage {
  readonly observed: number;
  readonly inspected: number;
  readonly detailed: number;
  readonly complete: boolean;
}

export interface RepositoryDiagnosticLimitation {
  readonly code: string;
  readonly message: string;
  readonly kind?: 'acquisitions' | 'caches' | 'rootSets' | 'expiringSets';
  readonly observed?: number;
  readonly inspected?: number;
  readonly detailed?: number;
}

export interface RepositoryCacheUsage {
  readonly namespace: string;
  readonly ref: string;
  readonly generation: string;
  readonly healthy: boolean;
  readonly entryCount: number | null;
  readonly logicalBytes: number | null;
  readonly physicalBytes: null;
  readonly retention: {
    readonly pinnedEntries: number | null;
    readonly evictableEntries: number | null;
  } | null;
  readonly reachability: 'anchored';
  readonly age: {
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
    readonly oldestAccessedAt: string | null;
  } | null;
  readonly expiry: {
    readonly expiredEntries: number;
    readonly nextExpiry: string | null;
  } | null;
  readonly policy: Readonly<CachePolicyData> | null;
  readonly issues: ReadonlyArray<Record<string, unknown>>;
}

export interface RepositoryCacheAcquisitionUsage {
  readonly id?: string;
  readonly namespace?: string;
  readonly ref?: string;
  readonly generation: string;
  readonly acquiredAt?: string;
  readonly ageMs?: number;
  readonly healthy: boolean;
  readonly issues: ReadonlyArray<Record<string, unknown>>;
}

export interface RepositoryRootSetUsage {
  readonly ref: string;
  readonly generation: string;
  readonly healthy: boolean;
  readonly entryCount: number | null;
  readonly physicalBytes: null;
  readonly retention: {
    readonly pinnedEntries: number | null;
    readonly evictableEntries: number | null;
  } | null;
  readonly reachability: RootSetDoctorResult['reachabilityCounts'] | 'anchored' | null;
  readonly issues: ReadonlyArray<Record<string, unknown>>;
}

export interface RepositoryExpiringSetUsage {
  readonly namespace: string;
  readonly ref: string;
  readonly generation: string;
  readonly healthy: boolean;
  readonly entryCount: number | null;
  readonly physicalBytes: null;
  readonly reachability: 'anchored';
  readonly age: {
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
  } | null;
  readonly expiry: {
    readonly liveEntries: number;
    readonly expiredEntries: number;
    readonly nextExpiry: string | null;
  } | null;
  readonly issues: ReadonlyArray<Record<string, unknown>>;
}

export interface RepositoryVaultUsage {
  readonly ref: string;
  readonly present: boolean;
  readonly healthy: boolean;
  readonly generation: string | null;
  readonly entryCount: number | null;
  readonly physicalBytes: null;
  readonly privacy: boolean | null;
  readonly reachability: 'anchored' | null;
  readonly issues: ReadonlyArray<Record<string, unknown>>;
}

export interface RepositoryDoctorReport {
  readonly version: 1;
  readonly healthy: boolean;
  readonly observedAt: string;
  readonly completedAt: string;
  readonly policy: {
    readonly gracePeriodMs: number | null;
    readonly expiresBefore: string;
    readonly maxCollectionsPerKind: number;
  };
  readonly repository: {
    readonly objects: RepositoryObjectInventory;
    readonly roots: {
      readonly refCount: number;
      readonly reflogsIncluded: true;
      readonly reflogCount: null;
    };
    readonly evidence: {
      readonly anchoredInventory: 'refs-and-reflogs';
      readonly prunableInspection: 'dry-run';
      readonly mutatesRepository: false;
    };
  };
  readonly usage: {
    readonly acquisitions: {
      readonly healthy: boolean;
      readonly coverage: RepositoryCollectionCoverage;
      readonly totals: {
        readonly activeCount: number;
        readonly oldestAcquiredAt: string | null;
        readonly newestAcquiredAt: string | null;
        readonly maxAgeMs: number;
      };
      readonly entries: ReadonlyArray<RepositoryCacheAcquisitionUsage>;
    };
    readonly caches: {
      readonly healthy: boolean;
      readonly coverage: RepositoryCollectionCoverage;
      readonly totals: {
        readonly entryCount: number | null;
        readonly logicalBytes: number | null;
        readonly pinnedEntries: number | null;
        readonly evictableEntries: number | null;
        readonly expiredEntries: number | null;
      };
      readonly entries: ReadonlyArray<RepositoryCacheUsage>;
    };
    readonly rootSets: {
      readonly healthy: boolean;
      readonly coverage: RepositoryCollectionCoverage;
      readonly totals: {
        readonly entryCount: number | null;
        readonly pinnedEntries: number | null;
        readonly evictableEntries: number | null;
      };
      readonly entries: ReadonlyArray<RepositoryRootSetUsage>;
    };
    readonly expiringSets: {
      readonly healthy: boolean;
      readonly coverage: RepositoryCollectionCoverage;
      readonly totals: {
        readonly entryCount: number | null;
        readonly liveEntries: number | null;
        readonly expiredEntries: number | null;
      };
      readonly entries: ReadonlyArray<RepositoryExpiringSetUsage>;
    };
    readonly vault: RepositoryVaultUsage;
  };
  readonly limitations: ReadonlyArray<RepositoryDiagnosticLimitation>;
}

/** Repository-wide, non-mutating diagnostics domain service. */
export declare class RepositoryDoctor {
  constructor(options: {
    repository: RepositoryInspectionPort;
    rootSets: { open(options: { ref: string }): RootSet | Promise<RootSet> };
    caches: { open(options: { namespace: string }): CacheSet | Promise<CacheSet> };
    expiringSets: {
      open(options: { namespace: string }): ExpiringSet | Promise<ExpiringSet>;
    };
    vault: Pick<VaultService, 'getVaultMetadata' | 'readState'>;
    clock?: { now(): Date };
  });
  doctor(options?: RepositoryDoctorOptions): Promise<RepositoryDoctorReport>;
}

/** Result of comparing two manifests by chunk digest. */
export interface ManifestDiffResult {
  added: Chunk[];
  removed: Chunk[];
  unchanged: Chunk[];
  summary: {
    addedCount: number;
    removedCount: number;
    unchangedCount: number;
    addedBytes: number;
    removedBytes: number;
    unchangedBytes: number;
  };
}

/** Compares two manifests by chunk digest, returning added/removed/unchanged chunks. */
export function diffManifests(oldManifest: Manifest, newManifest: Manifest): ManifestDiffResult;

/** Encryption scheme constant for whole-object encryption. */
export const SCHEME_WHOLE: 'whole';
/** Encryption scheme constant for framed streaming encryption. */
export const SCHEME_FRAMED: 'framed';
/** Encryption scheme constant for convergent (dedup-preserving) encryption. */
export const SCHEME_CONVERGENT: 'convergent';

export interface AssetPutOptions {
  source: AsyncIterable<Uint8Array>;
  slug: string;
  filename?: string;
  encryptionKey?: Uint8Array;
  passphrase?: string;
  encryption?: StoreEncryptionOptions;
  kdfOptions?: Omit<DeriveKeyOptions, 'passphrase'>;
  compression?: { algorithm: 'gzip' };
  recipients?: Array<{ label: string; key: Uint8Array }>;
  merkleThreshold?: number;
  chunking?: ChunkingConfig;
}

export interface AssetCapability {
  put(options: AssetPutOptions): Promise<StagedAsset>;
  adopt(options: { treeOid: string }): Promise<StagedAsset>;
  open(options: {
    handle: AssetHandleInput;
    encryptionKey?: Uint8Array;
    passphrase?: string;
  }): AsyncIterable<Uint8Array>;
}

export type PageSource =
  | Uint8Array
  | Iterable<Uint8Array>
  | AsyncIterable<Uint8Array>;

export interface PageCapability {
  put(options: { source: PageSource; maxBytes?: number }): Promise<StagedPage>;
  get(options: { handle: PageHandleInput; maxBytes?: number }): Promise<Uint8Array>;
  open(options: { handle: PageHandleInput }): AsyncIterable<Uint8Array>;
}

export type BundleMemberInput =
  | ApplicationHandleInput
  | PageSource
  | { source: PageSource; maxBytes?: number };

export interface BundleMember {
  readonly version: 1;
  readonly path: string;
  readonly handle: ApplicationHandle;
  readonly type: 'blob' | 'tree';
  readonly size: number | null;
  readonly logicalBytes: number;
}

export interface BundleCapability {
  put(options: {
    members:
      | Record<string, BundleMemberInput>
      | Map<string, BundleMemberInput>
      | Array<[string, BundleMemberInput]>;
    limits?: Partial<BundleLimits>;
  }): Promise<StagedBundle>;
  putOrdered(options: {
    members:
      | Iterable<[string, BundleMemberInput]>
      | AsyncIterable<[string, BundleMemberInput]>;
    limits?: Partial<BundleLimits>;
  }): Promise<StagedBundle>;
  getMember(options: {
    handle: BundleHandleInput;
    path: string;
  }): Promise<BundleMember | null>;
  iterateMembers(options: { handle: BundleHandleInput }): AsyncIterable<BundleMember>;
  openMember(options: { handle: BundleHandleInput; path: string }): AsyncIterable<Uint8Array>;
}

export interface CacheCapability {
  open(options: {
    namespace: string;
    policy?: CachePolicyOptions;
    retry?: { maxAttempts?: number; baseDelayMs?: number };
  }): Promise<CacheSet>;
}

export interface ExpiringSetCapability {
  open(options: {
    namespace: string;
    retry?: { maxAttempts?: number; baseDelayMs?: number };
  }): Promise<ExpiringSet>;
}

export interface DiagnosticsCapability {
  doctor(options?: RepositoryDoctorOptions): Promise<RepositoryDoctorReport>;
}

export interface RetentionResult {
  readonly changed: boolean;
  readonly witness: RetentionWitness;
}

export interface RetentionCapability {
  retain(options: {
    handle: ApplicationHandleInput;
    root: { ref: string; name: string };
    policy?: RetentionPolicy;
  }): Promise<RetentionResult>;
}

export interface PublicationResult {
  readonly operation: 'publication';
  readonly commitId: string;
  readonly ref: string;
  readonly root: ApplicationHandle;
  readonly witness: RetentionWitness;
}

export interface PublicationCapability {
  commit(options: {
    root: ApplicationHandleInput;
    commit: { message: string; parents?: string[] };
    ref: { name: string; expected: string | null };
  }): Promise<PublicationResult>;
}

/**
 * High-level facade for the Content Addressable Store library.
 *
 * Wraps CasService and VaultService with lazy initialization, runtime-adaptive
 * crypto selection, and convenience helpers for file I/O.
 */
export default class ContentAddressableStore {
  constructor(options: ContentAddressableStoreOptions);

  get chunkSize(): number;

  readonly rootSets: {
    open(options: {
      ref: string;
      retry?: { maxAttempts?: number; baseDelayMs?: number };
    }): Promise<RootSet>;
  };

  readonly caches: CacheCapability;
  readonly expiringSets: ExpiringSetCapability;
  readonly diagnostics: DiagnosticsCapability;

  readonly assets: AssetCapability;
  readonly pages: PageCapability;
  readonly bundles: BundleCapability;
  readonly retention: RetentionCapability;
  readonly publications: PublicationCapability;

  getService(): Promise<CasService>;
  getVaultService(): Promise<VaultService>;
  getRootSetRegistry(): Promise<RootSetRegistry>;

  static open(options?: ContentAddressableStoreOpenOptions): Promise<ContentAddressableStore>;

  static createJson(options: ContentAddressableStoreCodecFactoryOptions): ContentAddressableStore;

  static createCbor(options: ContentAddressableStoreCodecFactoryOptions): ContentAddressableStore;

  static diffManifests(oldManifest: Manifest, newManifest: Manifest): ManifestDiffResult;

  encrypt(options: {
    buffer: Uint8Array;
    key: Uint8Array;
  }): Promise<{ buf: Uint8Array; meta: EncryptionMeta }>;

  decrypt(options: {
    buffer: Uint8Array;
    key: Uint8Array;
    meta: EncryptionMeta;
  }): Promise<Uint8Array>;

  storeFile(options: {
    filePath: string;
    slug: string;
    filename?: string;
    encryptionKey?: Uint8Array;
    passphrase?: string;
    encryption?: StoreEncryptionOptions;
    kdfOptions?: Omit<DeriveKeyOptions, 'passphrase'>;
    compression?: { algorithm: 'gzip' };
    recipients?: Array<{ label: string; key: Uint8Array }>;
    merkleThreshold?: number;
    chunking?: ChunkingConfig;
  }): Promise<Manifest>;

  store(options: {
    source: AsyncIterable<Uint8Array>;
    slug: string;
    filename: string;
    encryptionKey?: Uint8Array;
    passphrase?: string;
    encryption?: StoreEncryptionOptions;
    kdfOptions?: Omit<DeriveKeyOptions, 'passphrase'>;
    compression?: { algorithm: 'gzip' };
    recipients?: Array<{ label: string; key: Uint8Array }>;
    merkleThreshold?: number;
    chunking?: ChunkingConfig;
  }): Promise<Manifest>;

  restoreFile(options: {
    manifest: Manifest;
    encryptionKey?: Uint8Array;
    passphrase?: string;
    outputPath: string;
    baseDirectory: string;
  }): Promise<{ bytesWritten: number }>;

  restore(options: {
    manifest: Manifest;
    encryptionKey?: Uint8Array;
    passphrase?: string;
  }): Promise<{ buffer: Uint8Array; bytesWritten: number }>;

  restoreStream(options: {
    manifest: Manifest;
    encryptionKey?: Uint8Array;
    passphrase?: string;
  }): AsyncIterable<Uint8Array>;

  createTree(options: { manifest: Manifest; merkleThreshold?: number }): Promise<string>;

  verifyIntegrity(manifest: Manifest, options?: VerifyIntegrityOptions): Promise<boolean>;

  readManifest(options: { treeOid: string }): Promise<Manifest>;

  inspectAsset(options: { treeOid: string }): Promise<{ slug: string; chunksOrphaned: number }>;

  /** @deprecated Use {@link inspectAsset} instead. */
  deleteAsset(options: { treeOid: string }): Promise<{ slug: string; chunksOrphaned: number }>;

  collectReferencedChunks(options: {
    treeOids: string[];
  }): Promise<{ referenced: Set<string>; total: number }>;

  /** @deprecated Use {@link collectReferencedChunks} instead. */
  findOrphanedChunks(options: {
    treeOids: string[];
  }): Promise<{ referenced: Set<string>; total: number }>;

  deriveKey(options: DeriveKeyOptions): Promise<DeriveKeyResult>;

  addRecipient(options: {
    manifest: Manifest;
    existingKey: Uint8Array;
    newRecipientKey: Uint8Array;
    label: string;
  }): Promise<Manifest>;

  removeRecipient(options: { manifest: Manifest; label: string }): Promise<Manifest>;

  listRecipients(manifest: Manifest): Promise<string[]>;

  rotateKey(options: {
    manifest: Manifest;
    oldKey: Uint8Array;
    newKey: Uint8Array;
    label?: string;
  }): Promise<Manifest>;

  // Vault — delegates to VaultService

  static VAULT_REF: string;

  initVault(options?: {
    passphrase?: string;
    kdfOptions?: Omit<DeriveKeyOptions, 'passphrase'>;
    /** Enable privacy mode (requires passphrase/encryption). */
    privacy?: boolean;
  }): Promise<{ commitOid: string }>;

  addToVault(options: {
    slug: string;
    treeOid: string;
    force?: boolean;
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<{ commitOid: string }>;

  listVault(options?: {
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<VaultEntry[]>;

  iterateVault(options?: {
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): AsyncIterable<VaultEntry>;

  removeFromVault(options: {
    slug: string;
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<{ commitOid: string; removedTreeOid: string }>;

  resolveVaultEntry(options: {
    slug: string;
    /** Vault encryption key (required when privacy mode is enabled). */
    encryptionKey?: Uint8Array;
  }): Promise<string>;

  verifyVaultKey(options: {
    encryptionKey: Uint8Array;
  }): Promise<{ verified: boolean; requiresMigration: boolean }>;

  getVaultMetadata(): Promise<VaultMetadata | null>;

  rotateVaultPassphrase(options: {
    oldPassphrase: string;
    newPassphrase: string;
    kdfOptions?: Omit<DeriveKeyOptions, 'passphrase'>;
    /** Maximum optimistic-concurrency retries on VAULT_CONFLICT. @default 3 */
    maxRetries?: number;
    /** Base delay in ms for exponential backoff between retries. @default 50 */
    retryBaseMs?: number;
  }): Promise<{
    commitOid: string;
    rotatedSlugs: string[];
    skippedSlugs: string[];
  }>;
}
