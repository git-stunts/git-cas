/**
 * @module
 * Content Addressable Store — Managed blob storage in Git.
 */

import Manifest from "./src/domain/value-objects/Manifest.js";
import type { EncryptionMeta, ManifestData, CompressionMeta, KdfParams, SubManifestRef, RecipientEntry, EncryptionScheme } from "./src/domain/value-objects/Manifest.js";
import Chunk from "./src/domain/value-objects/Chunk.js";
import CasService from "./src/domain/services/CasService.js";
import CasError from "./src/domain/errors/CasError.js";
import type { CryptoPort, CodecPort, GitPersistencePort, ObservabilityPort, CasServiceOptions, DeriveKeyOptions, DeriveKeyResult, StoreEncryptionOptions, VerifyIntegrityOptions } from "./src/domain/services/CasService.js";

export { CasService, CasError, Manifest, Chunk };
/** Type alias mapping the runtime `CompressionPort` export to its base class declaration. */
export type CompressionPort = CompressionPortBase;

export type { EncryptionMeta, ManifestData, CompressionMeta, KdfParams, SubManifestRef, RecipientEntry, EncryptionScheme };
export type { CryptoPort, CodecPort, GitPersistencePort, ObservabilityPort, CasServiceOptions, DeriveKeyOptions, DeriveKeyResult, StoreEncryptionOptions, VerifyIntegrityOptions };

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
  get strategy(): "fixed";
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
  get strategy(): "cdc";
  get params(): { target: number; min: number; max: number; normalized: boolean };
}

/** Abstract port for cryptographic operations. */
export declare class CryptoPortBase {
  sha256(buf: Uint8Array): Promise<string>;
  randomBytes(n: number): Uint8Array;
  encryptBuffer(
    buffer: Uint8Array,
    key: Uint8Array,
    aad?: Uint8Array,
  ): { buf: Uint8Array; meta: EncryptionMeta } | Promise<{ buf: Uint8Array; meta: EncryptionMeta }>;
  decryptBuffer(buffer: Uint8Array, key: Uint8Array, meta: EncryptionMeta, aad?: Uint8Array): Uint8Array | Promise<Uint8Array>;
  createEncryptionStream(key: Uint8Array, aad?: Uint8Array): {
    encrypt: (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>;
    finalize: () => EncryptionMeta;
  };
  createDecryptionStream(key: Uint8Array, meta: EncryptionMeta, aad?: Uint8Array): {
    decrypt: (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>;
  };
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  encryptBufferWithNonce(
    buffer: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array,
  ): { buf: Uint8Array; tag: Uint8Array } | Promise<{ buf: Uint8Array; tag: Uint8Array }>;
  decryptBufferWithNonceTag(
    buffer: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array,
    tag: Uint8Array,
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
    treeOid: string,
  ): Promise<Array<{ mode: string; type: string; oid: string; name: string }>>;
  readTreeEntry(
    treeOid: string,
    treePath: string,
  ): Promise<{ mode: string; type: string; oid: string; name: string } | null>;
  iterateTree(
    treeOid: string,
  ): AsyncIterable<{ mode: string; type: string; oid: string; name: string }>;
  setMaxBlobSize?(maxBlobSize: number): void;
}

/** Abstract port for Git ref and commit operations. */
export declare class GitRefPortBase {
  resolveRef(ref: string): Promise<string>;
  resolveTree(commitOid: string): Promise<string>;
  createCommit(options: {
    treeOid: string;
    parentOid?: string | null;
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
  strategy: "fixed" | "cdc";
  chunkSize?: number;
  targetChunkSize?: number;
  minChunkSize?: number;
  maxChunkSize?: number;
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
}

/** Options for {@link ContentAddressableStore.open}. */
export interface ContentAddressableStoreOpenOptions extends Omit<ContentAddressableStoreOptions, "plumbing"> {
  /** Git working directory used to construct the default Git plumbing adapter. @default "." */
  cwd?: string;
  /** Optional shell-runner environment override for Git plumbing. */
  env?: string;
}

/** Options for codec-specific facade factories. */
export type ContentAddressableStoreCodecFactoryOptions = Omit<ContentAddressableStoreOptions, "codec">;

/** A single vault entry. */
export interface VaultEntry {
  slug: string;
  treeOid: string;
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
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
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

/**
 * High-level facade for the Content Addressable Store library.
 *
 * Wraps CasService and VaultService with lazy initialization, runtime-adaptive
 * crypto selection, and convenience helpers for file I/O.
 */
export default class ContentAddressableStore {
  constructor(options: ContentAddressableStoreOptions);

  get chunkSize(): number;

  getService(): Promise<CasService>;
  getVaultService(): Promise<VaultService>;

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
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
    compression?: { algorithm: "gzip" };
    recipients?: Array<{ label: string; key: Uint8Array }>;
    merkleThreshold?: number;
  }): Promise<Manifest>;

  store(options: {
    source: AsyncIterable<Uint8Array>;
    slug: string;
    filename: string;
    encryptionKey?: Uint8Array;
    passphrase?: string;
    encryption?: StoreEncryptionOptions;
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
    compression?: { algorithm: "gzip" };
    recipients?: Array<{ label: string; key: Uint8Array }>;
    merkleThreshold?: number;
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

  inspectAsset(options: {
    treeOid: string;
  }): Promise<{ slug: string; chunksOrphaned: number }>;

  /** @deprecated Use {@link inspectAsset} instead. */
  deleteAsset(options: {
    treeOid: string;
  }): Promise<{ slug: string; chunksOrphaned: number }>;

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

  removeRecipient(options: {
    manifest: Manifest;
    label: string;
  }): Promise<Manifest>;

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
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
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
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
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
