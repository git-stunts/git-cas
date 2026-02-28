/**
 * @module
 * Content Addressable Store — Managed blob storage in Git.
 */

import Manifest from "./src/domain/value-objects/Manifest.js";
import type { EncryptionMeta, ManifestData, CompressionMeta, KdfParams, SubManifestRef } from "./src/domain/value-objects/Manifest.js";
import Chunk from "./src/domain/value-objects/Chunk.js";
import CasService from "./src/domain/services/CasService.js";
import type {
  CryptoPort,
  CodecPort,
  GitPersistencePort,
  ObservabilityPort,
  CasServiceOptions,
  DeriveKeyOptions,
  DeriveKeyResult,
} from "./src/domain/services/CasService.js";

export { CasService, Manifest, Chunk };
export type { EncryptionMeta, ManifestData, CompressionMeta, KdfParams, SubManifestRef, CryptoPort, CodecPort, GitPersistencePort, ObservabilityPort, CasServiceOptions, DeriveKeyOptions, DeriveKeyResult };

/** Abstract port for splitting a byte stream into chunks. */
export declare class ChunkingPort {
  get strategy(): string;
  get params(): Record<string, unknown>;
  chunk(source: AsyncIterable<Buffer>): AsyncIterable<Buffer>;
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
  });
  get strategy(): "cdc";
  get params(): { target: number; min: number; max: number };
}

/** Abstract port for cryptographic operations. */
export declare class CryptoPortBase {
  sha256(buf: Buffer): string | Promise<string>;
  randomBytes(n: number): Buffer;
  encryptBuffer(
    buffer: Buffer,
    key: Buffer,
  ): { buf: Buffer; meta: EncryptionMeta } | Promise<{ buf: Buffer; meta: EncryptionMeta }>;
  decryptBuffer(buffer: Buffer, key: Buffer, meta: EncryptionMeta): Buffer | Promise<Buffer>;
  createEncryptionStream(key: Buffer): {
    encrypt: (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>;
    finalize: () => EncryptionMeta;
  };
  deriveKey(options: DeriveKeyOptions): Promise<DeriveKeyResult>;
}

/** Abstract port for persisting data to Git's object database. */
export declare class GitPersistencePortBase {
  writeBlob(content: Buffer | string): Promise<string>;
  writeTree(entries: string[]): Promise<string>;
  readBlob(oid: string): Promise<Buffer>;
  readTree(
    treeOid: string,
  ): Promise<Array<{ mode: string; type: string; oid: string; name: string }>>;
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
    expectedOldOid?: string | null;
  }): Promise<void>;
}

/** Git-backed implementation of the persistence port. */
export declare class GitPersistenceAdapter extends GitPersistencePortBase {
  constructor(options: { plumbing: unknown; policy?: unknown });
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
  encode(data: object): Buffer | string;
  decode(buffer: Buffer | string): object;
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
}

/** A single vault entry. */
export interface VaultEntry {
  slug: string;
  treeOid: string;
}

/** Vault metadata stored in .vault.json. */
export interface VaultMetadata {
  version: number;
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
  });

  /** Validates a vault slug. Throws CasError with code INVALID_SLUG on failure. */
  validateSlug(slug: string): void;

  /** Reads the current vault state from refs/cas/vault. */
  readState(): Promise<VaultState>;

  /** Writes a new vault commit and updates the ref atomically. */
  writeCommit(options: {
    entries: Map<string, string>;
    metadata: VaultMetadata;
    parentCommitOid: string | null;
    message: string;
  }): Promise<{ commitOid: string }>;

  /** Initializes the vault, optionally with encryption. */
  initVault(options?: {
    passphrase?: string;
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
  }): Promise<{ commitOid: string }>;

  /** Adds or updates an entry in the vault. */
  addToVault(options: {
    slug: string;
    treeOid: string;
    force?: boolean;
  }): Promise<{ commitOid: string }>;

  /** Lists all vault entries sorted by slug. */
  listVault(): Promise<VaultEntry[]>;

  /** Removes an entry from the vault. */
  removeFromVault(options: {
    slug: string;
  }): Promise<{ commitOid: string; removedTreeOid: string }>;

  /** Resolves a vault entry slug to its tree OID. */
  resolveVaultEntry(options: { slug: string }): Promise<string>;

  /** Returns the vault metadata, or null if no vault exists. */
  getVaultMetadata(): Promise<VaultMetadata | null>;
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

  getService(): Promise<CasService>;
  getVaultService(): Promise<VaultService>;

  static createJson(options: {
    plumbing: unknown;
    chunkSize?: number;
    policy?: unknown;
  }): ContentAddressableStore;

  static createCbor(options: {
    plumbing: unknown;
    chunkSize?: number;
    policy?: unknown;
  }): ContentAddressableStore;

  encrypt(options: {
    buffer: Buffer;
    key: Buffer;
  }): Promise<{ buf: Buffer; meta: EncryptionMeta }>;

  decrypt(options: {
    buffer: Buffer;
    key: Buffer;
    meta: EncryptionMeta;
  }): Promise<Buffer>;

  storeFile(options: {
    filePath: string;
    slug: string;
    filename?: string;
    encryptionKey?: Buffer;
    passphrase?: string;
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
    compression?: { algorithm: "gzip" };
    recipients?: Array<{ label: string; key: Buffer }>;
  }): Promise<Manifest>;

  store(options: {
    source: AsyncIterable<Buffer>;
    slug: string;
    filename: string;
    encryptionKey?: Buffer;
    passphrase?: string;
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
    compression?: { algorithm: "gzip" };
    recipients?: Array<{ label: string; key: Buffer }>;
  }): Promise<Manifest>;

  restoreFile(options: {
    manifest: Manifest;
    encryptionKey?: Buffer;
    passphrase?: string;
    outputPath: string;
  }): Promise<{ bytesWritten: number }>;

  restore(options: {
    manifest: Manifest;
    encryptionKey?: Buffer;
    passphrase?: string;
  }): Promise<{ buffer: Buffer; bytesWritten: number }>;

  restoreStream(options: {
    manifest: Manifest;
    encryptionKey?: Buffer;
    passphrase?: string;
  }): AsyncIterable<Buffer>;

  createTree(options: { manifest: Manifest }): Promise<string>;

  verifyIntegrity(manifest: Manifest): Promise<boolean>;

  readManifest(options: { treeOid: string }): Promise<Manifest>;

  deleteAsset(options: {
    treeOid: string;
  }): Promise<{ slug: string; chunksOrphaned: number }>;

  findOrphanedChunks(options: {
    treeOids: string[];
  }): Promise<{ referenced: Set<string>; total: number }>;

  deriveKey(options: DeriveKeyOptions): Promise<DeriveKeyResult>;

  // Vault — delegates to VaultService

  static VAULT_REF: string;

  initVault(options?: {
    passphrase?: string;
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
  }): Promise<{ commitOid: string }>;

  addToVault(options: {
    slug: string;
    treeOid: string;
    force?: boolean;
  }): Promise<{ commitOid: string }>;

  listVault(): Promise<VaultEntry[]>;

  removeFromVault(options: {
    slug: string;
  }): Promise<{ commitOid: string; removedTreeOid: string }>;

  resolveVaultEntry(options: { slug: string }): Promise<string>;

  getVaultMetadata(): Promise<VaultMetadata | null>;
}
