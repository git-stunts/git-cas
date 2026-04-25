/**
 * @module
 * Domain service for Content Addressable Storage operations.
 */

import Manifest from "../value-objects/Manifest.js";
import Chunk from "../value-objects/Chunk.js";
import type { EncryptionMeta, CompressionMeta, KdfParams, EncryptionScheme } from "../value-objects/Manifest.js";

/** Port interface for cryptographic operations (hashing, encryption, random bytes). */
export interface CryptoPort {
  sha256(buf: Buffer): Promise<string>;
  randomBytes(n: number): Buffer;
  encryptBuffer(
    buffer: Buffer,
    key: Buffer,
    aad?: Buffer | Uint8Array,
  ): { buf: Buffer; meta: EncryptionMeta } | Promise<{ buf: Buffer; meta: EncryptionMeta }>;
  decryptBuffer(buffer: Buffer, key: Buffer, meta: EncryptionMeta, aad?: Buffer | Uint8Array): Buffer | Promise<Buffer>;
  createEncryptionStream(key: Buffer, aad?: Buffer | Uint8Array): {
    encrypt: (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>;
    finalize: () => EncryptionMeta;
  };
  createDecryptionStream(key: Buffer, meta: EncryptionMeta, aad?: Buffer | Uint8Array): {
    decrypt: (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>;
  };
  hmacSha256(key: Buffer | Uint8Array, data: Buffer | Uint8Array | string): Buffer;
  encryptBufferWithNonce(
    buffer: Buffer | Uint8Array,
    key: Buffer | Uint8Array,
    nonce: Buffer | Uint8Array,
  ): { buf: Buffer; tag: Buffer } | Promise<{ buf: Buffer; tag: Buffer }>;
  decryptBufferWithNonceTag(
    buffer: Buffer | Uint8Array,
    key: Buffer | Uint8Array,
    nonce: Buffer | Uint8Array,
    tag: Buffer | Uint8Array,
  ): Buffer | Promise<Buffer>;
  deriveKey(options: DeriveKeyOptions): Promise<DeriveKeyResult>;
}

/** Port interface for encoding and decoding manifest data. */
export interface CodecPort {
  encode(data: object): Buffer | string;
  decode(buffer: Buffer | string): object;
  get extension(): string;
}

/** Port interface for persisting data to Git's object database. */
export interface GitPersistencePort {
  writeBlob(content: Buffer | string): Promise<string>;
  writeTree(entries: string[]): Promise<string>;
  readBlob(oid: string): Promise<Buffer>;
  readBlobStream(oid: string): Promise<AsyncIterable<Buffer>>;
  readTree(
    treeOid: string,
  ): Promise<Array<{ mode: string; type: string; oid: string; name: string }>>;
}

/** Port interface for observability (metrics, logging, tracing). */
export interface ObservabilityPort {
  metric(channel: string, data: Record<string, unknown>): void;
  log(level: "debug" | "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>): void;
  span(name: string): { end(meta?: Record<string, unknown>): void };
}

/** Port interface for chunking strategies (fixed, CDC, etc.). */
export interface ChunkingPort {
  chunk(source: AsyncIterable<Buffer>): AsyncIterable<Buffer>;
  readonly strategy: string;
  readonly params: Record<string, unknown>;
}

/** Port interface for compression and decompression of buffers and streams. */
export interface CompressionPort {
  compressBuffer(buffer: Buffer): Promise<Buffer>;
  decompressBuffer(buffer: Buffer): Promise<Buffer>;
  compressStream(source: AsyncIterable<Buffer>): AsyncIterable<Buffer>;
  decompressStream(source: AsyncIterable<Buffer>): AsyncIterable<Buffer>;
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
  chunker?: ChunkingPort;
  maxRestoreBufferSize?: number;
  compressionAdapter?: CompressionPort;
  formatVersion?: string;
}

/** Options for key derivation. */
export interface DeriveKeyOptions {
  passphrase: string;
  salt?: Buffer;
  algorithm?: "pbkdf2" | "scrypt";
  iterations?: number;
  cost?: number;
  blockSize?: number;
  parallelization?: number;
  keyLength?: number;
}

/** Result from key derivation. */
export interface DeriveKeyResult {
  key: Buffer;
  salt: Buffer;
  params: KdfParams;
}

export interface VerifyIntegrityOptions {
  encryptionKey?: Buffer;
  passphrase?: string;
}

export interface StoreEncryptionOptions {
  scheme?: EncryptionScheme;
  frameBytes?: number;
}

export interface FileRestorePlan {
  mode: "stream" | "bounded-file";
  source: AsyncIterable<Buffer>;
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

  constructor(options: CasServiceOptions);

  encrypt(options: {
    buffer: Buffer;
    key: Buffer;
  }): Promise<{ buf: Buffer; meta: EncryptionMeta }>;

  decrypt(options: {
    buffer: Buffer;
    key: Buffer;
    meta: EncryptionMeta;
  }): Promise<Buffer>;

  store(options: {
    source: AsyncIterable<Buffer>;
    slug: string;
    filename: string;
    encryptionKey?: Buffer;
    passphrase?: string;
    encryption?: StoreEncryptionOptions;
    kdfOptions?: Omit<DeriveKeyOptions, "passphrase">;
    compression?: { algorithm: "gzip" };
    recipients?: Array<{ label: string; key: Buffer }>;
  }): Promise<Manifest>;

  createTree(options: { manifest: Manifest }): Promise<string>;

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

  createFileRestorePlan(options: {
    manifest: Manifest;
    encryptionKey?: Buffer;
    passphrase?: string;
  }): Promise<FileRestorePlan>;

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

  addRecipient(options: {
    manifest: Manifest;
    existingKey: Buffer;
    newRecipientKey: Buffer;
    label: string;
  }): Promise<Manifest>;

  removeRecipient(options: {
    manifest: Manifest;
    label: string;
  }): Promise<Manifest>;

  listRecipients(manifest: Manifest): string[];

  rotateKey(options: {
    manifest: Manifest;
    oldKey: Buffer;
    newKey: Buffer;
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
