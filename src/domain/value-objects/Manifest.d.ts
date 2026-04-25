import Chunk from "./Chunk.js";

/** KDF parameters stored alongside encryption metadata. */
export interface KdfParams {
  algorithm: "pbkdf2" | "scrypt";
  salt: string;
  iterations?: number;
  cost?: number;
  blockSize?: number;
  parallelization?: number;
  keyLength: number;
}

/** A single recipient entry in an envelope-encrypted manifest. */
export interface RecipientEntry {
  label: string;
  wrappedDek: string;
  nonce: string;
  tag: string;
  kekType?: string;
  keyVersion?: number;
}

export type EncryptionScheme = "whole" | "framed" | "convergent";

export interface WholeEncryptionMeta {
  scheme: "whole";
  algorithm: "aes-256-gcm";
  nonce: string;
  tag: string;
  frameBytes?: never;
  encrypted: true;
  kdf?: KdfParams;
  recipients?: RecipientEntry[];
  keyVersion?: number;
}

export interface FramedEncryptionMeta {
  scheme: "framed";
  algorithm: "aes-256-gcm";
  nonce?: never;
  tag?: never;
  frameBytes: number;
  encrypted: true;
  kdf?: KdfParams;
  recipients?: RecipientEntry[];
  keyVersion?: number;
}

export interface ConvergentEncryptionMeta {
  scheme: "convergent";
  algorithm: "aes-256-gcm";
  nonce?: never;
  tag?: never;
  frameBytes?: never;
  encrypted: true;
  kdf?: KdfParams;
  recipients?: RecipientEntry[];
  keyVersion?: number;
}

/** AES-256-GCM encryption metadata attached to an encrypted manifest. */
export type EncryptionMeta = WholeEncryptionMeta | FramedEncryptionMeta | ConvergentEncryptionMeta;

/** Compression metadata. */
export interface CompressionMeta {
  algorithm: "gzip";
}

/** Sub-manifest reference in a v2 Merkle manifest. */
export interface SubManifestRef {
  oid: string;
  chunkCount: number;
  startIndex: number;
}

/** Raw manifest data accepted by the {@link Manifest} constructor. */
export interface ManifestData {
  version?: number;
  formatVersion?: string;
  slug: string;
  filename: string;
  size: number;
  chunks: Array<{ index: number; size: number; digest: string; blob: string }>;
  encryption?: EncryptionMeta;
  compression?: CompressionMeta;
  subManifests?: SubManifestRef[];
}

/**
 * Immutable value object representing a file manifest.
 */
export default class Manifest {
  readonly version: number;
  readonly formatVersion?: string;
  readonly slug: string;
  readonly filename: string;
  readonly size: number;
  readonly chunks: readonly Chunk[];
  readonly encryption?: EncryptionMeta;
  readonly compression?: CompressionMeta;
  readonly subManifests?: readonly SubManifestRef[];

  constructor(data: ManifestData);

  toJSON(): ManifestData;
}
