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

export interface StagedAssetData {
  version: 1;
  state: 'staged';
  handle: string;
  asset: { slug: string; filename: string; size: number };
  retention: {
    policy: null;
    reachability: 'unanchored';
    protection: 'grace-period-only';
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
    protection: 'grace-period-only';
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

export type RetentionPolicy = 'pinned' | 'evictable';
export type RetentionReachability = 'anchored' | 'orphaned' | 'volatile';
export type RetentionRootKind = 'root-set' | 'publication' | 'cache-set' | 'expiring-set';

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
  readonly handle: AssetHandle;
  readonly policy: RetentionPolicy;
  readonly reachability: RetentionReachability;
  readonly root: Readonly<RetentionRoot>;
  readonly observedAt: string;
  constructor(value: {
    handle: AssetHandleInput;
    policy: RetentionPolicy;
    reachability: RetentionReachability;
    root: RetentionRoot;
    observedAt: string;
  });
  toJSON(): RetentionWitnessData;
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
  readBlob(oid: string): Promise<Uint8Array>;
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
}

/** Git-backed implementation of the persistence port. */
export declare class GitPersistenceAdapter extends GitPersistencePortBase {
  constructor(options: { plumbing: unknown; policy?: unknown });
  setMaxBlobSize(maxBlobSize: number): void;
}

/** Git-backed implementation of the ref port. */
export declare class GitRefAdapter extends GitRefPortBase {
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

export interface RetentionResult {
  readonly changed: boolean;
  readonly witness: RetentionWitness;
}

export interface RetentionCapability {
  retain(options: {
    handle: AssetHandleInput;
    root: { ref: string; name: string };
    policy?: RetentionPolicy;
  }): Promise<RetentionResult>;
}

export interface PublicationResult {
  readonly operation: 'publication';
  readonly commitId: string;
  readonly ref: string;
  readonly root: AssetHandle;
  readonly witness: RetentionWitness;
}

export interface PublicationCapability {
  commit(options: {
    root: AssetHandleInput;
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

  readonly assets: AssetCapability;
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
