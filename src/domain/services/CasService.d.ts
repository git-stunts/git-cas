/**
 * @module
 * Domain service for Content Addressable Storage operations.
 */

import Manifest from "../value-objects/Manifest.js";
import type { EncryptionMeta, CompressionMeta, KdfParams } from "../value-objects/Manifest.js";

/** Port interface for cryptographic operations (hashing, encryption, random bytes). */
export interface CryptoPort {
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

/** Constructor options for {@link CasService}. */
export interface CasServiceOptions {
  persistence: GitPersistencePort;
  codec: CodecPort;
  crypto: CryptoPort;
  observability: ObservabilityPort;
  chunkSize?: number;
  merkleThreshold?: number;
  concurrency?: number;
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

  readManifest(options: { treeOid: string }): Promise<Manifest>;

  deleteAsset(options: {
    treeOid: string;
  }): Promise<{ slug: string; chunksOrphaned: number }>;

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

  verifyIntegrity(manifest: Manifest): Promise<boolean>;

  deriveKey(options: DeriveKeyOptions): Promise<DeriveKeyResult>;
}
