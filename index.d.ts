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
  CasServiceOptions,
  DeriveKeyOptions,
  DeriveKeyResult,
} from "./src/domain/services/CasService.js";

export { CasService, Manifest, Chunk };
export type { EncryptionMeta, ManifestData, CompressionMeta, KdfParams, SubManifestRef, CryptoPort, CodecPort, GitPersistencePort, CasServiceOptions, DeriveKeyOptions, DeriveKeyResult };

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

/** Git-backed implementation of the persistence port. */
export declare class GitPersistenceAdapter extends GitPersistencePortBase {
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

/** Constructor options for {@link ContentAddressableStore}. */
export interface ContentAddressableStoreOptions {
  plumbing: unknown;
  chunkSize?: number;
  codec?: CodecPort;
  crypto?: CryptoPort;
  policy?: unknown;
  merkleThreshold?: number;
}

/**
 * High-level facade for the Content Addressable Store library.
 *
 * Wraps CasService with lazy initialization, runtime-adaptive crypto
 * selection, and convenience helpers for file I/O.
 */
export default class ContentAddressableStore {
  constructor(options: ContentAddressableStoreOptions);

  get chunkSize(): number;

  getService(): Promise<CasService>;

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
  }): Promise<Manifest>;

  store(options: {
    source: AsyncIterable<Buffer>;
    slug: string;
    filename: string;
    encryptionKey?: Buffer;
    passphrase?: string;
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
    compression?: { algorithm: "gzip" };
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

  // -------------------------------------------------------------------------
  // Vault — GC-safe ref-based storage
  // -------------------------------------------------------------------------

  static VAULT_REF: string;

  /** Validates a vault slug. Throws CasError with code INVALID_SLUG on failure. */
  _validateSlug(slug: string): void;

  /** Reads the current vault state from refs/cas/vault. */
  _readVaultState(): Promise<VaultState>;

  /** Writes a new vault commit and updates the ref atomically. */
  _writeVaultCommit(options: {
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

/** Internal vault state returned by _readVaultState. */
export interface VaultState {
  entries: Map<string, string>;
  parentCommitOid: string | null;
  metadata: VaultMetadata | null;
}
