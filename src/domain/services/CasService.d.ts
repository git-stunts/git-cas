/**
 * @module
 * Domain service for Content Addressable Storage operations.
 */

import Manifest, {
  type EncryptionMeta,
  type CompressionMeta,
  type KdfParams,
  type EncryptionScheme,
} from '../value-objects/Manifest.js';
import Chunk from '../value-objects/Chunk.js';

/** Port interface for cryptographic operations (hashing, encryption, random bytes). */
export interface CryptoPort {
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

/** Port interface for encoding and decoding manifest data. */
export interface CodecPort {
  encode(data: object): Uint8Array;
  decode(buffer: Uint8Array): object;
  get extension(): string;
}

/** Port interface for persisting data to Git's object database. */
export interface GitPersistencePort {
  writeBlob(content: Uint8Array): Promise<string>;
  writeBlobs?(contents: Iterable<Uint8Array>): Promise<string[]>;
  writeTree(entries: string[]): Promise<string>;
  writeTrees?(trees: Iterable<string[]>): Promise<string[]>;
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
  readObjectInfos?(
    oids: Iterable<string>
  ): Promise<Array<{ oid: string; type: string; size: number }>>;
  setMaxBlobSize?(maxBlobSize: number): void;
}

/** Port interface for observability (metrics, logging, tracing). */
export interface ObservabilityPort {
  metric(channel: string, data: Record<string, unknown>): void;
  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    msg: string,
    meta?: Record<string, unknown>
  ): void;
  span(name: string): { end(meta?: Record<string, unknown>): void };
}

/** Port interface for chunking strategies (fixed, CDC, etc.). */
export interface ChunkingPort {
  chunk(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
  readonly strategy: string;
  readonly params: Record<string, unknown>;
}

/** Port interface for compression and decompression of buffers and streams. */
export interface CompressionPort {
  compressBuffer(buffer: Uint8Array): Promise<Uint8Array>;
  decompressBuffer(buffer: Uint8Array): Promise<Uint8Array>;
  compressStream(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
  decompressStream(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
}

/** Constructor options for {@link CasService}. */
export interface CasServiceOptions {
  persistence: GitPersistencePort;
  codec: CodecPort;
  crypto: CryptoPort;
  observability: ObservabilityPort;
  chunkSize?: number;
  merkleThreshold?: number;
  concurrency?: number;
  chunker: ChunkingPort;
  maxRestoreBufferSize?: number;
  maxBlobSize?: number;
  compressionAdapter: CompressionPort;
  formatVersion?: string;
  /** When true, allows reading manifests with legacy encryption schemes (v1/v2). */
  legacyMode?: boolean;
}

/** Options for key derivation. */
export interface DeriveKeyOptions {
  passphrase: string;
  salt?: Uint8Array;
  algorithm?: 'pbkdf2' | 'scrypt';
  iterations?: number;
  cost?: number;
  blockSize?: number;
  parallelization?: number;
  keyLength?: number;
}

/** Result from key derivation. */
export interface DeriveKeyResult {
  key: Uint8Array;
  salt: Uint8Array;
  params: KdfParams;
}

export interface VerifyIntegrityOptions {
  encryptionKey?: Uint8Array;
  passphrase?: string;
}

export interface StoreEncryptionOptions {
  scheme?: EncryptionScheme;
  frameBytes?: number;
  /** Explicit convergent opt-in/opt-out; defaults on for CDC chunkers. */
  convergent?: boolean;
}

export interface FileRestorePlan {
  mode: 'stream' | 'bounded-file';
  source: AsyncIterable<Uint8Array>;
  encryptionMeta?: EncryptionMeta;
}

/**
 * Domain service for Content Addressable Storage operations.
 *
 * Provides chunking, encryption, and integrity verification for storing
 * arbitrary data in Git's object database.
 */
export default class CasService {
  readonly persistence: GitPersistencePort;
  readonly codec: CodecPort;
  readonly crypto: CryptoPort;
  readonly observability: ObservabilityPort;
  readonly chunkSize: number;
  readonly merkleThreshold: number;
  readonly concurrency: number;
  readonly maxRestoreBufferSize: number;
  readonly maxBlobSize: number;

  constructor(options: CasServiceOptions);

  encrypt(options: {
    buffer: Uint8Array;
    key: Uint8Array;
  }): Promise<{ buf: Uint8Array; meta: EncryptionMeta }>;

  decrypt(options: {
    buffer: Uint8Array;
    key: Uint8Array;
    meta: EncryptionMeta;
  }): Promise<Uint8Array>;

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
    chunker?: ChunkingPort;
  }): Promise<Manifest>;

  createTree(options: { manifest: Manifest; merkleThreshold?: number }): Promise<string>;

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

  createFileRestorePlan(options: {
    manifest: Manifest;
    encryptionKey?: Uint8Array;
    passphrase?: string;
  }): Promise<FileRestorePlan>;

  readManifest(options: { treeOid: string }): Promise<Manifest>;

  /** Reads a raw manifest without scheme assertion or Manifest construction. */
  readManifestRaw(options: { treeOid: string }): Promise<Record<string, unknown>>;

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

  addRecipient(options: {
    manifest: Manifest;
    existingKey: Uint8Array;
    newRecipientKey: Uint8Array;
    label: string;
  }): Promise<Manifest>;

  removeRecipient(options: { manifest: Manifest; label: string }): Promise<Manifest>;

  listRecipients(manifest: Manifest): string[];

  rotateKey(options: {
    manifest: Manifest;
    oldKey: Uint8Array;
    newKey: Uint8Array;
    label?: string;
  }): Promise<Manifest>;

  verifyIntegrity(manifest: Manifest, options?: VerifyIntegrityOptions): Promise<boolean>;

  deriveKey(options: DeriveKeyOptions): Promise<DeriveKeyResult>;

  static diffManifests(oldManifest: Manifest, newManifest: Manifest): ManifestDiffResult;
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
