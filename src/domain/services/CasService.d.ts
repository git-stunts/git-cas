/**
 * @module
 * Domain service for Content Addressable Storage operations.
 */

import { EventEmitter } from "node:events";
import Manifest from "../value-objects/Manifest.js";
import type { EncryptionMeta } from "../value-objects/Manifest.js";

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

/** Constructor options for {@link CasService}. */
export interface CasServiceOptions {
  persistence: GitPersistencePort;
  codec: CodecPort;
  crypto: CryptoPort;
  chunkSize?: number;
}

/**
 * Domain service for Content Addressable Storage operations.
 *
 * Provides chunking, encryption, and integrity verification for storing
 * arbitrary data in Git's object database.
 */
export default class CasService extends EventEmitter {
  readonly persistence: GitPersistencePort;
  readonly codec: CodecPort;
  readonly crypto: CryptoPort;
  readonly chunkSize: number;

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
  }): Promise<Manifest>;

  createTree(options: { manifest: Manifest }): Promise<string>;

  restore(options: {
    manifest: Manifest;
    encryptionKey?: Buffer;
  }): Promise<{ buffer: Buffer; bytesWritten: number }>;

  readManifest(options: { treeOid: string }): Promise<Manifest>;

  deleteAsset(options: {
    treeOid: string;
  }): Promise<{ slug: string; chunksOrphaned: number }>;

  findOrphanedChunks(options: {
    treeOids: string[];
  }): Promise<{ referenced: Set<string>; total: number }>;

  verifyIntegrity(manifest: Manifest): Promise<boolean>;
}
